// Handmatige seed — KvK-nummers, websites en aliassen voor Amersfoortse organisaties
// Bron: KvK-register, overheid.nl, bedrijvenregister.nl, drimble.nl
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// Identifiers en aliassen per bestaande organisatie (canonical_name → data)
const ORG_DATA = {
  'Gemeente Amersfoort': {
    kvk: '25544365',
    website: 'amersfoort.nl',
    aliases: ['gemeente', 'GemAmersfoort', 'college van B&W', 'college van burgemeester en wethouders', 'B&W Amersfoort'],
  },
  'Meander Medisch Centrum': {
    kvk: '32131417',
    website: 'meandermc.nl',
    aliases: ['Meander MC', 'Meander', 'MMC', 'Meander ziekenhuis'],
  },
  'De Alliantie': {
    kvk: '39048769',
    website: 'de-alliantie.nl',
    aliases: ['Alliantie', 'woningcorporatie De Alliantie', 'Stichting De Alliantie'],
  },
  'Portaal': {
    kvk: '28017920',
    website: 'portaal.nl',
    aliases: ['Stichting Portaal', 'Portaal Woonstichting', 'woningcorporatie Portaal'],
  },
  'Waterschap Vallei en Veluwe': {
    kvk: '54691672',
    website: 'vallei-veluwe.nl',
    aliases: ['WVEV', 'waterschap', 'Vallei en Veluwe'],
  },
  'Politie Midden-Nederland': {
    kvk: '56549768',
    website: 'politie.nl',
    aliases: ['politie', 'politie Amersfoort', 'Politie Eemland'],
  },
  'GGD Regio Utrecht': {
    kvk: '30227898',
    website: 'ggdru.nl',
    aliases: ['GGD', 'GGDrU', 'GGD Utrecht'],
  },
  'Omgevingsdienst Utrecht': {
    kvk: '30282572',
    website: 'odru.nl',
    aliases: ['ODRU', 'RUD Utrecht'],
  },
  'Omnia Wonen': {
    kvk: '27177498',
    website: 'omniawonen.nl',
    aliases: ['Stichting Omnia Wonen'],
  },
  'Veiligheidsregio Utrecht': {
    kvk: '30222025',
    website: 'vru.nl',
    aliases: ['VRU', 'veiligheidsregio'],
  },
  'SRO': {
    kvk: '31031825',
    website: 'sro-amersfoort.nl',
    aliases: ['SRO Amersfoort', 'Sport Recreatie Onderneming', 'SRO Amersfoort B.V.'],
  },
  'Amfors': {
    kvk: '23966270',
    website: 'amfors.nl',
    aliases: ['Amfors Publieke Services', 'Amfors Holding'],
  },
  'ROVA': {
    // kvk: onbekend, overslaan
    website: 'rova.nl',
    aliases: ['ROVA Zwolle'],
  },
};

// Nieuwe organisaties die nog niet in kg_entities staan
const NEW_ORGS = [
  {
    name: 'Amerpoort',
    entityType: 'organization',
    kvk: '23498625',
    website: 'amerpoort.nl',
    aliases: ['Stichting Amerpoort'],
  },
  {
    name: 'Koppelkerk',
    entityType: 'organization',
    website: 'koppelkerk.nl',
    aliases: ['De Koppel', 'Leerorkest Amersfoort'],
  },
  {
    name: 'Flint Theater',
    entityType: 'organization',
    website: 'flfrn.nl',
    aliases: ['De Flint', 'Flint', 'Theater De Flint'],
  },
  {
    name: 'FC Utrecht Amersfoort (SC Amersfoort)',
    entityType: 'organization',
    aliases: ['SC Amersfoort', 'SCAmersfoort'],
  },
  {
    name: 'Universiteit Utrecht campus Amersfoort',
    entityType: 'organization',
    website: 'uu.nl',
    aliases: ['UU Amersfoort'],
  },
  {
    name: 'Hogeschool Utrecht Amersfoort',
    entityType: 'organization',
    website: 'hu.nl',
    aliases: ['HU Amersfoort', 'Hogeschool Utrecht'],
  },
  {
    name: 'Vathorst Beheer B.V.',
    entityType: 'organization',
    kvk: '32078078',
    aliases: ['Vathorst', 'Vathorst C.V.', 'OBV Vathorst'],
  },
  {
    name: 'Wijkteams Amersfoort',
    entityType: 'organization',
    website: 'wijkteamsamersfoort.nl',
    aliases: ['wijkteam', 'wijkteams', 'sociaal wijkteam'],
  },
  {
    name: 'Indebuurt033',
    entityType: 'organization',
    website: 'indebuurt033.nl',
    aliases: ['Indebuurt Amersfoort', 'indebuurt'],
  },
  {
    name: 'Provincie Utrecht',
    entityType: 'organization',
    kvk: '30280680',
    website: 'provincie-utrecht.nl',
    aliases: ['provincie', 'Provinciale Staten Utrecht', 'GS Utrecht', 'PS Utrecht'],
  },
  {
    name: 'ProRail',
    entityType: 'organization',
    kvk: '30124359',
    website: 'prorail.nl',
    aliases: ['Pro Rail'],
  },
  {
    name: 'NS',
    entityType: 'organization',
    kvk: '30124358',
    website: 'ns.nl',
    aliases: ['Nederlandse Spoorwegen', 'NS Stations'],
  },
];

