// Eenmalig script: markeer onterechte R3/R7 signalen als 'discarded'
// R3: kwamen via plaatsnaam-fallback, niet via graph-route
// R7: bevatten storingen uit Putten/Almere door te breed postcodefilter
// Gebruik: node opruim-signalen.cjs

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

(async () => {
  // Eerst tellen wat er is
  const count = await db.execute({
    sql: `SELECT detection_rule, status, COUNT(*) as cnt
          FROM signals
          WHERE detection_rule IN (?, ?)
          GROUP BY detection_rule, status`,
    args: ['R3', 'R7'],
  });
  console.log('Huidige verdeling:');
  for (const row of count.rows) {
    console.log(`  ${row.detection_rule}: ${row.cnt}x status="${row.status}"`);
  }

  // Markeer als discarded
  const result = await db.execute({
    sql: `UPDATE signals SET status = ? WHERE detection_rule IN (?, ?) AND status != ?`,
    args: ['discarded', 'R3', 'R7', 'discarded'],
  });
  console.log(`\n${result.rowsAffected} signalen naar 'discarded' gezet`);

  // Bevestig
  const after = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM signals WHERE detection_rule IN (?, ?) AND status != ?`,
    args: ['R3', 'R7', 'discarded'],
  });
  console.log(`Resterend niet-discarded: ${after.rows[0].cnt}`);
})();
