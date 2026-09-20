const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const SEEDS = [
  {
    name: 'DierenPark Amersfoort', website: 'dierenparkamersfoort.nl',
    sourceUrl: 'https://dierenparkamersfoort.nl/contact/',
    aliases: ['Dierenpark Amersfoort', 'Amersfoortse Dierenpark'],
    reason: 'Redactioneel belangrijke lokale publieksorganisatie en grote werkgever.',
  },
  {
    name: 'Flint Theater', website: 'flint.nl',
    sourceUrl: 'https://flint.nl/jouw-bezoek/contact-openingstijden/',
    aliases: ['De Flint', 'Flint', 'Theater De Flint'],
    reason: 'Redactioneel belangrijk lokaal podium.',
  },
  {
    name: 'FLUOR', website: 'fluor033.nl', sourceUrl: 'https://fluor033.nl/',
    aliases: ['Poppodium FLUOR', 'Fluor Amersfoort'],
    reason: 'Redactioneel belangrijk lokaal poppodium.',
  },
  {
    name: 'De Lieve Vrouw', website: 'lievevrouw.nl', sourceUrl: 'https://lievevrouw.nl/english',
    aliases: ['Theater De Lieve Vrouw', 'Filmtheater De Lieve Vrouw'],
    reason: 'Redactioneel belangrijk lokaal film- en theaterpodium.',
  },
  {
    name: 'Festival Spoffin', website: 'spoffin.nl', sourceUrl: 'https://www.spoffin.nl/',
    aliases: ['Spoffin', 'Spoffin Spin-Off', 'Stichting Zomertheater Amersfoort'],
    reason: 'Groot terugkerend lokaal festival.',
  },
  {
    name: 'Dias Latinos', website: 'diaslatinos.nl', sourceUrl: 'https://www.diaslatinos.nl/',
    aliases: ['Festival Dias Latinos', 'Dias Latinos Festival'],
    reason: 'Groot terugkerend lokaal festival.',
  },
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

async function migrate(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS manual_entity_seeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    source_url TEXT NOT NULL,
    reason TEXT NOT NULL,
    seeded_at TEXT NOT NULL,
    review_due_at TEXT NOT NULL,
    reviewed_at TEXT,
    notes TEXT,
    UNIQUE(entity_id, source_url)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_manual_entity_seeds_review ON manual_entity_seeds(review_due_at, reviewed_at)');
  // Herstel de aantoonbaar foutieve oude Flint-domeinseed.
  await db.execute({
    sql: `UPDATE entity_identifiers SET value='flint.nl',source_url=? WHERE identifier_type='website' AND value='flfrn.nl'`,
    args: ['https://flint.nl/jouw-bezoek/contact-openingstijden/'],
  });
  const city = (await db.execute("SELECT id FROM locations WHERE lower(city)='amersfoort' ORDER BY CASE WHEN street IS NULL THEN 0 ELSE 1 END,id LIMIT 1")).rows[0];
  if (!city) throw new Error('Stadslocatie Amersfoort ontbreekt.');
  const seededAt = '2026-09-20';
  const reviewDueAt = '2027-03-20';
  let created = 0;
  for (const seed of SEEDS) {
    let entity = (await db.execute({
      sql: `SELECT id FROM kg_entities WHERE entity_type='organization' AND normalized_name=? AND merged_into_id IS NULL ORDER BY id LIMIT 1`,
      args: [normalize(seed.name)],
    })).rows[0];
    if (!entity) {
      const inserted = await db.execute({
        sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization',?,?)`,
        args: [seed.name, normalize(seed.name)],
      });
      entity = { id: Number(inserted.lastInsertRowid) };
      created++;
    }
    await db.execute({
      sql: `INSERT OR IGNORE INTO entity_identifiers(entity_id,identifier_type,value,source_url,verified_at)
            VALUES (?,'website',?,?,datetime('now'))`,
      args: [entity.id, seed.website, seed.sourceUrl],
    });
    for (const alias of seed.aliases) await db.execute({
      sql: `INSERT OR IGNORE INTO kg_aliases(entity_id,alias,normalized_alias,match_mode,source,score_weight)
            VALUES (?,?,?,'ci',?,35)`,
      args: [entity.id, alias, normalize(alias), seed.sourceUrl],
    });
    await db.execute({
      sql: `INSERT OR IGNORE INTO entity_locations(entity_id,location_id,relation_type,source_url) VALUES (?,?,'werkgebied',?)`,
      args: [entity.id, city.id, seed.sourceUrl],
    });
    await db.execute({
      sql: `INSERT OR IGNORE INTO manual_entity_seeds(entity_id,source_url,reason,seeded_at,review_due_at)
            VALUES (?,?,?,?,?)`,
      args: [entity.id, seed.sourceUrl, seed.reason, seededAt, reviewDueAt],
    });
  }
  return { seeds: SEEDS.length, entitiesCreated: created, seededAt, reviewDueAt };
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try { console.log(JSON.stringify(await migrate(db), null, 2)); }
  finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { SEEDS, migrate, normalize };
