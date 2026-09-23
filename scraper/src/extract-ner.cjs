// NER-extractie spoor 1 (2026-09-23).
// Stuurt de analysetekst van raw_items (title+summary+content+full_text, zelfde
// samenstelling als extract-entities.cjs) naar de spaCy-worker en schrijft de
// gefilterde vermeldingen naar document_mentions. Maakt geen KG-entiteiten,
// schrijft niet naar entity_identifiers/kg_aliases en voert geen merges uit.
// Koppeling aan kg_entities is alleen een kandidaat (exacte naam/alias, zelfde type).
//
// Aanroep:
//   node src/extract-ner.cjs [--limit N] [--dry-run] [--ids 1,2,3] [--before-id N]
//   --dry-run  leest alleen; schrijft rapport naar tmp/ner-dryrun-<tijd>.json
// Python: NER_PYTHON of scraper\.ner-venv\Scripts\python.exe
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const EXTRACTOR = 'spacy';
// Bronbereik. Bewust zonder 'social', 'community', 'emergency' en 'national_news':
// buurtberichten en sociale media bevatten namen van burgers die we niet in een
// nieuwe tabel willen vastleggen, en leveren vooral ruis op (dry-run 23-9).
const NER_CATEGORIES = ['government', 'registry', 'data', 'local_news'];
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}
const DRY = process.argv.includes('--dry-run');
const LIMIT = parseInt(arg('--limit', '300'), 10);
const IDS = arg('--ids', null);
const BEFORE_ID = parseInt(arg('--before-id', '0'), 10) || null;
// Venv in scraper/.ner-venv (genegeerd door git). Niet in %LOCALAPPDATA%: vanuit de
// Claude-app belandt die map in een gevirtualiseerde pakketmap die de Taakplanner
// niet ziet (23-9: ENOENT in de geplande taak).
const PYTHON = process.env.NER_PYTHON
  || path.join(__dirname, '..', '.ner-venv', 'Scripts', 'python.exe');
const WORKER = path.join(__dirname, 'ner', 'spacy_worker.py');

async function tableExists(name) {
  const r = await db.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [name] });
  return r.rows.length > 0;
}

function runWorker(records) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let buf = '', header = null, err = '';
    const results = [];
    py.stdout.setEncoding('utf8');
    py.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) > -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const o = JSON.parse(line);
        if (o.header) header = o; else results.push(o);
      }
    });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', reject);
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(`spaCy-worker stopte met code ${code}: ${err.slice(-2000)}`));
      if (!header) return reject(new Error('Geen header van spaCy-worker ontvangen'));
      resolve({ header, results });
    });
    py.stdin.setDefaultEncoding('utf8');
    for (const r of records) py.stdin.write(JSON.stringify(r) + '\n');
    py.stdin.end();
  });
}

// Index van KG-namen en -aliassen: type|norm -> Set(entity_id), na volgen van merged_into_id.
async function loadKgIndex() {
  const ents = (await db.execute('SELECT id, entity_type, canonical_name, merged_into_id FROM kg_entities')).rows;
  const byId = new Map(ents.map((e) => [Number(e.id), e]));
  const root = (id) => {
    let cur = byId.get(id), guard = 0;
    while (cur && cur.merged_into_id && guard++ < 10) cur = byId.get(Number(cur.merged_into_id));
    return cur;
  };
  const idx = new Map();
  const add = (type, text, id, how) => {
    if (!text) return;
    const k = type + '|' + norm(String(text));
    if (!idx.has(k)) idx.set(k, new Map());
    if (!idx.get(k).has(id)) idx.get(k).set(id, how);
  };
  for (const e of ents) {
    const r = root(Number(e.id));
    if (r) add(r.entity_type, e.canonical_name, Number(r.id), 'kg_name_exact');
  }
  let aliasCount = 0;
  if (await tableExists('kg_aliases')) {
    const al = (await db.execute('SELECT entity_id, alias FROM kg_aliases')).rows;
    for (const a of al) {
      const r = root(Number(a.entity_id));
      if (r) { add(r.entity_type, a.alias, Number(r.id), 'kg_alias_exact'); aliasCount++; }
    }
  }
  return { idx, entityCount: ents.length, aliasCount };
}

function resolve(kg, type, normText) {
  const hits = kg.idx.get(type + '|' + normText);
  if (!hits || hits.size === 0) return { status: 'unresolved', entityId: null, method: null, detail: null };
  if (hits.size === 1) {
    const [[id, how]] = [...hits];
    return { status: 'candidate', entityId: id, method: how, detail: null };
  }
  return { status: 'ambiguous', entityId: null, method: 'kg_multiple', detail: JSON.stringify([...hits.keys()]) };
}

