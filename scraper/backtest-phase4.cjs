const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const REQUIRED = [
  { name: 'zorg-r15', from: 2023, to: 2024 },
  { name: 'dpi-r16', from: 2024, to: 2025 },
];

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const report = [];
    for (const expected of REQUIRED) {
      const result = await db.execute({ sql: `SELECT * FROM phase4_backtests WHERE test_name=? ORDER BY created_at DESC LIMIT 1`, args: [expected.name] });
      const row = result.rows[0];
      if (!row) throw new Error(`Backtest ontbreekt: ${expected.name}`);
      if (Number(row.period_from) > expected.from || Number(row.period_to) < expected.to) throw new Error(`Backtestperiode te kort: ${expected.name}`);
      if (Number(row.input_count) < 1) throw new Error(`Backtest zonder vergelijkbare invoer: ${expected.name}`);
      report.push({ test: row.test_name, period: `${row.period_from}-${row.period_to}`, input: Number(row.input_count), signals: Number(row.signal_count), suppressed: Number(row.suppressed_count), version: row.detector_version });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { REQUIRED };
