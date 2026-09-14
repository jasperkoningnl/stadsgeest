// Integratietests: controleren dat adapter-writes correct aankomen in het KG-schema.
// Gebruikt @libsql/client met :memory: als in-memory database.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

// --- Schema-setup: exact overgenomen uit migrate-kg-m1m2m3.cjs ---

const SCHEMA_SQL = [
  // Minimale sources-tabel (nodig als FK-doel)
  `CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    source_type TEXT,
    reliability TEXT,
    category TEXT,
    scrape_frequency TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    source_class TEXT,
    adapter_version TEXT,
    source_manifest TEXT,
    health TEXT
  )`,

  // Minimale raw_items-tabel (sommige adapters schrijven hier ook naar)
  `CREATE TABLE IF NOT EXISTS raw_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    external_url TEXT,
    title TEXT,
    content TEXT,
    summary TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    content_hash TEXT,
    is_processed INTEGER DEFAULT 0,
    published_at TEXT,
    full_text TEXT,
    entities_scanned_at TEXT,
    raw_hash TEXT,
    semantic_hash TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS kg_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('person','organization','location')),
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    source_person_id INTEGER,
    source_org_id INTEGER,
    merged_into_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS entity_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    identifier_type TEXT NOT NULL CHECK(identifier_type IN (
      'kvk','rsin','bag_id','ecli','anbi','website','lei','bsn_hash',
      'wikidata','linkedin','twitter','bluesky'
    )),
    value TEXT NOT NULL,
    source_url TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(identifier_type, value)
  )`,

  `CREATE TABLE IF NOT EXISTS kg_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    match_mode TEXT NOT NULL DEFAULT 'ci' CHECK(match_mode IN ('ci','cs')),
    source TEXT,
    score_weight INTEGER NOT NULL DEFAULT 35,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_id, normalized_alias, match_mode)
  )`,

  `CREATE TABLE IF NOT EXISTS kg_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES kg_entities(id),
    predicate TEXT NOT NULL CHECK(predicate IN (
      'FUNCTIE','EIGENAAR','BESTUURDER','TOEZICHTHOUDER',
      'PARTNER','LEVERANCIER','HUURDER','SUBSIDIEGEVER',
      'SUBSIDIE_ONTVANGER','LID','OPRICHTER','AANDEELHOUDER',
      'ONDERDEEL_VAN','OPVOLGER_VAN'
    )),
    object_id INTEGER NOT NULL REFERENCES kg_entities(id),
    role_title TEXT,
    valid_from TEXT,
    valid_until TEXT,
    source_url TEXT,
    evidence TEXT,
    confidence REAL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS kg_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    occurred_at TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_id INTEGER REFERENCES sources(id),
    source_url TEXT,
    source_identifier TEXT,
    raw_object_hash TEXT,
    parser_version TEXT,
    detection_rule TEXT,
    provenance TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS event_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES kg_events(id),
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    role TEXT NOT NULL DEFAULT 'subject'
      CHECK(role IN ('subject','object','location','related')),
    evidence TEXT,
    confidence REAL DEFAULT 1.0,
    UNIQUE(event_id, entity_id, role)
  )`,

  `CREATE TABLE IF NOT EXISTS source_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    source_key TEXT NOT NULL,
    raw_object TEXT,
    content_hash TEXT NOT NULL,
    semantic_hash TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    previous_id INTEGER REFERENCES source_records(id),
    change_type TEXT CHECK(change_type IN ('added','changed','removed','corrected','retracted')),
    UNIQUE(source_id, source_key, content_hash)
  )`,
];

async function createTestDb() {
  const db = createClient({ url: ':memory:' });
  for (const sql of SCHEMA_SQL) {
    await db.execute(sql);
  }
  return db;
}

