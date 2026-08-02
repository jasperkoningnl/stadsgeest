// Entiteit-gedreven extractie (P1, 2026-08-02).
// Scant raw_items (title+summary+content+full_text) tegen person_aliases/org_aliases
// + regex voor ECLI en KvK-nummers. Schrijft entities, entity_mentions en entity_signals.
// Draait incrementeel: alleen items met entities_scanned_at IS NULL.
// Aanroep: node src/extract-entities.cjs [--limit N]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const isWord = (c) => /[a-z0-9]/.test(c || '');

function findAlias(normText, rawText, alias) {
  // woordgrens-veilige zoektocht; cs = hoofdlettergevoelig in de originele tekst
  const hay = alias.match_mode === 'cs' ? rawText : normText;
  const needle = alias.match_mode === 'cs' ? alias.alias : alias.normalized_alias;
  let from = 0;
  while (true) {
    const i = hay.indexOf(needle, from);
    if (i === -1) return -1;
    const before = hay[i - 1], after = hay[i + needle.length];
    if (!isWord(before) && !isWord(after)) return i;
    from = i + 1;
  }
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : 100000;

  const cols = (await db.execute("PRAGMA table_info(raw_items)")).rows.map(r => r.name);
  if (!cols.includes('entities_scanned_at')) {
    await db.execute("ALTER TABLE raw_items ADD COLUMN entities_scanned_at TEXT");
    console.log('Kolom entities_scanned_at toegevoegd.');
  }

  const pAliases = (await db.execute("SELECT pa.person_id, pa.alias, pa.normalized_alias, pa.match_mode, p.name FROM person_aliases pa JOIN persons p ON p.id = pa.person_id")).rows;
  const oAliases = (await db.execute("SELECT oa.organization_id, oa.alias, oa.normalized_alias, 'ci' AS match_mode, o.name FROM org_aliases oa JOIN organizations o ON o.id = oa.organization_id")).rows;
  console.log(`Aliassen geladen: ${pAliases.length} persoon, ${oAliases.length} organisatie.`);

  const items = (await db.execute({ sql: "SELECT id, title, summary, content, full_text FROM raw_items WHERE entities_scanned_at IS NULL ORDER BY id LIMIT ?", args: [limit] })).rows;
  console.log(`Te scannen items: ${items.length}`);

  let entIns = 0, menIns = 0, sigIns = 0, itemsMetMatch = 0;
  for (const it of items) {
    const raw = [it.title, it.summary, it.content, it.full_text].filter(Boolean).join('\n');
    const normText = norm(raw);
    const found = new Map(); // key: type|normname -> {type,name,personId,orgId,idx}

    for (const a of pAliases) {
      const i = findAlias(normText, raw, a);
      if (i > -1) {
        const k = 'person|' + norm(a.name);
        if (!found.has(k) || i < found.get(k).idx) found.set(k, { type: 'person', name: a.name, personId: a.person_id, orgId: null, idx: i });
      }
    }
    for (const a of oAliases) {
      const i = findAlias(normText, raw, a);
      if (i > -1) {
        const k = 'organization|' + norm(a.name);
        if (!found.has(k) || i < found.get(k).idx) found.set(k, { type: 'organization', name: a.name, personId: null, orgId: a.organization_id, idx: i });
      }
    }
    for (const m of raw.matchAll(/ECLI:[A-Z]{2}:[A-Z0-9]+:\d{4}:\d+/g)) {
      found.set('legal_ref|' + m[0].toLowerCase(), { type: 'legal_ref', name: m[0], personId: null, orgId: null, idx: m.index });
    }
    for (const m of raw.matchAll(/\bkvk(?:-?nummer)?[:\s]+(\d{8})\b/gi)) {
      found.set('kvk_number|' + m[1], { type: 'kvk_number', name: m[1], personId: null, orgId: null, idx: m.index });
    }

    if (found.size > 0) itemsMetMatch++;
    for (const f of found.values()) {
      const snippet = raw.substring(Math.max(0, f.idx - 60), f.idx + 90).replace(/\s+/g, ' ').trim();
      const ex = await db.execute({ sql: "SELECT id FROM entities WHERE raw_item_id=? AND normalized_name=? AND entity_type=?", args: [it.id, norm(f.name), f.type] });
      let eid;
      if (ex.rows.length) {
        eid = ex.rows[0].id;
        if (f.personId || f.orgId) await db.execute({ sql: "UPDATE entities SET person_id=COALESCE(person_id,?), organization_id=COALESCE(organization_id,?) WHERE id=?", args: [f.personId, f.orgId, eid] });
      } else {
        const r = await db.execute({ sql: "INSERT INTO entities (raw_item_id, entity_type, name, normalized_name, context, person_id, organization_id) VALUES (?,?,?,?,?,?,?)", args: [it.id, f.type, f.name, norm(f.name), snippet, f.personId, f.orgId] });
        eid = Number(r.lastInsertRowid); entIns++;
      }
      const mr = await db.execute({ sql: "INSERT OR IGNORE INTO entity_mentions (entity_id, raw_item_id, context_snippet, matched_via) VALUES (?,?,?,?)", args: [eid, it.id, snippet, f.type === 'legal_ref' || f.type === 'kvk_number' ? 'regex' : 'alias'] });
      menIns += mr.rowsAffected || 0;
      const sr = await db.execute({ sql: "INSERT OR IGNORE INTO entity_signals (entity_id, signal_id) SELECT ?, si.signal_id FROM signal_items si WHERE si.raw_item_id = ?", args: [eid, it.id] });
      sigIns += sr.rowsAffected || 0;
    }
    await db.execute({ sql: "UPDATE raw_items SET entities_scanned_at = datetime('now') WHERE id=?", args: [it.id] });
  }
  console.log(`Klaar. Items gescand: ${items.length}, met match: ${itemsMetMatch}. Nieuwe entities: ${entIns}, mentions: ${menIns}, entity_signals: ${sigIns}.`);
}
main().catch(e => { console.error(e); process.exit(1); });
