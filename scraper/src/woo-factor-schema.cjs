'use strict';

// Additief, afzonderlijk uit te voeren; nooit migreren bij een paginaverzoek.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS woo_factor_cases (
    id TEXT PRIMARY KEY, dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
    analyse_json TEXT NOT NULL CHECK(json_valid(analyse_json)), analyse_hash TEXT NOT NULL,
    concept TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    besluit TEXT NOT NULL DEFAULT 'te_beoordelen' CHECK(besluit IN ('te_beoordelen','goedgekeurd','afgewezen')),
    decided_by TEXT, decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_woo_factor_dossier ON woo_factor_cases(dossier_id)',
  `CREATE TABLE IF NOT EXISTS woo_factor_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES woo_factor_cases(id),
    revision INTEGER NOT NULL, actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('analyse','opslaan','goedkeuren','afwijzen')),
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(case_id,revision)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_woo_factor_events_case ON woo_factor_events(case_id,id)',
]

async function migrate(db) {
  await db.batch(SCHEMA, 'write');
}

module.exports = { SCHEMA, migrate };