async function insertTestSource(db, name = 'Test Bron') {
  const result = await db.execute({
    sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency,
            is_active, created_at, source_class, adapter_version)
          VALUES (?, 'https://test.nl', 'api', 'primary', 'government', 'daily',
            1, datetime('now'), 'AUTHORITATIVE_EVENT', '1.0')`,
    args: [name],
  });
  return Number(result.lastInsertRowid);
}

async function insertTestEntity(db, name, type = 'organization') {
  const result = await db.execute({
    sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
          VALUES (?, ?, ?)`,
    args: [type, name, name.toLowerCase()],
  });
  return Number(result.lastInsertRowid);
}

// ============================================================
// ANBI: kg_events en entity_identifiers
// ============================================================

describe('ANBI adapter — kg_events schrijft correct schema', () => {
  const { AnbiRegisterAdapter } = require('../../src/kg/adapters/anbi-register.cjs');

  it('schrijft kg_event met summary en provenance (niet description/raw_data)', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'ANBI Test');

    const adapter = new AnbiRegisterAdapter({ db, dryRun: false });
    adapter.sourceId = sourceId;

    // Roep _processEvent direct aan met een ANBI_ADDED event
    await adapter._processEvent({
      type: 'ANBI_ADDED',
      key: '123456789',
      record: { rsin: '123456789', dossiernummer: 'D001', naam: 'Stichting Test', vestigingsplaats: 'Amersfoort', website: 'https://test.nl' },
      prev: {},
    });

    const rows = (await db.execute('SELECT * FROM kg_events')).rows;
    assert.equal(rows.length, 1, 'precies één kg_event verwacht');

    const row = rows[0];
    assert.equal(row.event_type, 'ANBI_ADDED');
    assert.equal(row.source_id, sourceId);
    assert.equal(row.source_identifier, '123456789');
    assert.ok(row.title.includes('Stichting Test'), 'title bevat naam');
    assert.ok(row.summary, 'summary mag niet leeg zijn');
    assert.ok(row.parser_version, 'parser_version moet gezet zijn');
    assert.ok(row.provenance, 'provenance moet gezet zijn');

    // Controleer dat provenance geldig JSON is
    const prov = JSON.parse(row.provenance);
    assert.ok(prov.source_name, 'provenance bevat source_name');
    assert.ok(prov.source_class, 'provenance bevat source_class');
  });

  it('schrijft entity_identifier met identifier_type en juiste FK naar kg_entities', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'ANBI Test');
    const entityId = await insertTestEntity(db, 'Stichting Test');

    const adapter = new AnbiRegisterAdapter({ db, dryRun: false });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'ANBI_ADDED',
      key: '999888777',
      record: { rsin: '999888777', dossiernummer: 'D100', naam: 'Stichting Test', vestigingsplaats: 'Amersfoort', website: '' },
      prev: {},
    });

    const eiRows = (await db.execute('SELECT * FROM entity_identifiers')).rows;
    assert.equal(eiRows.length, 1, 'precies één entity_identifier verwacht');
    assert.equal(eiRows[0].entity_id, entityId);
    assert.equal(eiRows[0].identifier_type, 'rsin');
    assert.equal(eiRows[0].value, '999888777');
    assert.ok(eiRows[0].source_url, 'source_url moet gezet zijn');
    assert.ok(eiRows[0].verified_at, 'verified_at moet gezet zijn');
  });

  it('schrijft geen entity_identifier als de entiteit niet bestaat in kg_entities', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'ANBI Test');
    // Geen entiteit aangemaakt

    const adapter = new AnbiRegisterAdapter({ db, dryRun: false });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'ANBI_ADDED',
      key: '111222333',
      record: { rsin: '111222333', dossiernummer: 'D200', naam: 'Onbekende Stichting', vestigingsplaats: 'Amersfoort', website: '' },
      prev: {},
    });

    const eiRows = (await db.execute('SELECT * FROM entity_identifiers')).rows;
    assert.equal(eiRows.length, 0, 'geen entity_identifier als entiteit ontbreekt');
  });
});

// ============================================================
// ANBI: tweerunsbevestiging bij verdwijningen
// ============================================================

