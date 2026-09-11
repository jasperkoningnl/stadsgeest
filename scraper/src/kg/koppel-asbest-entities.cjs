// Script: koppel asbest-events aan kg_entities via event_entities
// Vergelijkbaar met vul-graph-keten.cjs (commit 6478fed) voor eerlijk-werk.
// Leest bedrijfsnaam uit provenance, zoekt of maakt entity, legt koppeling.
// Gebruik: node koppel-asbest-entities.cjs [--dry-run]

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

(async () => {
  console.log(`=== Koppel asbest-events aan entities ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Stap 1: Zorg dat locaties Amersfoort en Leusden bestaan
  console.log('--- Stap 1: Locaties controleren ---');

  let amersfoortId, leusdenId;

  const existingAmersfoort = await db.execute({
    sql: `SELECT id FROM locations WHERE city = ? AND label = ?`,
    args: ['Amersfoort', 'Amersfoort (stad)'],
  });
  if (existingAmersfoort.rows.length > 0) {
    amersfoortId = existingAmersfoort.rows[0].id;
    console.log(`Amersfoort bestaat: id=${amersfoortId}`);
  } else {
    console.error('Locatie Amersfoort niet gevonden — draai eerst vul-graph-keten.cjs');
    process.exit(1);
  }

  const existingLeusden = await db.execute({
    sql: `SELECT id FROM locations WHERE city = ? AND label = ?`,
    args: ['Leusden', 'Leusden (gemeente)'],
  });
  if (existingLeusden.rows.length > 0) {
    leusdenId = existingLeusden.rows[0].id;
    console.log(`Leusden bestaat: id=${leusdenId}`);
  } else {
    console.error('Locatie Leusden niet gevonden — draai eerst vul-graph-keten.cjs');
    process.exit(1);
  }

  // Stap 2: Laad alle bestaande aliassen voor matching
  console.log('\n--- Stap 2: Aliassen laden ---');

  const aliases = await db.execute(`
    SELECT ka.entity_id, ka.alias, ka.normalized_alias, ke.canonical_name
    FROM kg_aliases ka
    JOIN kg_entities ke ON ke.id = ka.entity_id
    WHERE ke.merged_into_id IS NULL AND ke.entity_type = 'organization'
    ORDER BY length(ka.alias) DESC
  `);
  console.log(`${aliases.rows.length} organisatie-aliassen geladen`);

  // Stap 3: Haal alle asbest-events op
  console.log('\n--- Stap 3: Asbest-events koppelen ---');

  const events = await db.execute(`
    SELECT id, title, summary, provenance FROM kg_events
    WHERE event_type IN ('ASBESTOS_VIOLATION_PUBLISHED', 'ASBESTOS_WORK_STOPPED')
  `);
  console.log(`${events.rows.length} asbest-events te verwerken\n`);

  let eventsMatched = 0, entitiesLinked = 0, entitiesCreated = 0, eventsSkipped = 0;

  for (const event of events.rows) {
    // Haal bedrijfsnaam uit provenance
    let bedrijfsnaam = '';
    try {
      const prov = JSON.parse(event.provenance);
      bedrijfsnaam = prov.bedrijf || '';
    } catch { /* geen provenance */ }

    if (!bedrijfsnaam) {
      // Fallback: haal uit titel "Asbestovertreding: <naam>"
      const m = event.title.match(/^Asbestovertreding:\s+(.+)$/);
      if (m) bedrijfsnaam = m[1];
    }

    if (!bedrijfsnaam) {
      console.log(`  Event ${event.id}: geen bedrijfsnaam gevonden, overslaan`);
      eventsSkipped++;
      continue;
    }

    const normalizedBedrijf = normalize(bedrijfsnaam);

    // Check of er al een event_entities-koppeling bestaat
    const existingLink = await db.execute({
      sql: `SELECT id FROM event_entities WHERE event_id = ?`,
      args: [event.id],
    });
    if (existingLink.rows.length > 0) {
      console.log(`  Event ${event.id} (${bedrijfsnaam}): al gekoppeld, overslaan`);
      continue;
    }

    // Zoek match in bestaande entities via aliassen
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

    // Substring match (langere aliassen eerst, want gesorteerd op lengte)
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

    // Check ook direct in kg_entities.normalized_name
    if (!matchedEntityId) {
      const directMatch = await db.execute({
        sql: `SELECT id FROM kg_entities WHERE normalized_name = ? AND merged_into_id IS NULL`,
        args: [normalizedBedrijf],
      });
      if (directMatch.rows.length > 0) {
        matchedEntityId = directMatch.rows[0].id;
        matchedVia = 'directe normalized_name match';
      }
    }

    if (matchedEntityId) {
      // Koppel event aan bestaande entity
      if (!dryRun) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                VALUES (?, ?, 'subject', ?, 0.8)`,
          args: [event.id, matchedEntityId, `Gematcht via ${matchedVia}`],
        });
      }
      entitiesLinked++;
      eventsMatched++;
      console.log(`${dryRun ? '[DRY] ' : ''}✓ Event ${event.id}: ${bedrijfsnaam} → entity ${matchedEntityId} (${matchedVia})`);
    } else {
      // Geen match: maak nieuwe entity aan
      if (!dryRun) {
        const r = await db.execute({
          sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
                VALUES ('organization', ?, ?)`,
          args: [bedrijfsnaam, normalizedBedrijf],
        });
        const entityId = Number(r.lastInsertRowid);

        // Alias aanmaken
        await db.execute({
          sql: `INSERT OR IGNORE INTO kg_aliases (entity_id, alias, normalized_alias, source)
                VALUES (?, ?, ?, 'asbestovertredingen')`,
          args: [entityId, bedrijfsnaam, normalizedBedrijf],
        });

        // Locatie koppelen — bepaal Amersfoort of Leusden op basis van locatietekst
        let locatieText = '';
        try {
          const prov = JSON.parse(event.provenance);
          locatieText = (prov.locatie || '').toLowerCase();
        } catch {}
        const locationId = locatieText.includes('leusden') ? leusdenId : amersfoortId;

        await db.execute({
          sql: `INSERT OR IGNORE INTO entity_locations (entity_id, location_id, relation_type)
                VALUES (?, ?, 'vestiging')`,
          args: [entityId, locationId],
        });

        // Event_entity koppeling
        await db.execute({
          sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                VALUES (?, ?, 'subject', ?, 0.9)`,
          args: [event.id, entityId, `Nieuw aangemaakt vanuit asbestovertredingen: ${bedrijfsnaam}`],
        });

        entitiesCreated++;
        eventsMatched++;
        console.log(`${dryRun ? '[DRY] ' : ''}+ Event ${event.id}: ${bedrijfsnaam} → NIEUWE entity ${entityId}`);
      } else {
        entitiesCreated++;
        eventsMatched++;
        console.log(`[DRY] + Event ${event.id}: ${bedrijfsnaam} → zou nieuwe entity aanmaken`);
      }
    }
  }

  // Samenvatting
  console.log(`\n=== Samenvatting ===`);
  console.log(`Asbest-events verwerkt: ${events.rows.length}`);
  console.log(`Events gekoppeld: ${eventsMatched}`);
  console.log(`Bestaande entities gelinkt: ${entitiesLinked}`);
  console.log(`Nieuwe entities aangemaakt: ${entitiesCreated}`);
  console.log(`Events overgeslagen: ${eventsSkipped}`);

  // Verificatie: tel event_entities koppelingen
  if (!dryRun) {
    const verify = await db.execute("SELECT count(*) as cnt FROM event_entities ee JOIN kg_events e ON e.id=ee.event_id WHERE e.event_type IN ('ASBESTOS_VIOLATION_PUBLISHED', 'ASBESTOS_WORK_STOPPED')");
    console.log(`\nVerificatie: ${verify.rows[0].cnt} asbest event_entities in database`);
  }
})();
