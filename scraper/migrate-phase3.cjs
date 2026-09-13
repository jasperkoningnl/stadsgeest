const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function hasColumn(table, column) {
  return (await db.execute(`PRAGMA table_info(${table})`)).rows.some(row => row.name === column);
}

async function addColumn(table, definition) {
  const column = definition.split(/\s+/)[0];
  if (!(await hasColumn(table, column))) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function main() {
  await addColumn('sources', 'last_verified_at TEXT');
  await addColumn('sources', 'terms_checked_at TEXT');
  await addColumn('sources', 'owner_contact TEXT');
  await db.execute(`CREATE TABLE IF NOT EXISTS source_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    fetched_at TEXT NOT NULL,
    source_url TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    media_type TEXT,
    byte_length INTEGER NOT NULL,
    etag TEXT,
    last_modified TEXT,
    UNIQUE(source_id, content_hash)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_source_snapshots_source ON source_snapshots(source_id,fetched_at)');
  await db.execute(`CREATE TABLE IF NOT EXISTS statistical_baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    series_key TEXT NOT NULL,
    period TEXT NOT NULL,
    observed REAL NOT NULL,
    expected REAL,
    robust_z REAL,
    municipality_expected REAL,
    detector_version TEXT NOT NULL,
    explanation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id,series_key,period,detector_version)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS area_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    area_code TEXT NOT NULL,
    area_name TEXT NOT NULL,
    municipality_code TEXT NOT NULL,
    map_year INTEGER NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    source_url TEXT NOT NULL,
    UNIQUE(source_id,area_code,map_year)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS phase3_backtests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_name TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    months INTEGER NOT NULL,
    detector_version TEXT NOT NULL,
    input_count INTEGER NOT NULL,
    signal_count INTEGER NOT NULL,
    suppressed_count INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  console.log('Fase-3-migratie gereed');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