describe('ANBI adapter — tweerunsbevestiging ANBI_REMOVED', () => {
  const { AnbiRegisterAdapter, anbiSemanticHash } = require('../../src/kg/adapters/anbi-register.cjs');

  it('slaat pending removal op in snapshot', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'ANBI Test');

    const adapter = new AnbiRegisterAdapter({ db, dryRun: false });
    adapter.sourceId = sourceId;

    const record = { rsin: '100', dossiernummer: '', naam: 'Bestaand', vestigingsplaats: 'Amersfoort', website: '' };
    const prev = {
      '100': { hash: anbiSemanticHash(record), ...record },
      '200': { hash: 'abc', rsin: '200', dossiernummer: '', naam: 'Verdwijnt', vestigingsplaats: 'Amersfoort', website: '' },
    };

    // Run 1: '200' is afwezig
    const events = adapter._diff([record], prev);
    assert.equal(events.filter(e => e.type === 'ANBI_REMOVED').length, 0, 'eerste afwezigheid: geen REMOVED');

    // Sla snapshot op
    await adapter._saveSnapshot([record], null);

    // Lees snapshot terug
    const sr = (await db.execute({
      sql: `SELECT raw_object FROM source_records WHERE source_key = 'anbi_full' ORDER BY id DESC LIMIT 1`,
      args: [],
    })).rows;
    assert.equal(sr.length, 1, 'snapshot moet opgeslagen zijn');
    const snap = JSON.parse(sr[0].raw_object);
    assert.ok(snap['200'], 'verdwenen record moet in snapshot staan');
    assert.ok(snap['200']._pending_removal, 'pending_removal flag moet gezet zijn');
  });
});

// ============================================================
// GLEIF: kg_events, entity_identifiers, kg_relations
// ============================================================

