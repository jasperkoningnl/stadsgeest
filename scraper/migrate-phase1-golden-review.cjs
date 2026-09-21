const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function addColumn(db, table, name, definition) {
  const columns = (await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => String(row.name));
  if (!columns.includes(name)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

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
      candidate_name TEXT,
      candidate_place TEXT,
      source_label TEXT,
      dataset_version INTEGER NOT NULL DEFAULT 3,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await addColumn(db, 'phase1_golden_candidates', 'candidate_name', 'TEXT');
    await addColumn(db, 'phase1_golden_candidates', 'candidate_place', 'TEXT');
    await addColumn(db, 'phase1_golden_candidates', 'source_label', 'TEXT');
    await addColumn(db, 'phase1_golden_candidates', 'dataset_version', 'INTEGER NOT NULL DEFAULT 1');
    await addColumn(db, 'phase1_golden_candidates', 'active', 'INTEGER NOT NULL DEFAULT 1');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_phase1_golden_entity ON phase1_golden_candidates(reference_entity_id)');
    await db.execute(`CREATE TABLE IF NOT EXISTS phase1_golden_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL UNIQUE REFERENCES phase1_golden_candidates(id),
      verdict TEXT NOT NULL CHECK(verdict IN ('same','different','skipped')),
      actor TEXT NOT NULL,
      request_id TEXT NOT NULL UNIQUE,
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await db.execute('UPDATE phase1_golden_candidates SET active=0 WHERE dataset_version<3');
    await db.execute(`INSERT OR IGNORE INTO phase1_golden_candidates(
      reference_entity_id,reference_name,identifier_type,identifier_value,evidence_url,sample_key,
      candidate_name,candidate_place,source_label,dataset_version,active)
      SELECT ke.id,ke.canonical_name,'kvk',ei.value,
        CASE WHEN ei.source_url LIKE 'https://%' THEN ei.source_url ELSE 'https://www.kvk.nl/zoeken/' END,
        'v3:alias:' || ka.id || ':' || ei.value,ka.alias,NULL,
        CASE WHEN ka.source='handmatige seed' THEN 'Handmatig vastgelegde naamvariant'
          ELSE 'Naamvariant uit de bestaande database' END,3,1
      FROM kg_aliases ka JOIN kg_entities ke ON ke.id=ka.entity_id
      JOIN entity_identifiers ei ON ei.entity_id=ke.id AND ei.identifier_type='kvk'
      WHERE ke.entity_type='organization' AND ke.merged_into_id IS NULL
        AND ka.normalized_alias<>ke.normalized_name
      ORDER BY ke.id,ka.id LIMIT 250`);
    await db.execute(`UPDATE phase1_golden_candidates SET evidence_url='https://www.kvk.nl/zoeken/'
      WHERE active=1 AND dataset_version=3 AND evidence_url NOT LIKE 'https://%'`);

    const counts = (await db.execute(`SELECT
      (SELECT COUNT(*) FROM phase1_golden_candidates WHERE active=1 AND dataset_version=3) candidates,
      (SELECT COUNT(*) FROM phase1_golden_reviews r JOIN phase1_golden_candidates c ON c.id=r.candidate_id
        WHERE c.active=1 AND c.dataset_version=3 AND r.verdict IN ('same','different')) labeled,
      (SELECT COUNT(*) FROM phase1_golden_reviews r JOIN phase1_golden_candidates c ON c.id=r.candidate_id
        WHERE c.active=1 AND c.dataset_version=3 AND r.verdict='skipped') skipped`)).rows[0];
    console.log(JSON.stringify({ migrated: true, candidates: Number(counts.candidates), labeled: Number(counts.labeled), skipped: Number(counts.skipped) }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
