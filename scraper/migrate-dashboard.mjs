/**
 * migrate-dashboard.mjs — Stadsgeest dashboard-migratie (stap 1)
 *
 * Maakt de tabellen aan voor procesgeheugen: scrape_runs, intake_runs,
 * intake_decisions, signal_events, job_requests, job_logs, press_releases.
 * Voegt daarnaast een aantal kolommen toe aan de bestaande signals-tabel.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS voor tabellen, PRAGMA table_info
 * check voor ALTER TABLE ... ADD COLUMN. Raakt nooit bestaande data aan.
 *
 * Run: node scraper/migrate-dashboard.mjs
 */

import db from './src/db.js';

const TABLE_STATEMENTS = [
  {
    name: 'scrape_runs',
    sql: `CREATE TABLE IF NOT EXISTS scrape_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT,
      scraper_file TEXT,
      source_id INTEGER REFERENCES sources(id),
      source_name TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      items_found INTEGER DEFAULT 0,
      items_new INTEGER DEFAULT 0,
      items_duplicate INTEGER DEFAULT 0,
      items_error INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    )`,
  },
  {
    name: 'intake_runs',
    sql: `CREATE TABLE IF NOT EXISTS intake_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      items_in INTEGER DEFAULT 0,
      items_filtered INTEGER DEFAULT 0,
      items_matched INTEGER DEFAULT 0,
      signals_created INTEGER DEFAULT 0,
      signals_historical INTEGER DEFAULT 0,
      thresholds_reached INTEGER DEFAULT 0,
      entities_created INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    )`,
  },
  {
    name: 'intake_decisions',
    sql: `CREATE TABLE IF NOT EXISTS intake_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      intake_run_id INTEGER NOT NULL REFERENCES intake_runs(id),
      raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
      source_id INTEGER REFERENCES sources(id),
      source_name TEXT,
      item_title TEXT,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      signal_id INTEGER REFERENCES signals(id),
      match_score INTEGER,
      tier INTEGER,
      entities_found TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    name: 'signal_events',
    sql: `CREATE TABLE IF NOT EXISTS signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER NOT NULL REFERENCES signals(id),
      actor TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status_from TEXT,
      status_to TEXT,
      reason TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    name: 'job_requests',
    sql: `CREATE TABLE IF NOT EXISTS job_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      signal_id INTEGER REFERENCES signals(id),
      params TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      requested_by TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      result_id INTEGER,
      error_message TEXT
    )`,
  },
  {
    name: 'job_logs',
    sql: `CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES job_requests(id),
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL
    )`,
  },
  {
    name: 'press_releases',
    sql: `CREATE TABLE IF NOT EXISTS press_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER NOT NULL REFERENCES signals(id),
      job_id INTEGER REFERENCES job_requests(id),
      headline TEXT,
      lead TEXT,
      body TEXT,
      facts TEXT,
      open_questions TEXT,
      sources TEXT,
      status TEXT DEFAULT 'concept',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_scrape_runs_started ON scrape_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scrape_runs_source ON scrape_runs(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_decisions_run ON intake_decisions(intake_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_intake_decisions_signal ON intake_decisions(signal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_signal_events_signal ON signal_events(signal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_signal_events_created ON signal_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id)`,
];

const SIGNAL_COLUMNS = [
  { name: 'novelty_score', ddl: 'INTEGER' },
  { name: 'tier', ddl: 'INTEGER' },
  { name: 'category', ddl: 'TEXT' },
  { name: 'decision_reason', ddl: 'TEXT' },
  { name: 'editor_flag', ddl: 'TEXT' },
];

async function tableExists(name) {
  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function columnExists(table, column) {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => r.name === column);
}

async function migrate() {
  console.log(`\n=== Stadsgeest dashboard-migratie: ${new Date().toISOString()} ===\n`);

  const createdTables = [];
  const existingTables = [];

  for (const table of TABLE_STATEMENTS) {
    const alreadyThere = await tableExists(table.name);
    await db.execute(table.sql);
    if (alreadyThere) existingTables.push(table.name);
    else createdTables.push(table.name);
  }

  for (const indexSql of INDEX_STATEMENTS) {
    await db.execute(indexSql);
  }

  const addedColumns = [];
  const existingColumns = [];

  for (const col of SIGNAL_COLUMNS) {
    const has = await columnExists('signals', col.name);
    if (has) {
      existingColumns.push(col.name);
      continue;
    }
    await db.execute(`ALTER TABLE signals ADD COLUMN ${col.name} ${col.ddl}`);
    addedColumns.push(col.name);
  }

  console.log('Tabellen aangemaakt:', createdTables.length ? createdTables.join(', ') : '(geen)');
  console.log('Tabellen bestonden al:', existingTables.length ? existingTables.join(', ') : '(geen)');
  console.log('Kolommen toegevoegd aan signals:', addedColumns.length ? addedColumns.join(', ') : '(geen)');
  console.log('Kolommen bestonden al op signals:', existingColumns.length ? existingColumns.join(', ') : '(geen)');
  console.log(`\n=== Migratie voltooid: ${new Date().toISOString()} ===\n`);
}

migrate().catch((e) => {
  console.error('MIGRATIE FOUT:', e.message);
  process.exit(1);
});
