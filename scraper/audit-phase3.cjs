const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { fetchBuffer, normalizeText } = require('./src/kg/phase3-core.cjs');
const { PUBLICATIONS, SRU, parseSru } = require('./src/kg/adapters/koop-nonmunicipal.cjs');

async function auditKoop(db, fetchImpl = fetch) {
  const results = [];
  for (const publication of PUBLICATIONS) {
    const query = `c.product-area==officielepublicaties AND w.publicatienaam=="${publication}" AND cql.textAndIndexes any "Amersfoort Leusden"`;
    const url = `${SRU}?operation=searchRetrieve&version=2.0&maximumRecords=100&startRecord=1&query=${encodeURIComponent(query)}`;
    const fetched = await fetchBuffer(url, { fetchImpl, label: `KOOP-audit ${publication}`, accept: 'application/xml', timeoutMs: 60_000 });
    const records = parseSru(fetched.buffer.toString('utf8'), publication).slice(0, 100);
    let covered = 0;
    for (const record of records) {
      const identifier = normalizeText(record.identifier);
      const found = await db.execute({
        sql: `SELECT id FROM raw_items WHERE external_url=? OR external_url LIKE ? OR external_url LIKE ? LIMIT 1`,
        args: [record.sourceUrl, `%/${identifier}.html%`, `%${identifier}%`],
      });
      if (found.rows.length) covered++;
    }
    results.push({ publication, sampled: records.length, covered, coverage: records.length ? covered / records.length : null });
  }
  const total = results.reduce((sum, item) => sum + item.sampled, 0);
  const covered = results.reduce((sum, item) => sum + item.covered, 0);
  return { checkedAt: new Date().toISOString(), results, total, covered, coverage: total ? covered / total : null,
    decision: results.every(item => item.sampled > 0 && item.coverage >= 0.95) ? 'extend-existing' : 'new-sru-adapter' };
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try { console.log(JSON.stringify({ koop: await auditKoop(db) }, null, 2)); }
  finally { await db.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { auditKoop };
