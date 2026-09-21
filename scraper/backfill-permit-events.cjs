const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { backfillPermitEvents } = require('./src/kg/permit-backfill.cjs');

async function main() {
  const apply = process.argv.includes('--apply');
  const rawLimit = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const limit = rawLimit ? Number(rawLimit) : 5000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit moet tussen 1 en 10000 liggen.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try { console.log(JSON.stringify(await backfillPermitEvents(db, { apply, limit }), null, 2)); }
  finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