describe('GLEIF adapter — kg_events schrijft correct schema', () => {
  const { GleifRegisterAdapter } = require('../../src/kg/adapters/gleif-register.cjs');

  it('schrijft kg_event met summary en provenance', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'GLEIF Test');

    const adapter = new GleifRegisterAdapter({ db, dryRun: false, watchlist: new Set() });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'LEI_ENTITY_ADDED',
      lei: '724500VKKSH9QOLTR948',
      record: { legalName: 'Test BV', status: 'ACTIVE', hqCity: 'Amersfoort', hqCountry: 'NL', legalCity: 'Amersfoort', legalCountry: 'NL' },
      prev: {},
    });

    const rows = (await db.execute('SELECT * FROM kg_events')).rows;
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.event_type, 'LEI_ENTITY_ADDED');
    assert.equal(row.source_identifier, '724500VKKSH9QOLTR948');
    assert.ok(row.summary, 'summary mag niet leeg zijn');
    assert.ok(row.provenance, 'provenance moet gezet zijn');
    assert.ok(row.parser_version, 'parser_version moet gezet zijn');

    // Geen verboden kolommen
    assert.equal(row.description, undefined, 'description-kolom mag niet bestaan');
    assert.equal(row.raw_data, undefined, 'raw_data-kolom mag niet bestaan');
  });

  it('schrijft entity_identifier met identifier_type lei', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'GLEIF Test');
    const entityId = await insertTestEntity(db, 'Test BV');

    const adapter = new GleifRegisterAdapter({ db, dryRun: false, watchlist: new Set() });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'LEI_ENTITY_ADDED',
      lei: '724500VKKSH9QOLTR948',
      record: { legalName: 'Test BV', status: 'ACTIVE', hqCity: 'Amersfoort' },
      prev: {},
    });

    const eiRows = (await db.execute('SELECT * FROM entity_identifiers')).rows;
    assert.equal(eiRows.length, 1);
    assert.equal(eiRows[0].identifier_type, 'lei');
    assert.equal(eiRows[0].value, '724500VKKSH9QOLTR948');
    assert.equal(eiRows[0].entity_id, entityId);
  });

  it('schrijft kg_relation met integer FK\'s bij PARENT_RELATION_CHANGED', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'GLEIF Test');
    const childId = await insertTestEntity(db, 'Dochter BV');
    const parentId = await insertTestEntity(db, 'Moeder NV');

    // Registreer LEI's zodat de adapter ze kan resolven
    await db.execute({
      sql: `INSERT INTO entity_identifiers (entity_id, identifier_type, value) VALUES (?, 'lei', ?)`,
      args: [childId, 'LEI_CHILD_001'],
    });
    await db.execute({
      sql: `INSERT INTO entity_identifiers (entity_id, identifier_type, value) VALUES (?, 'lei', ?)`,
      args: [parentId, 'LEI_PARENT_001'],
    });

    const adapter = new GleifRegisterAdapter({ db, dryRun: false, watchlist: new Set() });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'PARENT_RELATION_CHANGED',
      lei: 'LEI_CHILD_001',
      record: { legalName: 'Dochter BV', status: 'ACTIVE' },
      prev: {},
      relations: {
        current: [
          { startLei: 'LEI_CHILD_001', endLei: 'LEI_PARENT_001', type: 'IS_DIRECTLY_CONSOLIDATED_BY', status: 'ACTIVE' },
        ],
        previous: [],
      },
    });

    const relRows = (await db.execute('SELECT * FROM kg_relations')).rows;
    assert.equal(relRows.length, 1, 'precies één relatie verwacht');
    assert.equal(relRows[0].subject_id, childId, 'subject_id is integer FK');
    assert.equal(relRows[0].object_id, parentId, 'object_id is integer FK');
    assert.equal(relRows[0].predicate, 'ONDERDEEL_VAN');
    assert.ok(relRows[0].evidence, 'evidence moet gezet zijn');
    assert.equal(relRows[0].confidence, 0.95);
  });

  it('slaat relatie over als entiteit niet gevonden', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'GLEIF Test');
    // Geen entiteiten aangemaakt

    const adapter = new GleifRegisterAdapter({ db, dryRun: false, watchlist: new Set() });
    adapter.sourceId = sourceId;

    await adapter._processEvent({
      type: 'PARENT_RELATION_CHANGED',
      lei: 'ONBEKEND_001',
      record: { legalName: 'Onbekend BV' },
      prev: {},
      relations: {
        current: [
          { startLei: 'ONBEKEND_001', endLei: 'ONBEKEND_002', type: 'IS_DIRECTLY_CONSOLIDATED_BY' },
        ],
        previous: [],
      },
    });

    const relRows = (await db.execute('SELECT * FROM kg_relations')).rows;
    assert.equal(relRows.length, 0, 'geen relatie als entiteiten ontbreken');
  });
});

// ============================================================
// GLEIF: _loadWatchlist gebruikt identifier_type
// ============================================================

describe('GLEIF adapter — _loadWatchlist leest identifier_type', () => {
  const { GleifRegisterAdapter } = require('../../src/kg/adapters/gleif-register.cjs');

  it('laadt LEI-waarden via identifier_type kolom', async () => {
    const db = await createTestDb();
    const entityId = await insertTestEntity(db, 'Watchlist BV');
    await db.execute({
      sql: `INSERT INTO entity_identifiers (entity_id, identifier_type, value) VALUES (?, 'lei', ?)`,
      args: [entityId, 'LEI_WATCH_001'],
    });

    const adapter = new GleifRegisterAdapter({ db, dryRun: true });
    adapter.watchlist = new Set(); // reset
    await adapter._loadWatchlist();

    assert.ok(adapter.watchlist.has('LEI_WATCH_001'), 'LEI moet op watchlist staan');
  });
});

// ============================================================
// OSM: kg_events
// ============================================================

