// Adapter: GLEIF — Global Legal Entity Identifier Foundation
// API: https://api.gleif.org/api/v1/lei-records (JSON:API, paginering)
// Detecteert: nieuwe LEI's, naamswijzigingen, hoofdkantoorwijzigingen,
// statuswijzigingen, moederrelatiewijzigingen en opvolgingsregistraties.
// Identifier: LEI (namespace LEI).

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'GLEIF — LEI-register';
const API_BASE = 'https://api.gleif.org/api/v1/lei-records';
const RELATIONS_BASE = 'https://api.gleif.org/api/v1/lei-records';
const FILTER_CITIES = new Set(['amersfoort', 'leusden']);
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // vangnet: max 5000 records per query

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

/**
 * Normaliseer een plaatsnaam voor vergelijking.
 */
function normalizeCity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Haal de relevante adresvelden op uit een GLEIF-entity.
 * Controleert zowel legal als headquarters adres.
 */
function extractCities(entity) {
  const cities = new Set();
  const attrs = entity.attributes || {};
  const legal = attrs.entity?.legalAddress;
  const hq = attrs.entity?.headquartersAddress;
  if (legal?.city) cities.add(normalizeCity(legal.city));
  if (hq?.city) cities.add(normalizeCity(hq.city));
  // Sommige records hebben otherAddresses
  for (const other of attrs.entity?.otherAddresses || []) {
    if (other?.city) cities.add(normalizeCity(other.city));
  }
  return cities;
}

/**
 * Controleer of een entity lokaal is (adres in Amersfoort/Leusden).
 */
function isLocalEntity(entity) {
  const cities = extractCities(entity);
  for (const city of cities) {
    if (FILTER_CITIES.has(city)) return true;
  }
  return false;
}

/**
 * Controleer of een entity op de watchlist staat (bekende lokale LEI's).
 */
function isWatchlisted(entity, watchlist) {
  if (!watchlist || watchlist.size === 0) return false;
  const lei = entity.attributes?.lei;
  return lei && watchlist.has(lei);
}

/**
 * Bouw een compact record uit een GLEIF API-entity.
 */
function compactRecord(entity) {
  const attrs = entity.attributes || {};
  const ent = attrs.entity || {};
  const reg = attrs.registration || {};
  const legal = ent.legalAddress || {};
  const hq = ent.headquartersAddress || {};

  return {
    lei: attrs.lei,
    legalName: ent.legalName?.name || '',
    otherNames: (ent.otherNames || []).map(n => n.name).filter(Boolean),
    status: ent.status || '',
    registrationStatus: reg.status || '',
    legalCity: legal.city || '',
    legalCountry: legal.country || '',
    legalPostalCode: legal.postalCode || '',
    legalAddressLines: (legal.addressLines || []).join(', '),
    hqCity: hq.city || '',
    hqCountry: hq.country || '',
    hqPostalCode: hq.postalCode || '',
    hqAddressLines: (hq.addressLines || []).join(', '),
    legalJurisdiction: ent.jurisdiction || '',
    category: ent.category || '',
    legalForm: ent.legalForm?.id || '',
    expiration: ent.expiration?.date || '',
    successorLei: ent.successorEntity?.lei || '',
    lastUpdate: reg.lastUpdateDate || '',
  };
}

/**
 * Maak een semantische hash van de relevante velden.
 */
function gleifSemanticHash(record) {
  return [
    record.lei,
    record.legalName,
    record.status,
    record.registrationStatus,
    record.hqCity,
    record.hqCountry,
    record.hqAddressLines,
    record.legalCity,
    record.legalCountry,
    record.successorLei,
  ].join('::');
}

/**
 * Parse parent/child-relaties uit de relationship-respons.
 */
function parseRelationships(relData) {
  if (!relData || !Array.isArray(relData)) return [];
  return relData.map(rel => {
    const attrs = rel.attributes || {};
    return {
      startLei: attrs.relationship?.startNode?.id || '',
      endLei: attrs.relationship?.endNode?.id || '',
      type: attrs.relationship?.type || '',
      status: attrs.relationship?.status || '',
      qualifiers: (attrs.relationship?.qualifiers || []).map(q =>
        `${q.qualifierDimension || ''}:${q.qualifierCategory || ''}`),
    };
  }).filter(r => r.startLei && r.endLei);
}

class GleifRegisterAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    // Watchlist: bekende lokale LEI's die gevolgd moeten worden
    this.watchlist = config.watchlist || new Set();
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
    const result = await this.db.execute({
      sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency,
              is_active, created_at, source_class, adapter_version)
            VALUES (?, ?, 'api', 'primary', 'registry', 'weekly',
              1, datetime('now'), 'AUTHORITATIVE_REGISTER', '1.0')`,
      args: [SOURCE_NAME, API_BASE],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[GLEIF] Bron geregistreerd: id=${this.sourceId}`);
  }

  /**
   * Laad de watchlist vanuit entity_identifiers in de database.
   * Bekende lokale LEI's worden altijd gevolgd, ongeacht adres.
   */
  async _loadWatchlist() {
    if (this.watchlist.size > 0) return; // al extern ingesteld
    try {
      const result = await this.db.execute({
        sql: `SELECT DISTINCT ei.value FROM entity_identifiers ei
              WHERE ei.identifier_type = 'lei'`,
        args: [],
      });
      for (const row of result.rows) {
        this.watchlist.add(String(row.value));
      }
      if (this.watchlist.size > 0) {
        console.log(`[GLEIF] ${this.watchlist.size} LEI's op watchlist`);
      }
    } catch {
      // Tabel bestaat mogelijk nog niet; dat is prima
    }
  }

  /**
   * Haal GLEIF-records op via de API.
   * Twee queries: (1) adresfilter op Amersfoort/Leusden, (2) watchlist-LEI's.
   */
  async _fetchAndParse() {
    const allRecords = new Map(); // lei -> compactRecord

    // Query 1: lokale entities op adres
    for (const city of FILTER_CITIES) {
      console.log(`[GLEIF] Ophalen voor ${city}...`);
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= MAX_PAGES) {
        const url = new URL(API_BASE);
        url.searchParams.set('filter[entity.legalAddress.city]', city);
        url.searchParams.set('page[size]', String(PAGE_SIZE));
        url.searchParams.set('page[number]', String(page));

        const response = await this.fetchImpl(url.toString(), {
          headers: {
            Accept: 'application/vnd.api+json',
            'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
          },
        });
        if (!response.ok) throw new Error(`GLEIF API fout: ${response.status}`);
        const json = await response.json();
        const data = json.data || [];

        for (const entity of data) {
          const record = compactRecord(entity);
          if (record.lei) allRecords.set(record.lei, record);
        }

        hasMore = data.length >= PAGE_SIZE && json.links?.next;
        page++;
      }

      // Ook op headquartersAddress zoeken
      page = 1;
      hasMore = true;
      while (hasMore && page <= MAX_PAGES) {
        const url = new URL(API_BASE);
        url.searchParams.set('filter[entity.headquartersAddress.city]', city);
        url.searchParams.set('page[size]', String(PAGE_SIZE));
        url.searchParams.set('page[number]', String(page));

        const response = await this.fetchImpl(url.toString(), {
          headers: {
            Accept: 'application/vnd.api+json',
            'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
          },
        });
        if (!response.ok) throw new Error(`GLEIF API fout (HQ): ${response.status}`);
        const json = await response.json();
        const data = json.data || [];

        for (const entity of data) {
          const record = compactRecord(entity);
          if (record.lei && !allRecords.has(record.lei)) {
            allRecords.set(record.lei, record);
          }
        }

        hasMore = data.length >= PAGE_SIZE && json.links?.next;
        page++;
      }
    }

    // Query 2: watchlist-LEI's die niet al gevonden zijn
    const missingWatchlist = [...this.watchlist].filter(lei => !allRecords.has(lei));
    if (missingWatchlist.length > 0) {
      console.log(`[GLEIF] ${missingWatchlist.length} watchlist-LEI's apart ophalen...`);
      // GLEIF API ondersteunt filter[lei] met komma-gescheiden waarden (max ~20 per request)
      const chunks = [];
      for (let i = 0; i < missingWatchlist.length; i += 20) {
        chunks.push(missingWatchlist.slice(i, i + 20));
      }
      for (const chunk of chunks) {
        const url = new URL(API_BASE);
        url.searchParams.set('filter[lei]', chunk.join(','));
        url.searchParams.set('page[size]', String(PAGE_SIZE));

        const response = await this.fetchImpl(url.toString(), {
          headers: {
            Accept: 'application/vnd.api+json',
            'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
          },
        });
        if (!response.ok) {
          console.warn(`[GLEIF] Watchlist-query mislukt: ${response.status}`);
          continue;
        }
        const json = await response.json();
        for (const entity of json.data || []) {
          const record = compactRecord(entity);
          if (record.lei) allRecords.set(record.lei, record);
        }
      }
    }

    console.log(`[GLEIF] ${allRecords.size} unieke LEI-records opgehaald`);
    return [...allRecords.values()];
  }

  /**
   * Haal parent/child-relaties op voor een lijst LEI's.
   */
  async _fetchRelationships(leis) {
    const relations = new Map(); // lei -> [relaties]
    for (const lei of leis) {
      try {
        const url = `${RELATIONS_BASE}/${lei}/direct-parent-relationships`;
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.api+json',
            'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
          },
        });
        if (response.ok) {
          const json = await response.json();
          const parsed = parseRelationships(json.data);
          if (parsed.length > 0) relations.set(lei, parsed);
        }
      } catch {
        // Relatie-ophaal mislukt is niet fataal
      }
    }
    return relations;
  }

  /** Haal het vorige snapshot op uit source_records. */
  async _getPreviousSnapshot() {
    const result = await this.db.execute({
      sql: `SELECT id, raw_object, semantic_hash FROM source_records
            WHERE source_id = ? AND source_key = 'gleif_full'
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

  /** Sla het huidige snapshot op in source_records. */
  async _saveSnapshot(records, relations, previousState = null) {
    if (this.dryRun) return;
    const snapshot = {};
    for (const record of records) {
      snapshot[record.lei] = {
        hash: gleifSemanticHash(record),
        ...record,
        parentRelations: relations.get(record.lei) || [],
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
            VALUES (?, 'gleif_full', ?, ?, ?, ?, ?)`,
      args: [this.sourceId, rawObject, contentHash, newSemanticHash,
        previousState?.id || null, previousState ? 'changed' : 'added'],
    });
  }

  /** Vergelijk huidig met vorig snapshot en detecteer wijzigingen. */
  _diff(currentRecords, currentRelations, previousSnapshot) {
    const events = [];
    const currentMap = {};

    for (const record of currentRecords) {
      currentMap[record.lei] = record;

      if (!previousSnapshot || !previousSnapshot[record.lei]) {
        events.push({ type: 'LEI_ENTITY_ADDED', lei: record.lei, record });
        continue;
      }

      const prev = previousSnapshot[record.lei];
      const currentHash = gleifSemanticHash(record);

      if (currentHash !== prev.hash) {
        // Specifieke wijzigingen detecteren
        if (record.legalName !== (prev.legalName || '')) {
          events.push({ type: 'LEGAL_NAME_CHANGED', lei: record.lei, record, prev });
        }
        if (record.hqCity !== (prev.hqCity || '') || record.hqAddressLines !== (prev.hqAddressLines || '')) {
          events.push({ type: 'HEADQUARTERS_CHANGED', lei: record.lei, record, prev });
        }
        if (record.status !== (prev.status || '') || record.registrationStatus !== (prev.registrationStatus || '')) {
          events.push({ type: 'ENTITY_STATUS_CHANGED', lei: record.lei, record, prev });
        }
        if (record.successorLei && record.successorLei !== (prev.successorLei || '')) {
          events.push({ type: 'SUCCESSOR_RECORDED', lei: record.lei, record, prev });
        }
      }

      // Controleer parent-relaties
      const prevRelations = prev.parentRelations || [];
      const curRelations = currentRelations.get(record.lei) || [];
      const prevRelHash = JSON.stringify(prevRelations.map(r => `${r.startLei}:${r.endLei}:${r.type}`).sort());
      const curRelHash = JSON.stringify(curRelations.map(r => `${r.startLei}:${r.endLei}:${r.type}`).sort());
      if (prevRelHash !== curRelHash) {
        events.push({ type: 'PARENT_RELATION_CHANGED', lei: record.lei, record, prev,
          relations: { current: curRelations, previous: prevRelations } });
      }
    }

    // Verdwenen LEI's: niet als REMOVED markeren, maar als statuswijziging.
    // Een verlopen LEI is historisch, niet verwijderd.
    if (previousSnapshot) {
      for (const lei of Object.keys(previousSnapshot)) {
        if (!currentMap[lei]) {
          const prev = previousSnapshot[lei];
          // Alleen als de vorige status actief was
          if (prev.status !== 'INACTIVE' && prev.registrationStatus !== 'RETIRED') {
            events.push({
              type: 'ENTITY_STATUS_CHANGED',
              lei,
              record: { ...prev, status: 'NOT_IN_RESPONSE', registrationStatus: 'UNKNOWN' },
              prev,
              note: 'Verdwenen uit lokale resultaten; mogelijk adreswijziging of registratie-update',
            });
          }
        }
      }
    }

    return events;
  }

  /** Verwerk een gedetecteerd event. */
  async _processEvent(event) {
    const record = event.record || {};
    const prev = event.prev || {};
    const naam = record.legalName || prev.legalName || 'Onbekend';
    const lei = event.lei;
    const sourceUrl = `https://search.gleif.org/#/record/${lei}`;

    let title, description;
    switch (event.type) {
      case 'LEI_ENTITY_ADDED':
        title = `Nieuw LEI-record: ${naam}`;
        description = `${naam} (LEI ${lei}) opgenomen in GLEIF. Status: ${record.status}. Adres: ${record.hqCity || record.legalCity}, ${record.hqCountry || record.legalCountry}.`;
        break;
      case 'LEGAL_NAME_CHANGED':
        title = `Naamswijziging: ${prev.legalName || '?'} → ${naam}`;
        description = `LEI ${lei} heeft een naamswijziging: van "${prev.legalName || '?'}" naar "${naam}".`;
        break;
      case 'HEADQUARTERS_CHANGED':
        title = `Hoofdkantoor verhuisd: ${naam}`;
        description = `Hoofdkantooradres van ${naam} (LEI ${lei}) gewijzigd van ${prev.hqCity || '?'} naar ${record.hqCity || '?'}.`;
        break;
      case 'ENTITY_STATUS_CHANGED':
        title = `Statuswijziging: ${naam}`;
        description = `Status van ${naam} (LEI ${lei}) gewijzigd van ${prev.status || '?'}/${prev.registrationStatus || '?'} naar ${record.status || '?'}/${record.registrationStatus || '?'}.${event.note ? ' ' + event.note : ''}`;
        break;
      case 'PARENT_RELATION_CHANGED':
        title = `Concernrelatie gewijzigd: ${naam}`;
        description = `Parent/child-relatie van ${naam} (LEI ${lei}) is gewijzigd.`;
        break;
      case 'SUCCESSOR_RECORDED':
        title = `Opvolger geregistreerd: ${naam}`;
        description = `${naam} (LEI ${lei}) heeft opvolger LEI ${record.successorLei} geregistreerd.`;
        break;
      default:
        title = `GLEIF-wijziging: ${naam}`;
        description = `Wijziging gedetecteerd voor ${naam} (LEI ${lei}).`;
    }

    if (this.dryRun) {
      console.log(`[GLEIF][DRY] ${event.type}: ${title}`);
      return;
    }

    // Sla op als raw_item
    try {
      await this.db.execute({
        sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary,
                scraped_at, content_hash, is_processed, published_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0, datetime('now'))`,
        args: [
          this.sourceId, sourceUrl, title,
          JSON.stringify({ event: event.type, current: record, previous: prev, relations: event.relations }),
          description, `${event.type}::${lei}`,
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[GLEIF] raw_item fout: ${err.message}`);
    }

    // Maak kg_event
    try {
      await this.db.execute({
        sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                source_id, source_url, source_identifier, parser_version, provenance, created_at)
              VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, '1.0', ?, datetime('now'))`,
        args: [
          event.type, title, description,
          this.sourceId, sourceUrl, lei,
          JSON.stringify({
            source_name: SOURCE_NAME,
            source_class: 'AUTHORITATIVE_REGISTER',
            source_url: sourceUrl,
            current: record,
            previous: prev,
            relations: event.relations || null,
          }),
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[GLEIF] kg_event fout: ${err.message}`);
    }

    // Registreer LEI als entity_identifier
    if (lei && !this.dryRun) {
      try {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url, verified_at)
                SELECT e.id, 'lei', ?, ?, datetime('now')
                FROM kg_entities e
                WHERE e.canonical_name = ? AND e.entity_type = 'organization'
                LIMIT 1`,
          args: [lei, sourceUrl, record.legalName || prev.legalName],
        });
      } catch {
        // Entiteit bestaat mogelijk nog niet; dat is prima
      }
    }

    // Schrijf parent-relatie naar kg_relations indien beschikbaar.
    // kg_relations verwacht integer FK's (subject_id, object_id → kg_entities.id).
    // We resolven LEI's naar entity-ID's; als een van beide niet bestaat, slaan we over.
    if (event.type === 'PARENT_RELATION_CHANGED' && event.relations?.current && !this.dryRun) {
      for (const rel of event.relations.current) {
        try {
          const subjectRow = await this.db.execute({
            sql: `SELECT ke.id FROM kg_entities ke
                  JOIN entity_identifiers ei ON ei.entity_id = ke.id
                  WHERE ei.identifier_type = 'lei' AND ei.value = ?
                  LIMIT 1`,
            args: [rel.startLei],
          });
          const objectRow = await this.db.execute({
            sql: `SELECT ke.id FROM kg_entities ke
                  JOIN entity_identifiers ei ON ei.entity_id = ke.id
                  WHERE ei.identifier_type = 'lei' AND ei.value = ?
                  LIMIT 1`,
            args: [rel.endLei],
          });
          if (subjectRow.rows.length === 0 || objectRow.rows.length === 0) {
            console.log(`[GLEIF] Relatie overgeslagen: LEI ${rel.startLei} → ${rel.endLei} (entiteit niet gevonden)`);
            continue;
          }
          const predicate = rel.type === 'IS_ULTIMATELY_CONSOLIDATED_BY'
            ? 'ONDERDEEL_VAN' : 'ONDERDEEL_VAN';
          await this.db.execute({
            sql: `INSERT OR IGNORE INTO kg_relations
                  (subject_id, predicate, object_id, source_url, evidence, confidence, created_at)
                  VALUES (?, ?, ?, ?, ?, 0.95, datetime('now'))`,
            args: [
              subjectRow.rows[0].id,
              predicate,
              objectRow.rows[0].id,
              sourceUrl,
              JSON.stringify(rel),
            ],
          });
        } catch (err) {
          if (!err.message.includes('UNIQUE')) console.error(`[GLEIF] kg_relations fout: ${err.message}`);
        }
      }
    }
  }

  async health() {
    try {
      const url = new URL(API_BASE);
      url.searchParams.set('page[size]', '1');
      url.searchParams.set('filter[entity.legalAddress.city]', 'Amersfoort');
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          Accept: 'application/vnd.api+json',
          'User-Agent': 'Stadsgeest/1.0',
        },
      });
      return {
        status: response.ok ? 'ok' : 'error',
        message: `API ${response.ok ? 'bereikbaar' : 'onbereikbaar'} (${response.status})`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { status: 'error', message: err.message, timestamp: new Date().toISOString() };
    }
  }

  async run() {
    console.log('[GLEIF] Start run...');
    await this._ensureSource();
    await this._loadWatchlist();

    const records = await this._fetchAndParse();
    const relations = await this._fetchRelationships(records.map(r => r.lei));
    const previousState = await this._getPreviousSnapshot();
    const previousSnapshot = previousState?.snapshot || null;
    const events = this._diff(records, relations, previousSnapshot);

    console.log(`[GLEIF] ${events.length} wijzigingen gedetecteerd${previousSnapshot ? '' : ' (baseline, alles is nieuw)'}`);

    // Baseline: sla snapshot op zonder events te genereren
    if (!previousSnapshot) {
      console.log(`[GLEIF] Baseline — snapshot opslaan zonder events`);
      await this._saveSnapshot(records, relations, previousState);
      return { total: records.length, events: 0, baseline: true, watchlist: this.watchlist.size };
    }

    for (const event of events) {
      await this._processEvent(event);
    }

    await this._saveSnapshot(records, relations, previousState);

    const summary = {
      total: records.length,
      events: events.length,
      baseline: false,
      added: events.filter(e => e.type === 'LEI_ENTITY_ADDED').length,
      nameChanged: events.filter(e => e.type === 'LEGAL_NAME_CHANGED').length,
      hqChanged: events.filter(e => e.type === 'HEADQUARTERS_CHANGED').length,
      statusChanged: events.filter(e => e.type === 'ENTITY_STATUS_CHANGED').length,
      parentChanged: events.filter(e => e.type === 'PARENT_RELATION_CHANGED').length,
      successorRecorded: events.filter(e => e.type === 'SUCCESSOR_RECORDED').length,
      watchlist: this.watchlist.size,
    };
    console.log(`[GLEIF] Klaar: ${JSON.stringify(summary)}`);
    return summary;
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const adapter = new GleifRegisterAdapter({ dryRun });
  adapter.run()
    .then(r => { console.log('Resultaat:', r); process.exit(0); })
    .catch(err => { console.error('Fataal:', err); process.exit(1); });
}

module.exports = {
  GleifRegisterAdapter,
  // Geëxporteerd voor testen
  compactRecord,
  extractCities,
  isLocalEntity,
  isWatchlisted,
  gleifSemanticHash,
  normalizeCity,
  parseRelationships,
};
