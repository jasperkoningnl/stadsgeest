const fs = require('node:fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { EntityResolver } = require('./src/kg/entity-resolver.cjs');

const GOLDEN_SET = path.join(__dirname, 'data', 'phase1-golden-set.json');

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const counts = {};
    for (const table of ['kg_entities','entity_identifiers','kg_aliases','locations','entity_locations','kg_relations','manual_entity_seeds','entity_merge_audits']) {
      counts[table] = Number((await db.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n);
    }
    const addressable = Number((await db.execute("SELECT COUNT(*) n FROM locations WHERE postal_code IS NOT NULL AND house_number IS NOT NULL")).rows[0].n);
    const bagMatched = Number((await db.execute("SELECT COUNT(*) n FROM locations WHERE bag_id IS NOT NULL AND bag_id<>''")).rows[0].n);
    const invalidSeeds = Number((await db.execute(`SELECT COUNT(*) n FROM manual_entity_seeds
      WHERE source_url NOT LIKE 'https://%' OR reason IS NULL OR length(reason)<20 OR review_due_at IS NULL`)).rows[0].n);
    const expiredSeeds = Number((await db.execute("SELECT COUNT(*) n FROM manual_entity_seeds WHERE review_due_at<date('now') AND reviewed_at IS NULL")).rows[0].n);
    const golden = fs.existsSync(GOLDEN_SET) ? JSON.parse(fs.readFileSync(GOLDEN_SET, 'utf8')) : [];
    let automatic = 0;
    let truePositive = 0;
    let falsePositive = 0;
    for (const item of golden) {
      const resolver = new EntityResolver({ db, dryRun: true });
      const result = await resolver.resolve(item.candidate);
      if (result.action !== 'auto_merge') continue;
      automatic++;
      if (Number(result.match?.entityId) === Number(item.expectedEntityId)) truePositive++;
      else falsePositive++;
    }
    const precision = automatic ? truePositive / automatic : null;
    const blockers = [];
    if (bagMatched === 0 || bagMatched < addressable) blockers.push(`BAG-backfill onvolledig: ${bagMatched}/${addressable} adresseerbare locaties`);
    if (golden.length < 200) blockers.push(`handmatig gelabelde organisatie-golden-set: ${golden.length}/200`);
    if (golden.length >= 200 && precision < 0.98) blockers.push(`auto-mergeprecision ${precision}`);
    if (invalidSeeds || expiredSeeds) blockers.push(`seedprovenance ongeldig/verlopen: ${invalidSeeds}/${expiredSeeds}`);
    const result = {
      status: blockers.length ? 'open' : 'pass', counts,
      bag: { addressableLocations: addressable, matchedLocations: bagMatched, coverage: addressable ? bagMatched / addressable : null },
      manualSeeds: { total: counts.manual_entity_seeds, invalid: invalidSeeds, expired: expiredSeeds },
      mergeSafety: { auditTable: true, reversibleOfflineTest: '__tests__/entity-resolution/reversible-merge.test.cjs' },
      goldenSet: { path: fs.existsSync(GOLDEN_SET) ? GOLDEN_SET : null, labeled: golden.length, automatic, truePositive, falsePositive, precision },
      blockers,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
