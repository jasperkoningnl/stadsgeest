const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { EntityResolver } = require('./src/kg/entity-resolver.cjs');

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const counts = {};
    for (const table of ['kg_entities','entity_identifiers','kg_aliases','locations','entity_locations','kg_relations','manual_entity_seeds','entity_merge_audits','bag_match_exceptions']) {
      counts[table] = Number((await db.execute(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n);
    }
    const addressable = Number((await db.execute("SELECT COUNT(*) n FROM locations WHERE postal_code IS NOT NULL AND house_number IS NOT NULL")).rows[0].n);
    const bagMatched = Number((await db.execute("SELECT COUNT(*) n FROM locations WHERE bag_id IS NOT NULL AND bag_id<>''")).rows[0].n);
    const bagExceptions = Number((await db.execute(`SELECT COUNT(*) n FROM bag_match_exceptions b
      JOIN locations l ON l.id=b.location_id WHERE (l.bag_id IS NULL OR l.bag_id='')
      AND l.postal_code IS NOT NULL AND l.house_number IS NOT NULL`)).rows[0].n);
    const invalidSeeds = Number((await db.execute(`SELECT COUNT(*) n FROM manual_entity_seeds
      WHERE source_url NOT LIKE 'https://%' OR reason IS NULL OR length(reason)<20 OR review_due_at IS NULL`)).rows[0].n);
    const expiredSeeds = Number((await db.execute("SELECT COUNT(*) n FROM manual_entity_seeds WHERE review_due_at<date('now') AND reviewed_at IS NULL")).rows[0].n);
    const golden = (await db.execute(`SELECT c.reference_entity_id,c.reference_name,c.identifier_type,c.identifier_value,r.verdict
      FROM phase1_golden_candidates c JOIN phase1_golden_reviews r ON r.candidate_id=c.id
      WHERE r.verdict IN ('same','different') ORDER BY c.id`)).rows;
    let automatic = 0;
    let truePositive = 0;
    let falsePositive = 0;
    for (const item of golden) {
      const resolver = new EntityResolver({ db, dryRun: true });
      const result = await resolver.resolve({
        name: String(item.reference_name),
        entityType: 'organization',
        identifiers: [{ type: String(item.identifier_type), value: String(item.identifier_value) }],
      });
      if (result.action !== 'auto_merge') continue;
      automatic++;
      if (item.verdict === 'same' && Number(result.match?.entityId) === Number(item.reference_entity_id)) truePositive++;
      else falsePositive++;
    }
    const precision = automatic ? truePositive / automatic : null;
    const blockers = [];
    if (bagMatched + bagExceptions < addressable) blockers.push(`BAG-backfill onvolledig: ${bagMatched} exact, ${bagExceptions} beoordeeld, ${addressable} adresseerbaar`);
    if (golden.length < 200) blockers.push(`handmatig gelabelde organisatie-golden-set: ${golden.length}/200`);
    if (golden.length >= 200 && precision < 0.98) blockers.push(`auto-mergeprecision ${precision}`);
    if (invalidSeeds || expiredSeeds) blockers.push(`seedprovenance ongeldig/verlopen: ${invalidSeeds}/${expiredSeeds}`);
    const result = {
      status: blockers.length ? 'open' : 'pass', counts,
      bag: { addressableLocations: addressable, matchedLocations: bagMatched, reviewedExceptions: bagExceptions,
        completed: bagMatched + bagExceptions === addressable, coverage: addressable ? bagMatched / addressable : null },
      manualSeeds: { total: counts.manual_entity_seeds, invalid: invalidSeeds, expired: expiredSeeds },
      mergeSafety: { auditTable: true, reversibleOfflineTest: '__tests__/entity-resolution/reversible-merge.test.cjs' },
      goldenSet: { source: 'phase1_golden_reviews', labeled: golden.length, automatic, truePositive, falsePositive, precision },
      blockers,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