describe('OSM adapter — kg_events schrijft correct schema', () => {
  const { OsmContextAdapter } = require('../../src/kg/adapters/osm-context.cjs');

  it('schrijft kg_event met summary en provenance bij OSM_ENTITY_CANDIDATE', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'OSM Test');

    const adapter = new OsmContextAdapter({ db, dryRun: false, emitSoftEvents: true });
    adapter.sourceId = sourceId;

    const changes = {
      added: [
        { osmId: 'node/12345', name: 'Bakkerij Test', category: 'shop=bakery',
          street: 'Langestraat', housenumber: '10', city: 'Amersfoort',
          operator: '', brand: '', website: '', phone: '', email: '',
          postcode: '3811NJ', lat: 52.155, lon: 5.387 },
      ],
      changed: [],
      removed: [],
    };

    await adapter._processSoftEvents(changes);

    const rows = (await db.execute('SELECT * FROM kg_events')).rows;
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.event_type, 'OSM_ENTITY_CANDIDATE');
    assert.equal(row.source_identifier, 'node/12345');
    assert.ok(row.summary.includes('Bakkerij Test'), 'summary bevat naam');
    assert.ok(row.provenance, 'provenance moet gezet zijn');
    assert.ok(row.parser_version, 'parser_version moet gezet zijn');

    const prov = JSON.parse(row.provenance);
    assert.equal(prov.source_class, 'STRUCTURED_CONTEXT');
  });

  it('schrijft kg_event bij OSM_LOCATION_CHANGED', async () => {
    const db = await createTestDb();
    const sourceId = await insertTestSource(db, 'OSM Test');

    const adapter = new OsmContextAdapter({ db, dryRun: false, emitSoftEvents: true });
    adapter.sourceId = sourceId;

    const changes = {
      added: [],
      changed: [
        {
          current: { osmId: 'way/99', name: 'Café Test', category: 'amenity=cafe',
            street: 'Nieuwe Straat', housenumber: '5', city: 'Amersfoort' },
          previous: { osmId: 'way/99', name: 'Café Test', category: 'amenity=cafe',
            street: 'Oude Straat', housenumber: '3', city: 'Amersfoort' },
        },
      ],
      removed: [],
    };

    await adapter._processSoftEvents(changes);

    const rows = (await db.execute('SELECT * FROM kg_events')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, 'OSM_LOCATION_CHANGED');
    assert.ok(rows[0].summary.includes('Café Test'));
  });
});

// ============================================================
// Schema-validatie: verboden kolommen bestaan niet
// ============================================================

describe('Schema-validatie — verboden kolommen', () => {
  it('kg_events heeft geen description of raw_data kolom', async () => {
    const db = await createTestDb();
    const cols = (await db.execute("PRAGMA table_info(kg_events)")).rows.map(r => r.name);
    assert.ok(!cols.includes('description'), 'kg_events mag geen description-kolom hebben');
    assert.ok(!cols.includes('raw_data'), 'kg_events mag geen raw_data-kolom hebben');
    assert.ok(cols.includes('summary'), 'kg_events moet summary-kolom hebben');
    assert.ok(cols.includes('provenance'), 'kg_events moet provenance-kolom hebben');
  });

  it('entity_identifiers heeft geen namespace kolom', async () => {
    const db = await createTestDb();
    const cols = (await db.execute("PRAGMA table_info(entity_identifiers)")).rows.map(r => r.name);
    assert.ok(!cols.includes('namespace'), 'entity_identifiers mag geen namespace-kolom hebben');
    assert.ok(cols.includes('identifier_type'), 'entity_identifiers moet identifier_type-kolom hebben');
  });

  it('kg_relations heeft subject_id en object_id (integer FK), geen string-velden', async () => {
    const db = await createTestDb();
    const cols = (await db.execute("PRAGMA table_info(kg_relations)")).rows.map(r => r.name);
    assert.ok(cols.includes('subject_id'), 'kg_relations moet subject_id hebben');
    assert.ok(cols.includes('object_id'), 'kg_relations moet object_id hebben');
    assert.ok(cols.includes('predicate'), 'kg_relations moet predicate hebben');
    assert.ok(!cols.includes('relation_type'), 'kg_relations mag geen relation_type hebben');
    assert.ok(!cols.includes('subject_identifier'), 'kg_relations mag geen subject_identifier hebben');
    assert.ok(!cols.includes('object_identifier'), 'kg_relations mag geen object_identifier hebben');
  });
});
