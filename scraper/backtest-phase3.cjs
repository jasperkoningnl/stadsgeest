const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

function evaluateHistoricalClusters(rows, months = 24) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.signal_id)) groups.set(row.signal_id, { sources: new Set(), dates: [], status: row.status });
    const group = groups.get(row.signal_id); group.sources.add(Number(row.source_id));
    const stamp = Date.parse(row.published_at || row.scraped_at); if (Number.isFinite(stamp)) group.dates.push(stamp);
  }
  let candidates = 0, within90 = 0, retained = 0;
  const statuses = {};
  for (const group of groups.values()) {
    if (group.sources.size < 2) continue; candidates++;
    const span = group.dates.length ? (Math.max(...group.dates) - Math.min(...group.dates)) / 86400000 : Infinity;
    if (span > 90) continue; within90++; statuses[group.status] = (statuses[group.status] || 0) + 1;
    if (!['discarded', 'afgewezen'].includes(group.status)) retained++;
  }
  return { months, inputSignals: groups.size, candidates, within90, retained,
    retainedRate: within90 ? retained / within90 : null, statuses, threshold: 'minimaal 2 onafhankelijke bronnen binnen 90 dagen' };
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const to = new Date(); const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 24, 1));
  try {
    const result = await db.execute({ sql: `SELECT si.signal_id,ri.source_id,ri.published_at,ri.scraped_at,s.status
      FROM signal_items si JOIN raw_items ri ON ri.id=si.raw_item_id JOIN signals s ON s.id=si.signal_id
      WHERE COALESCE(ri.published_at,ri.scraped_at)>=? AND COALESCE(ri.published_at,ri.scraped_at)<?`,
      args: [from.toISOString(), to.toISOString()] });
    const metrics = evaluateHistoricalClusters(result.rows, 24);
    await db.execute({ sql: `INSERT INTO phase3_backtests(test_name,period_from,period_to,months,detector_version,input_count,signal_count,suppressed_count,metrics_json)
      VALUES ('eventclusters-r10',?,?,?,?,?,?,?,?)`, args: [from.toISOString(), to.toISOString(), 24, 'multi-source-1.0', metrics.inputSignals,
      metrics.within90, metrics.inputSignals - metrics.within90, JSON.stringify(metrics)] });
    console.log(JSON.stringify({ from: from.toISOString(), to: to.toISOString(), metrics }, null, 2));
  } finally { await db.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { evaluateHistoricalClusters };
