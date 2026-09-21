const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const EXCEPTIONS = [
  { locationId: 9, reason: 'Huisnummerbereik 29-31 verwijst niet naar één exact BAG-adres.' },
  { locationId: 57, reason: 'Postcode en huisnummer 2 leveren geen exact BAG-adres op.' },
  { locationId: 68, reason: 'Alleen 4A t/m 4E bestaan; basisnummer 4 is niet eenduidig.' },
];

async function migrate(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS bag_match_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL UNIQUE REFERENCES locations(id),
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    reviewed_by TEXT NOT NULL
  )`);
  for (const item of EXCEPTIONS) await db.execute({
    sql: `INSERT INTO bag_match_exceptions(location_id,reason,source,reviewed_at,reviewed_by)
      VALUES (?,?,?,datetime('now'),'Codex met expliciete toestemming Jasper')
      ON CONFLICT(location_id) DO UPDATE SET reason=excluded.reason,source=excluded.source,
        reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by`,
    args: [item.locationId, item.reason, 'PDOK Locatieserver v3_1 exact-matchcontrole'],
  });
  return { recorded: EXCEPTIONS.length };
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try { console.log(JSON.stringify(await migrate(db), null, 2)); }
  finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { EXCEPTIONS, migrate };