function normalize(s) {
  return s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

async function main() {
  let identifiersAdded = 0;
  let aliasesAdded = 0;
  let orgsCreated = 0;

  // === Deel 1: verrijk bestaande organisaties ===
  console.log('=== Verrijking bestaande organisaties ===\n');

  for (const [name, data] of Object.entries(ORG_DATA)) {
    // Zoek entity-id
    const result = await db.execute({
      sql: "SELECT id FROM kg_entities WHERE canonical_name = ? AND entity_type = 'organization'",
      args: [name],
    });
    if (result.rows.length === 0) {
      console.log(`  ⚠ ${name} niet gevonden in kg_entities, overslaan`);
      continue;
    }
    const entityId = result.rows[0].id;

    // KvK toevoegen
    if (data.kvk && !data.kvk.includes('--')) {
      const ins = await db.execute({
        sql: "INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url) VALUES (?, 'kvk', ?, 'handmatige seed')",
        args: [entityId, data.kvk],
      });
      if (ins.rowsAffected > 0) { identifiersAdded++; console.log(`  ${name}: KvK ${data.kvk} toegevoegd`); }
    }

    // Website toevoegen
    if (data.website) {
      const ins = await db.execute({
        sql: "INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url) VALUES (?, 'website', ?, 'handmatige seed')",
        args: [entityId, data.website],
      });
      if (ins.rowsAffected > 0) { identifiersAdded++; console.log(`  ${name}: website ${data.website} toegevoegd`); }
    }

    // Aliassen toevoegen
    if (data.aliases) {
      for (const alias of data.aliases) {
        const ins = await db.execute({
          sql: "INSERT OR IGNORE INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source, score_weight) VALUES (?, ?, ?, 'ci', 'handmatige seed', 35)",
          args: [entityId, alias, normalize(alias)],
        });
        if (ins.rowsAffected > 0) { aliasesAdded++; }
      }
      console.log(`  ${name}: aliassen verwerkt`);
    }
  }

  // === Deel 2: nieuwe organisaties aanmaken ===
  console.log('\n=== Nieuwe organisaties ===\n');

  for (const org of NEW_ORGS) {
    // Check of al bestaat
    const existing = await db.execute({
      sql: "SELECT id FROM kg_entities WHERE normalized_name = ? AND entity_type = 'organization'",
      args: [normalize(org.name)],
    });
    let entityId;
    if (existing.rows.length > 0) {
      entityId = existing.rows[0].id;
      console.log(`  ${org.name} bestaat al (id=${entityId})`);
    } else {
      const ins = await db.execute({
        sql: "INSERT INTO kg_entities (entity_type, canonical_name, normalized_name) VALUES ('organization', ?, ?)",
        args: [org.name, normalize(org.name)],
      });
      entityId = Number(ins.lastInsertRowid);
      orgsCreated++;
      console.log(`  ${org.name} aangemaakt (id=${entityId})`);
    }

    // KvK
    if (org.kvk) {
      const ins = await db.execute({
        sql: "INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url) VALUES (?, 'kvk', ?, 'handmatige seed')",
        args: [entityId, org.kvk],
      });
      if (ins.rowsAffected > 0) identifiersAdded++;
    }

    // Website
    if (org.website) {
      const ins = await db.execute({
        sql: "INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url) VALUES (?, 'website', ?, 'handmatige seed')",
        args: [entityId, org.website],
      });
      if (ins.rowsAffected > 0) identifiersAdded++;
    }

    // Aliassen
    if (org.aliases) {
      for (const alias of org.aliases) {
        const ins = await db.execute({
          sql: "INSERT OR IGNORE INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source, score_weight) VALUES (?, ?, ?, 'ci', 'handmatige seed', 35)",
          args: [entityId, alias, normalize(alias)],
        });
        if (ins.rowsAffected > 0) aliasesAdded++;
      }
    }
  }

  // === Samenvatting ===
  console.log('\n=== SAMENVATTING ===');
  console.log(`  Nieuwe organisaties: ${orgsCreated}`);
  console.log(`  Identifiers toegevoegd: ${identifiersAdded}`);
  console.log(`  Aliassen toegevoegd: ${aliasesAdded}`);

  const totals = await db.execute('SELECT COUNT(*) as n FROM kg_entities');
  const totalAliases = await db.execute('SELECT COUNT(*) as n FROM kg_aliases');
  const totalIds = await db.execute('SELECT COUNT(*) as n FROM entity_identifiers');
  console.log(`\n  kg_entities totaal: ${totals.rows[0].n}`);
  console.log(`  kg_aliases totaal: ${totalAliases.rows[0].n}`);
  console.log(`  entity_identifiers totaal: ${totalIds.rows[0].n}`);
}

main().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
