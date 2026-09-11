// Script: vul de graph-keten locations → entity_locations → event_entities
// Stap 1: Amersfoort en Leusden als locaties aanmaken
// Stap 2: organisaties koppelen aan locatie
// Stap 3: eerlijk-werk events matchen tegen entities via aliassen
// Gebruik: node vul-graph-keten.cjs [--dry-run]

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const dryRun = process.argv.includes('--dry-run');

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(async () => {
  console.log(`=== Vul graph-keten ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // --- Stap 1: Locaties ---
  console.log('--- Stap 1: Locaties aanmaken ---');

  let amersfoortId, leusdenId;

  const existingAmersfoort = await db.execute({
    sql: `SELECT id FROM locations WHERE city = ? AND label = ?`,
    args: ['Amersfoort', 'Amersfoort (stad)'],
  });

  if (existingAmersfoort.rows.length > 0) {
    amersfoortId = existingAmersfoort.rows[0].id;
    console.log(`Amersfoort bestaat al: id=${amersfoortId}`);
  } else if (!dryRun) {
    const r = await db.execute({
      sql: `INSERT INTO locations (label, city, municipality, lat, lon)
            VALUES (?, ?, ?, ?, ?)`,
      args: ['Amersfoort (stad)', 'Amersfoort', 'Amersfoort', 52.1561, 5.3878],
    });
    amersfoortId = Number(r.lastInsertRowid);
    console.log(`Amersfoort aangemaakt: id=${amersfoortId}`);
  } else {
    amersfoortId = -1;
    console.log('[DRY] Amersfoort zou worden aangemaakt');
  }

  const existingLeusden = await db.execute({
    sql: `SELECT id FROM locations WHERE city = ? AND label = ?`,
    args: ['Leusden', 'Leusden (gemeente)'],
  });

  if (existingLeusden.rows.length > 0) {
    leusdenId = existingLeusden.rows[0].id;
    console.log(`Leusden bestaat al: id=${leusdenId}`);
  } else if (!dryRun) {
    const r = await db.execute({
      sql: `INSERT INTO locations (label, city, municipality, lat, lon)
            VALUES (?, ?, ?, ?, ?)`,
      args: ['Leusden (gemeente)', 'Leusden', 'Leusden', 52.1322, 5.4317],
    });
    leusdenId = Number(r.lastInsertRowid);
    console.log(`Leusden aangemaakt: id=${leusdenId}`);
  } else {
    leusdenId = -2;
    console.log('[DRY] Leusden zou worden aangemaakt');
  }

  // --- Stap 2: Organisaties koppelen aan locatie ---
  console.log('\n--- Stap 2: Organisaties koppelen aan locatie ---');

  // Haal alle actieve organisaties op
  const orgs = await db.execute(`
    SELECT id, canonical_name FROM kg_entities
    WHERE entity_type = 'organization' AND merged_into_id IS NULL
  `);

  // Bepaal per organisatie of het Amersfoort of Leusden is
  // Heuristiek: als de naam "Leusden" bevat → Leusden, anders Amersfoort
  let orgLinked = 0;
  for (const org of orgs.rows) {
    const name = org.canonical_name.toLowerCase();
    const locationId = name.includes('leusden') ? leusdenId : amersfoortId;
    const locationLabel = name.includes('leusden') ? 'Leusden' : 'Amersfoort';

    // Check of de koppeling al bestaat
    const existing = await db.execute({
      sql: `SELECT id FROM entity_locations WHERE entity_id = ? AND location_id = ?`,
      args: [org.id, locationId],
    });
    if (existing.rows.length > 0) continue;

    if (!dryRun) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO entity_locations (entity_id, location_id, relation_type)
              VALUES (?, ?, 'werkgebied')`,
        args: [org.id, locationId],
      });
    }
    console.log(`${dryRun ? '[DRY] ' : ''}${org.canonical_name} → ${locationLabel}`);
    orgLinked++;
  }
  console.log(`${orgLinked} organisaties gekoppeld`);

  // --- Stap 3: Eerlijk-werk events matchen tegen entities ---
  console.log('\n--- Stap 3: Eerlijk-werk events koppelen aan entities ---');

  // Laad alle aliassen (gesorteerd op lengte, langste eerst voor greedy match)
  const aliases = await db.execute(`
    SELECT ka.entity_id, ka.alias, ka.normalized_alias, ke.canonical_name
    FROM kg_aliases ka
    JOIN kg_entities ke ON ke.id = ka.entity_id
    WHERE ke.merged_into_id IS NULL AND ke.entity_type = 'organization'
    ORDER BY length(ka.alias) DESC
  `);
  console.log(`${aliases.rows.length} organisatie-aliassen geladen`);

  // Haal alle eerlijk-werk events op
  const events = await db.execute(`
    SELECT id, title, summary, provenance FROM kg_events
    WHERE event_type IN ('INSPECTION_VIOLATION', 'INSPECTION_CLEAR')
  `);
  console.log(`${events.rows.length} eerlijk-werk events te matchen\n`);

  let eventsMatched = 0, entitiesLinked = 0, eventsUnmatched = 0;
  const newEntities = [];

  for (const event of events.rows) {
    // Haal bedrijfsnaam uit provenance
    let bedrijfsnaam = '';
    try {
      const prov = JSON.parse(event.provenance);
      bedrijfsnaam = prov.bedrijfsnaam || '';
    } catch { /* geen provenance */ }

    if (!bedrijfsnaam) {
      // Probeer uit titel: "Inspectie <bedrijfsnaam>"
      const m = event.title.match(/^Inspectie\s+(.+)$/);
      if (m) bedrijfsnaam = m[1];
    }

    if (!bedrijfsnaam) {
      eventsUnmatched++;
      continue;
    }

    const normalizedBedrijf = normalize(bedrijfsnaam);

    // Zoek match in aliassen
    let matchedEntityId = null;
    let matchedVia = '';

    // Exacte match op normalized naam
    for (const alias of aliases.rows) {
      if (alias.normalized_alias === normalizedBedrijf) {
        matchedEntityId = alias.entity_id;
        matchedVia = `exact alias: ${alias.alias}`;
        break;
      }
    }

    // Substring match: alias in bedrijfsnaam of bedrijfsnaam in alias (alleen bij langere aliassen)
    if (!matchedEntityId) {
      for (const alias of aliases.rows) {
        if (alias.alias.length < 5) continue;
        const normAlias = alias.normalized_alias;
        if (normalizedBedrijf.includes(normAlias) || normAlias.includes(normalizedBedrijf)) {
          matchedEntityId = alias.entity_id;
          matchedVia = `substring alias: ${alias.alias}`;
          break;
        }
      }
    }

    if (matchedEntityId) {
      // Check of de koppeling al bestaat
      const existing = await db.execute({
        sql: `SELECT id FROM event_entities WHERE event_id = ? AND entity_id = ?`,
        args: [event.id, matchedEntityId],
      });
      if (existing.rows.length === 0) {
        if (!dryRun) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                  VALUES (?, ?, 'subject', ?, 0.8)`,
            args: [event.id, matchedEntityId, `Gematcht via ${matchedVia}`],
          });
        }
        entitiesLinked++;
      }
      eventsMatched++;
      console.log(`${dryRun ? '[DRY] ' : ''}✓ ${bedrijfsnaam} → entity ${matchedEntityId} (${matchedVia})`);
    } else {
      // Geen match: registreer als nieuw bedrijf dat een entity nodig heeft
      newEntities.push(bedrijfsnaam);
      eventsUnmatched++;
    }
  }

  console.log(`\n--- Stap 3b: Nieuwe entities aanmaken voor ongematchte bedrijven ---`);
  // Dedup de ongematchte bedrijfsnamen
  const uniqueNew = [...new Set(newEntities.map(n => n.trim()))];
  console.log(`${uniqueNew.length} unieke bedrijven zonder entity-match`);

  let created = 0;
  for (const naam of uniqueNew) {
    const normalized = normalize(naam);

    // Dubbel-check: bestaat er al een entity met deze normalized naam?
    const existing = await db.execute({
      sql: `SELECT id FROM kg_entities WHERE normalized_name = ?`,
      args: [normalized],
    });
    if (existing.rows.length > 0) {
      console.log(`  ${naam}: entity ${existing.rows[0].id} gevonden op normalized_name`);
      continue;
    }

    if (!dryRun) {
      // Maak entity aan
      const r = await db.execute({
        sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
              VALUES ('organization', ?, ?)`,
        args: [naam, normalized],
      });
      const entityId = Number(r.lastInsertRowid);

      // Alias aanmaken
      await db.execute({
        sql: `INSERT OR IGNORE INTO kg_aliases (entity_id, alias, normalized_alias, source)
              VALUES (?, ?, ?, 'arbeidsinspectie')`,
        args: [entityId, naam, normalized],
      });

      // Locatie koppelen (altijd Amersfoort, want ze staan geregistreerd als Amersfoort)
      await db.execute({
        sql: `INSERT OR IGNORE INTO entity_locations (entity_id, location_id, relation_type)
              VALUES (?, ?, 'vestiging')`,
        args: [entityId, amersfoortId],
      });

      // Event_entity koppelen
      // Zoek alle events voor dit bedrijf
      const eventsForBedrijf = await db.execute({
        sql: `SELECT id FROM kg_events
              WHERE event_type IN ('INSPECTION_VIOLATION', 'INSPECTION_CLEAR')
              AND (title LIKE ? OR provenance LIKE ?)`,
        args: [`%${naam}%`, `%${naam}%`],
      });
      for (const ev of eventsForBedrijf.rows) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                VALUES (?, ?, 'subject', ?, 0.9)`,
          args: [ev.id, entityId, `Nieuw aangemaakt vanuit arbeidsinspectie: ${naam}`],
        });
      }

      console.log(`  ${naam}: entity ${entityId} aangemaakt + ${eventsForBedrijf.rows.length} events gekoppeld`);
      created++;
    } else {
      console.log(`  [DRY] ${naam}: zou entity aanmaken`);
      created++;
    }
  }

  console.log(`\n=== Samenvatting ===`);
  console.log(`Locaties: Amersfoort=${amersfoortId}, Leusden=${leusdenId}`);
  console.log(`Organisaties → locatie: ${orgLinked}`);
  console.log(`Events gematcht tegen bestaande entities: ${eventsMatched}`);
  console.log(`Event-entity koppelingen aangemaakt: ${entitiesLinked}`);
  console.log(`Nieuwe entities aangemaakt: ${created}`);
  console.log(`Events zonder match: ${eventsUnmatched - uniqueNew.length}`);
})();
