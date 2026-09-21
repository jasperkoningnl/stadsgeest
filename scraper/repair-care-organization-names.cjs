const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

function normalizeName(value) {
  return String(value).toLocaleLowerCase('nl-NL').replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function sourceYear(record) {
  return Number(/^care:(20\d{2}):/.exec(String(record.sourceKey))?.[1] || 0);
}

async function authoritativeCareNames(db) {
  const rows = (await db.execute({
    sql: `SELECT sr.source_key,sr.raw_object FROM source_records sr JOIN sources s ON s.id=sr.source_id
      WHERE s.name=?`,
    args: ['Jaarverantwoording Zorg — openbare datasets'],
  })).rows;
  const byKvk = new Map();
  for (const row of rows) {
    try {
      const record = JSON.parse(String(row.raw_object));
      const data = record.data || {};
      const kvk = String(data.kvknummer_externalorganizationid || '').replace(/\D/g, '');
      const name = String(data.naam_name || '').trim();
      const place = String(data.plaats_town || '').trim();
      const year = sourceYear({ sourceKey: row.source_key });
      if (kvk && name && (!byKvk.has(kvk) || year > byKvk.get(kvk).year)) byKvk.set(kvk, { name, place, year });
    } catch {}
  }
  return byKvk;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const names = await authoritativeCareNames(db);
    const identifiers = (await db.execute(`SELECT ei.entity_id,ei.value,ke.canonical_name,ke.source_org_id
      FROM entity_identifiers ei JOIN kg_entities ke ON ke.id=ei.entity_id
      WHERE ei.identifier_type='kvk' AND ei.source_url LIKE '%jaarverantwoordingzorg.nl%'
        AND ke.merged_into_id IS NULL`)).rows;
    const changes = [];
    for (const row of identifiers) {
      const official = names.get(String(row.value));
      if (!official || row.source_org_id !== null || String(row.canonical_name) === official.name) continue;
      changes.push({ sql: `UPDATE kg_entities SET canonical_name=?,normalized_name=?,updated_at=datetime('now') WHERE id=?`,
        args: [official.name, normalizeName(official.name), Number(row.entity_id)] });
    }
    if (apply && changes.length) await db.batch(changes, 'write');
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: changes.length,
      repaired: apply ? changes.length : 0, authoritativeNames: names.size }, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { authoritativeCareNames, main, normalizeName, sourceYear };
