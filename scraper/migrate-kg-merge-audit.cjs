const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function migrate(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS entity_merge_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keep_entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    merged_entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    candidate_id INTEGER REFERENCES entity_merge_candidates(id),
    action TEXT NOT NULL CHECK(action IN ('merged','reversed')) DEFAULT 'merged',
    snapshot_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    merged_at TEXT NOT NULL DEFAULT (datetime('now')),
    reversed_at TEXT,
    reversed_by TEXT,
    reverse_reason TEXT
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entity_merge_audits_entities ON entity_merge_audits(keep_entity_id, merged_entity_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entity_merge_audits_action ON entity_merge_audits(action)');
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await migrate(db);
    console.log('Merge-audittabel aanwezig.');
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { migrate };