async function main() {
  const haveTables = (await tableExists('document_mentions')) && (await tableExists('ner_scans'));
  if (!DRY && !haveTables) throw new Error('document_mentions/ner_scans ontbreken; draai eerst node migrate-document-mentions.cjs');

  // Items kiezen: alles in het bronbereik dat nog nooit door deze extractor is gescand.
  // Herverwerking met een nieuwe modelversie gebeurt bewust niet automatisch; dat is
  // een aparte, expliciete stap (--ids of een toekomstige --rescan).
  let items;
  if (IDS) {
    const ids = IDS.split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    items = (await db.execute({ sql: `SELECT r.id, r.title, r.summary, r.content, r.full_text, s.name AS source_name FROM raw_items r LEFT JOIN sources s ON s.id = r.source_id WHERE r.id IN (${ids.map(() => '?').join(',')})`, args: ids })).rows;
  } else {
    const skip = haveTables ? `AND r.id NOT IN (SELECT raw_item_id FROM ner_scans WHERE extractor = '${EXTRACTOR}')` : '';
    items = (await db.execute({
      sql: `SELECT r.id, r.title, r.summary, r.content, r.full_text, s.name AS source_name
            FROM raw_items r JOIN sources s ON s.id = r.source_id
            WHERE s.category IN (${NER_CATEGORIES.map(() => '?').join(',')}) ${skip}
              ${BEFORE_ID ? 'AND r.id < ?' : ''}
            ORDER BY r.id DESC LIMIT ?`,
      args: [...NER_CATEGORIES, ...(BEFORE_ID ? [BEFORE_ID] : []), LIMIT],
    })).rows;
  }
  console.log(`Te verwerken items: ${items.length}${DRY ? ' (dry-run)' : ''}`);
  if (!items.length) return;

  const texts = new Map();
  const sourceOf = new Map(items.map((it) => [Number(it.id), it.source_name]));
  const records = items.map((it) => {
    const text = [it.title, it.summary, it.content, it.full_text].filter(Boolean).join('\n');
    texts.set(Number(it.id), text);
    return { id: Number(it.id), text };
  });

  const t0 = Date.now();
  const { header, results } = await runWorker(records);
  const modelVersion = header.model_version;
  console.log(`Model: ${modelVersion}. NER klaar in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);

  const kg = await loadKgIndex();
  console.log(`KG-index: ${kg.entityCount} entiteiten, ${kg.aliasCount} aliassen.`);

  const stats = { items: results.length, raw: 0, kept: 0, dropped: {}, byType: {}, byStatus: {}, aliasOverlap: 0, inserted: 0, scansInserted: 0 };
  const report = [];

  for (const r of results) {
    const text = texts.get(r.id);
    const known = new Set((await db.execute({ sql: 'SELECT entity_type, normalized_name FROM entities WHERE raw_item_id = ?', args: [r.id] }))
      .rows.map((e) => e.entity_type + '|' + e.normalized_name));
    // Privacy: een persoonsnaam bewaren we alleen als die al in de KG staat
    // (bestuurders, raadsleden, bekende actoren). Onbekende personen - burgers,
    // ambtenaren, advocaten - worden geteld maar niet opgeslagen.
    const kept = [];
    for (const m of r.kept) {
      const res = resolve(kg, m.type, m.norm);
      if (m.type === 'person' && res.status === 'unresolved') {
        r.dropped.persoon_niet_in_kg = (r.dropped.persoon_niet_in_kg || 0) + 1;
        continue;
      }
      kept.push({ ...m, res });
    }
    r.kept = kept;
    stats.raw += r.raw; stats.kept += r.kept.length;
    for (const [k, v] of Object.entries(r.dropped)) stats.dropped[k] = (stats.dropped[k] || 0) + v;

    const rows = r.kept.map((m) => {
      const { res } = m;
      const overlap = known.has(m.type + '|' + m.norm) ? 1 : 0;
      const snippet = text.substring(Math.max(0, m.start - 60), m.end + 90).replace(/\s+/g, ' ').trim();
      stats.byType[m.type] = (stats.byType[m.type] || 0) + 1;
      stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1;
      stats.aliasOverlap += overlap;
      return { m, res, overlap, snippet };
    });

    if (DRY) {
      report.push({ id: r.id, source: sourceOf.get(r.id), title: (text.split('\n')[0] || '').slice(0, 120), raw: r.raw, dropped: r.dropped,
        mentions: rows.map(({ m, res, overlap, snippet }) => ({ text: m.text, type: m.type, label: m.label, n: m.occurrences, status: res.status, kg: res.entityId, alias_overlap: overlap, context: snippet })) });
      continue;
    }

    const stmts = rows.map(({ m, res, overlap, snippet }) => ({
      sql: `INSERT OR IGNORE INTO document_mentions
        (raw_item_id, entity_type, mention_text, normalized_text, model_label, span_start, span_end, occurrences,
         context_snippet, extractor, model_version, confidence, alias_overlap,
         resolution_status, resolved_entity_id, resolution_method, resolution_detail)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`,
      args: [r.id, m.type, m.text, m.norm, m.label, m.start, m.end, m.occurrences, snippet, EXTRACTOR, modelVersion, overlap,
        res.status, res.entityId, res.method, res.detail],
    }));
    stmts.push({
      sql: `INSERT OR IGNORE INTO ner_scans (raw_item_id, extractor, model_version, text_hash, text_length, truncated, mentions_raw, mentions_kept, dropped_json)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [r.id, EXTRACTOR, modelVersion, crypto.createHash('sha256').update(text).digest('hex').slice(0, 16), text.length,
        r.truncated ? 1 : 0, r.raw, r.kept.length, JSON.stringify(r.dropped)],
    });
    const out = await db.batch(stmts, 'write');
    out.forEach((o, i) => { if (i < stmts.length - 1) stats.inserted += o.rowsAffected; else stats.scansInserted += o.rowsAffected; });
  }

  console.log(JSON.stringify(stats, null, 2));
  if (DRY) {
    const dir = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `ner-dryrun-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(f, JSON.stringify({ modelVersion, stats, items: report }, null, 2));
    console.log(`Rapport: ${f}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
