// Adapter: OpenStreetMap — Overpass contextlaag
// API: https://overpass-api.de/api/interpreter (Overpass QL)
// Levert: fysieke objecten (office, shop, amenity, tourism, leisure, healthcare)
// met adressen, operator, brand en website voor Amersfoort en Leusden.
// Bronklasse: STRUCTURED_CONTEXT — geen harde events, alleen optionele
// kandidaten en locatiewijzigingen met lage confidence.

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'OpenStreetMap — Overpass contextlaag';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Bestuurlijke grenzen: area-ID's voor Overpass
// Gemeentegrenzen (admin_level=8), gecontroleerd via OSM/Nominatim.
// Amersfoort: relation 419152 → area 3600419152
// Leusden: relation 310005 → area 3600310005
const AREA_IDS = {
  amersfoort: 3600419152,
  leusden: 3600310005,
};

// Relevante OSM-tags voor de contextlaag
const RELEVANT_TAGS = [
  'office', 'shop', 'amenity', 'tourism', 'leisure', 'healthcare',
];

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

/**
 * Bouw de Overpass QL-query voor één gemeente.
 * Haalt nodes, ways en relations op met relevante tags.
 */
function buildOverpassQuery(areaId) {
  const tagFilters = RELEVANT_TAGS.map(tag => `["${tag}"]`);
  // Elke tagfilter als apart statement; union van nodes, ways, relations
  const parts = [];
  for (const filter of tagFilters) {
    parts.push(`  node${filter}(area.a);`);
    parts.push(`  way${filter}(area.a);`);
    parts.push(`  relation${filter}(area.a);`);
  }
  return `[out:json][timeout:120];
area(${areaId})->.a;
(
${parts.join('\n')}
);
out center tags;`;
}

/**
 * Normaliseer een OSM-element tot een compact record.
 */
function compactOsmRecord(element) {
  const tags = element.tags || {};
  const id = `${element.type}/${element.id}`;

  // Bepaal de primaire categorie
  let category = '';
  for (const tag of RELEVANT_TAGS) {
    if (tags[tag]) {
      category = `${tag}=${tags[tag]}`;
      break;
    }
  }

  // Coördinaten: direct voor nodes, center voor ways/relations
  const lat = element.lat || element.center?.lat || null;
  const lon = element.lon || element.center?.lon || null;

  return {
    osmId: id,
    name: tags.name || '',
    category,
    operator: tags.operator || '',
    brand: tags.brand || '',
    website: tags.website || tags['contact:website'] || '',
    phone: tags.phone || tags['contact:phone'] || '',
    email: tags.email || tags['contact:email'] || '',
    street: tags['addr:street'] || '',
    housenumber: tags['addr:housenumber'] || '',
    postcode: tags['addr:postcode'] || '',
    city: tags['addr:city'] || '',
    opening_hours: tags.opening_hours || '',
    lat,
    lon,
    // Extra tags die relevant kunnen zijn voor matching
    kvk: tags['ref:kvk'] || tags['ref:KvK'] || '',
    bagId: tags['ref:bag'] || '',
    wikidata: tags.wikidata || '',
  };
}

/**
 * Semantische hash: alleen velden die inhoudelijk relevant zijn.
 * Positie wordt bewust grofkorrelig (4 decimalen ≈ 11m).
 */
function osmSemanticHash(record) {
  const roundCoord = (v) => v != null ? Number(v).toFixed(4) : '';
  return [
    record.osmId,
    record.name,
    record.category,
    record.operator,
    record.brand,
    record.website,
    record.street,
    record.housenumber,
    record.postcode,
    record.city,
    roundCoord(record.lat),
    roundCoord(record.lon),
  ].join('::');
}

/**
 * Genereer een stabiele sleutel voor een OSM-element.
 */
function osmRecordKey(record) {
  return record.osmId; // node/12345, way/67890, relation/11111
}

class OsmContextAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    this.lastFetchOk = false;
    // Optioneel: emit zachte events (standaard uit per spec)
    this.emitSoftEvents = config.emitSoftEvents || false;
  }

  async _ensureSource() {
    const existing = await this.db.execute({
      sql: `SELECT id FROM sources WHERE name = ?`,
      args: [SOURCE_NAME],
    });
    if (existing.rows.length > 0) {
      this.sourceId = existing.rows[0].id;
      return;
    }
    if (this.dryRun) {
      this.sourceId = -1;
      return;
    }
    const result = await this.db.execute({
      sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency,
              is_active, created_at, source_class, adapter_version)
            VALUES (?, ?, 'api', 'secondary', 'data', 'weekly',
              1, datetime('now'), 'STRUCTURED_CONTEXT', '1.0')`,
      args: [SOURCE_NAME, OVERPASS_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[OSM] Bron geregistreerd: id=${this.sourceId}`);
  }

  /**
   * Bevraag Overpass voor beide gemeenten en combineer de resultaten.
   */
  async _fetchAndParse() {
    const allRecords = new Map(); // osmId -> compactRecord

    for (const [gemeente, areaId] of Object.entries(AREA_IDS)) {
      console.log(`[OSM] Ophalen voor ${gemeente} (area ${areaId})...`);
      const query = buildOverpassQuery(areaId);

      const response = await this.fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!response.ok) {
        throw new Error(`Overpass fout voor ${gemeente}: ${response.status}`);
      }

      const json = await response.json();
      const elements = json.elements || [];

      for (const element of elements) {
        const record = compactOsmRecord(element);
        if (record.osmId && !allRecords.has(record.osmId)) {
          allRecords.set(record.osmId, record);
        }
      }
      console.log(`[OSM] ${gemeente}: ${elements.length} elementen`);

      // Respecteer rate limits: wacht 10 seconden tussen queries
      if (Object.keys(AREA_IDS).indexOf(gemeente) < Object.keys(AREA_IDS).length - 1) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }
    }

    console.log(`[OSM] ${allRecords.size} unieke records opgehaald`);
    this.lastFetchOk = true;
    return [...allRecords.values()];
  }

  async _getPreviousSnapshot() {
    const result = await this.db.execute({
      sql: `SELECT id, raw_object, semantic_hash FROM source_records
            WHERE source_id = ? AND source_key = 'osm_full'
            ORDER BY id DESC LIMIT 1`,
      args: [this.sourceId],
    });
    if (result.rows.length > 0) {
      return {
        id: Number(result.rows[0].id),
        snapshot: JSON.parse(result.rows[0].raw_object || '{}'),
        semanticHash: result.rows[0].semantic_hash,
      };
    }
    return null;
  }

  async _saveSnapshot(records, previousState = null) {
    if (this.dryRun) return;
    const snapshot = {};
    for (const record of records) {
      snapshot[record.osmId] = {
        hash: osmSemanticHash(record),
        ...record,
      };
    }
    const rawObject = JSON.stringify(snapshot);
    const newSemanticHash = crypto.createHash('sha256').update(rawObject).digest('hex');
    if (previousState?.semanticHash === newSemanticHash) return;
    const contentHash = crypto.createHash('sha256')
      .update(`${newSemanticHash}:${previousState?.id || 0}`)
      .digest('hex');
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, previous_id, change_type)
            VALUES (?, 'osm_full', ?, ?, ?, ?, ?)`,
      args: [this.sourceId, rawObject, contentHash, newSemanticHash,
        previousState?.id || null, previousState ? 'changed' : 'added'],
    });
  }

  /**
   * Vergelijk huidig met vorig snapshot.
   * Standaard worden GEEN events gegenereerd (STRUCTURED_CONTEXT).
   * Met emitSoftEvents=true worden kandidaten en wijzigingen opgemerkt.
   */
  _diff(currentRecords, previousSnapshot) {
    const changes = { added: [], removed: [], changed: [] };
    const currentMap = {};

    for (const record of currentRecords) {
      currentMap[record.osmId] = record;
      if (!previousSnapshot || !previousSnapshot[record.osmId]) {
        changes.added.push(record);
        continue;
      }
      const prev = previousSnapshot[record.osmId];
      if (osmSemanticHash(record) !== prev.hash) {
        changes.changed.push({ current: record, previous: prev });
      }
    }

    if (previousSnapshot) {
      for (const osmId of Object.keys(previousSnapshot)) {
        if (!currentMap[osmId]) {
          changes.removed.push(previousSnapshot[osmId]);
        }
      }
    }

    return changes;
  }

  /**
   * Verwerk zachte events (alleen als emitSoftEvents actief is).
   * OSM is STRUCTURED_CONTEXT: deze gaan naar review, niet naar de tipstroom.
   */
  async _processSoftEvents(changes) {
    if (!this.emitSoftEvents || this.dryRun) return 0;
    let emitted = 0;

    for (const record of changes.added) {
      if (!record.name) continue; // naamloze objecten zijn geen kandidaten
      try {
        await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance, created_at)
                VALUES ('OSM_ENTITY_CANDIDATE', ?, ?, datetime('now'), datetime('now'), ?, ?, ?, '1.0', ?, datetime('now'))`,
          args: [
            `Nieuw in OSM: ${record.name}`,
            `${record.name} (${record.category}) toegevoegd in OSM. ${record.street} ${record.housenumber}, ${record.city}.`,
            this.sourceId,
            `https://www.openstreetmap.org/${record.osmId}`,
            record.osmId,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'STRUCTURED_CONTEXT',
              source_url: `https://www.openstreetmap.org/${record.osmId}`,
              record,
            }),
          ],
        });
        emitted++;
      } catch (err) {
        if (!err.message.includes('UNIQUE')) console.error(`[OSM] event fout: ${err.message}`);
      }
    }

    for (const { current, previous } of changes.changed) {
      // Alleen locatiewijzigingen melden (niet elke tagwijziging)
      const posChanged = current.street !== (previous.street || '') ||
        current.housenumber !== (previous.housenumber || '') ||
        current.city !== (previous.city || '');
      if (!posChanged || !current.name) continue;
      try {
        await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance, created_at)
                VALUES ('OSM_LOCATION_CHANGED', ?, ?, datetime('now'), datetime('now'), ?, ?, ?, '1.0', ?, datetime('now'))`,
          args: [
            `OSM-locatiewijziging: ${current.name}`,
            `Adres van ${current.name} gewijzigd in OSM. Was: ${previous.street || '?'} ${previous.housenumber || '?'}. Nu: ${current.street} ${current.housenumber}.`,
            this.sourceId,
            `https://www.openstreetmap.org/${current.osmId}`,
            current.osmId,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'STRUCTURED_CONTEXT',
              source_url: `https://www.openstreetmap.org/${current.osmId}`,
              current,
              previous,
            }),
          ],
        });
        emitted++;
      } catch (err) {
        if (!err.message.includes('UNIQUE')) console.error(`[OSM] event fout: ${err.message}`);
      }
    }

    return emitted;
  }

  async health() {
    if (this.lastFetchOk) {
      return {
        status: 'ok',
        message: 'Overpass succesvol gebruikt tijdens deze run',
        timestamp: new Date().toISOString(),
      };
    }
    try {
      // Minimale Overpass-query om bereikbaarheid te testen
      const testQuery = '[out:json][timeout:10];node(52.15,5.37,52.16,5.38)[amenity=restaurant];out count;';
      const response = await this.fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Stadsgeest/1.0',
        },
        body: `data=${encodeURIComponent(testQuery)}`,
      });
      return {
        status: response.ok ? 'ok' : 'error',
        message: `Overpass ${response.ok ? 'bereikbaar' : 'onbereikbaar'} (${response.status})`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { status: 'error', message: err.message, timestamp: new Date().toISOString() };
    }
  }

  async run() {
    console.log('[OSM] Start run...');
    await this._ensureSource();

    const records = await this._fetchAndParse();
    const previousState = await this._getPreviousSnapshot();
    const previousSnapshot = previousState?.snapshot || null;
    const changes = this._diff(records, previousSnapshot);

    const stats = {
      total: records.length,
      added: changes.added.length,
      changed: changes.changed.length,
      removed: changes.removed.length,
      baseline: !previousSnapshot,
    };
    console.log(`[OSM] Diff: +${stats.added} ~${stats.changed} -${stats.removed}${previousSnapshot ? '' : ' (baseline)'}`);

    if (!previousSnapshot) {
      console.log(`[OSM] Baseline — snapshot opslaan zonder events`);
      await this._saveSnapshot(records, previousState);
      return { ...stats, events: 0 };
    }

    const emitted = await this._processSoftEvents(changes);
    await this._saveSnapshot(records, previousState);

    console.log(`[OSM] Klaar: ${stats.total} records, ${emitted} zachte events`);
    return { ...stats, events: emitted };
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const emitSoft = process.argv.includes('--emit-soft');
  const adapter = new OsmContextAdapter({ dryRun, emitSoftEvents: emitSoft });
  adapter.run()
    .then(r => { console.log('Resultaat:', r); process.exit(0); })
    .catch(err => { console.error('Fataal:', err); process.exit(1); });
}

module.exports = {
  OsmContextAdapter,
  // Geëxporteerd voor testen
  buildOverpassQuery,
  compactOsmRecord,
  osmSemanticHash,
  osmRecordKey,
  AREA_IDS,
  RELEVANT_TAGS,
};
