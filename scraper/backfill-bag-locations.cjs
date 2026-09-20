const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { backfillBagLocations } = require('./src/kg/bag-locations.cjs');

async function main() {
  const apply = process.argv.includes('--apply');
  const rawLimit = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const limit = rawLimit ? Number(rawLimit) : 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('--limit moet tussen 1 en 5000 liggen.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    console.log(JSON.stringify(await backfillBagLocations(db, { apply, limit }), null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
