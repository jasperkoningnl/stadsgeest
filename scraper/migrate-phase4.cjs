const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  await db.execute(`CREATE TABLE IF NOT EXISTS phase4_backtests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_name TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    detector_version TEXT NOT NULL,
    input_count INTEGER NOT NULL,
    signal_count INTEGER NOT NULL,
    suppressed_count INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(test_name,period_from,period_to,detector_version)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS phase4_source_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    official_url TEXT NOT NULL,
    terms_status TEXT NOT NULL,
    route_status TEXT NOT NULL,
    local_count INTEGER,
    national_count INTEGER,
    details_json TEXT NOT NULL,
    UNIQUE(source_name,checked_at)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_phase4_audits_source ON phase4_source_audits(source_name,checked_at)');
  console.log('Fase-4-migratie gereed');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
