// Handmatige controle van NER-koppelingen zonder dashboard (2026-09-24).
//
//   node src/ner-review.cjs export [--n 60] [--out pad.csv]
//     Schrijft een steekproef van KG-kandidaten (personen en organisaties, één per
//     vorm) naar een CSV voor Excel (puntkomma, UTF-8 met BOM). Vul kolom 'oordeel'
//     met ja (juiste koppeling), nee (onjuist) of laat leeg.
//   node src/ner-review.cjs import pad.csv [--apply]
//     Zonder --apply alleen tellen. Met --apply: ja -> confirmed, nee -> rejected,
//     alleen voor rijen die nog niet beoordeeld zijn. Raakt de KG niet aan.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const cell = (v) => `"${String(v ?? '').replace(/\s+/g, ' ').replace(/"/g, '""')}"`;

async function exportSample() {
  const n = parseInt(arg('--n', '60'), 10);
  const out = arg('--out', path.join(__dirname, '..', 'tmp', `ner-review-${new Date().toISOString().slice(0, 10)}.csv`));
  // Eén vermelding per (entiteit, vorm), willekeurig; helft personen, helft organisaties.
  const pick = async (type, k) => (await db.execute({
    sql: `SELECT dm.id, dm.entity_type, dm.mention_text, ke.canonical_name, s.name AS bron, r.title, dm.context_snippet
          FROM document_mentions dm
          JOIN kg_entities ke ON ke.id = dm.resolved_entity_id
          JOIN raw_items r ON r.id = dm.raw_item_id
          JOIN sources s ON s.id = r.source_id
          WHERE dm.resolution_status = 'candidate' AND dm.reviewed_at IS NULL AND dm.entity_type = ?
            AND dm.id IN (SELECT MIN(id) FROM document_mentions WHERE resolution_status = 'candidate'
                          GROUP BY resolved_entity_id, normalized_text)
          ORDER BY random() LIMIT ?`,
    args: [type, k],
  })).rows;
  const rows = [...await pick('person', Math.ceil(n / 2)), ...await pick('organization', Math.floor(n / 2))];
  const lines = ['mention_id;type;vermelding;kg_naam;bron;titel;context;oordeel'];
  for (const r of rows) {
    lines.push([r.id, r.entity_type, r.mention_text, r.canonical_name, r.bron, String(r.title || '').slice(0, 120), r.context_snippet, ''].map(cell).join(';'));
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`${rows.length} regels geschreven naar ${out}`);
}

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const t = text.replace(/^\uFEFF/, '');
  // Scheidingsteken uit de kopregel: Excel NL bewaart met ;, andere instellingen met ,
  const first = t.split(/\r?\n/)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function importReview(file) {
  const apply = process.argv.includes('--apply');
  const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  const iId = head.indexOf('mention_id'), iO = head.indexOf('oordeel');
  if (iId < 0 || iO < 0) throw new Error('Kolommen mention_id en oordeel niet gevonden');
  const stats = { ja: 0, nee: 0, leeg: 0, onbekend: 0, bijgewerkt: 0 };
  for (const r of rows) {
    const o = String(r[iO] || '').trim().toLowerCase();
    const status = o === 'ja' ? 'confirmed' : o === 'nee' ? 'rejected' : null;
    if (!o) { stats.leeg++; continue; }
    if (!status) { stats.onbekend++; continue; }
    stats[o]++;
    if (!apply) continue;
    const res = await db.execute({
      sql: `UPDATE document_mentions SET resolution_status = ?, reviewed_by = 'redactie', reviewed_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ? AND reviewed_at IS NULL`,
      args: [status, parseInt(r[iId], 10)],
    });
    stats.bijgewerkt += res.rowsAffected;
  }
  const beoordeeld = stats.ja + stats.nee;
  console.log(JSON.stringify({ ...stats, precisie: beoordeeld ? `${Math.round((100 * stats.ja) / beoordeeld)}%` : null, modus: apply ? 'apply' : 'alleen tellen' }, null, 2));
}

const cmd = process.argv[2];
(cmd === 'export' ? exportSample() : cmd === 'import' ? importReview(process.argv[3]) : Promise.reject(new Error('Gebruik: export | import <csv> [--apply]')))
  .catch((e) => { console.error(e.message); process.exit(1); });
