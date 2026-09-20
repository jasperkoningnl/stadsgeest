const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const REQUIRED_TABLES = ['kg_entities','entity_identifiers','kg_aliases','locations','entity_locations','kg_relations','kg_events','event_entities','source_records','fetch_runs','entity_merge_candidates'];

async function scalar(db, sql, args = []) {
  return Number((await db.execute({ sql, args })).rows[0]?.n || 0);
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row => String(row.name)));
    const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table));
    const rawItems = await scalar(db, 'SELECT COUNT(*) n FROM raw_items');
    const signals = await scalar(db, 'SELECT COUNT(*) n FROM signals');
    const uniqueUrls = await scalar(db, 'SELECT COUNT(DISTINCT external_url) n FROM raw_items WHERE external_url IS NOT NULL');
    const duplicateUrlGroups = await scalar(db, `SELECT COUNT(*) n FROM (SELECT external_url FROM raw_items WHERE external_url IS NOT NULL GROUP BY external_url HAVING COUNT(*)>1)`);
    const fetchRuns = await scalar(db, 'SELECT COUNT(*) n FROM fetch_runs');
    const failedRuns = await scalar(db, "SELECT COUNT(*) n FROM fetch_runs WHERE status IN ('error','timeout','suspect')");
    const replayableRawRecords = await scalar(db, "SELECT COUNT(*) n FROM source_records WHERE raw_object IS NOT NULL AND length(raw_object)>2");
    const koopSourceId = Number((await db.execute({ sql: 'SELECT id FROM sources WHERE name=?', args: ['KOOP — niet-gemeentelijke officiële publicaties'] })).rows[0]?.id || 0);
    const koopDuplicateEvents = koopSourceId ? await scalar(db, `SELECT COUNT(*) n FROM (
      SELECT source_identifier FROM kg_events WHERE source_id=? AND source_identifier IS NOT NULL GROUP BY source_identifier HAVING COUNT(*)>1
    )`, [koopSourceId]) : -1;
    const koopDuplicateCurrentKeys = koopSourceId ? await scalar(db, `SELECT COUNT(*) n FROM (
      SELECT source_key,content_hash FROM source_records WHERE source_id=? AND source_key<>'__baseline_complete__'
      GROUP BY source_key,content_hash HAVING COUNT(*)>1
    )`, [koopSourceId]) : -1;
    const result = {
      status: missingTables.length === 0 && rawItems > 0 && signals > 0 && fetchRuns > 0 && replayableRawRecords > 0 &&
        koopDuplicateEvents === 0 && koopDuplicateCurrentKeys === 0 ? 'pass' : 'fail',
      originalBaseline: {
        measuredAt: '2026-09-04', rawItems: 8084, signals: 1717, entities: 4644,
        duplicateUrlGroups: 105, sources: 131,
        evidence: 'docs/HISTORY/STATUS-LEGACY-THROUGH-2026-09-12.md regels 6610–6642',
      },
      currentBaseline: {
        measuredAt: new Date().toISOString(), rawItems, signals, uniqueUrls, duplicateUrlGroups,
        duplicateUrlRate: uniqueUrls ? duplicateUrlGroups / uniqueUrls : 0,
        fetchRuns, failedRuns, parserFailureRate: fetchRuns ? failedRuns / fetchRuns : 0,
      },
      contracts: { requiredTables: REQUIRED_TABLES, missingTables, replayableRawRecords },
      koopDeduplication: { sourceId: koopSourceId || null, duplicateEvents: koopDuplicateEvents, duplicateSourceRecordVersions: koopDuplicateCurrentKeys },
    };
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'pass') process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
