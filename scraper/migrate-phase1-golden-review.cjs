const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS phase1_golden_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
      reference_name TEXT NOT NULL,
      identifier_type TEXT NOT NULL CHECK(identifier_type IN ('kvk','rsin','lei')),
      identifier_value TEXT NOT NULL,
      evidence_url TEXT NOT NULL,
      sample_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_phase1_golden_entity ON phase1_golden_candidates(reference_entity_id)');
    await db.execute(`CREATE TABLE IF NOT EXISTS phase1_golden_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE REFERENCES phase1_golden_candidates(id),
      verdict TEXT NOT NULL CHECK(verdict IN ('same','different','skipped')),
      actor TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await db.execute(`INSERT OR IGNORE INTO phase1_golden_candidates(
      reference_entity_id,reference_name,identifier_type,identifier_value,evidence_url,sample_key
    )
      SELECT ke.id,ke.canonical_name,ei.identifier_type,ei.value,ei.source_url,
        ei.identifier_type || ':' || ei.value
      FROM entity_identifiers ei JOIN kg_entities ke ON ke.id=ei.entity_id
      WHERE ke.entity_type='organization' AND ke.merged_into_id IS NULL
        AND ei.identifier_type IN ('kvk','rsin','lei')
        AND ei.source_url LIKE 'https://%'
      ORDER BY CASE ei.identifier_type WHEN 'kvk' THEN 0 WHEN 'rsin' THEN 1 ELSE 2 END,ke.id
      LIMIT 250`);

    const counts = (await db.execute(`SELECT
      (SELECT COUNT(*) FROM phase1_golden_candidates) candidates,
      (SELECT COUNT(*) FROM phase1_golden_reviews WHERE verdict IN ('same','different')) labeled,
      (SELECT COUNT(*) FROM phase1_golden_reviews WHERE verdict='skipped') skipped`)).rows[0];
    console.log(JSON.stringify({ migrated: true, candidates: Number(counts.candidates), labeled: Number(counts.labeled), skipped: Number(counts.skipped) }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
