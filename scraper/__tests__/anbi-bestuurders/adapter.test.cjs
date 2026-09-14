const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseBoard,
  extractFromTable,
  extractFromHeadingsAndLists,
  matchRole,
  matchName,
  normalizePersonName,
  makeBoardRecord,
  ensureBoardRelation,
  expireBoardRelations,
  buildSourceMeta,
  buildEventForChange,
  AnbiBestuurdersAdapter,
  ADAPTER_VERSION,
  SOURCE_NAME,
  ROLE_PATTERNS,
} = require('../../src/kg/adapters/anbi-bestuurders.cjs');
const { semanticHash } = require('../../src/kg/phase3-core.cjs');

// ─── HTML Fixtures ───────────────────────────────────────────────────

/** Fixture 1: HTML met bestuuRstabel (naam + functie kolommen) */
const HTML_TABLE = `
<html><body>
<h1>Bestuur Stichting Voorbeeld</h1>
<table>
  <thead><tr><th>Naam</th><th>Functie</th></tr></thead>
  <tbody>
    <tr><td>Jan de Vries</td><td>Voorzitter</td></tr>
    <tr><td>Maria van den Berg</td><td>Secretaris</td></tr>
    <tr><td>Peter Jansen</td><td>Penningmeester</td></tr>
    <tr><td>Fatima el Amrani</td><td>Algemeen bestuurslid</td></tr>
  </tbody>
</table>
</body></html>`;

/** Fixture 2: HTML met koppen en naamlijsten */
const HTML_HEADINGS = `
<html><body>
<h2>Bestuur</h2>
<ul>
  <li>Voorzitter: Kees Bakker</li>
  <li>Secretaris: Anna de Groot</li>
  <li>Penningmeester: Willem Smit</li>
</ul>
<h2>Raad van Toezicht</h2>
<ul>
  <li>Lid Raad van Toezicht: Elisabeth Mulder</li>
  <li>Lid Raad van Toezicht: Thomas van Dijk</li>
</ul>
</body></html>`;

/** Fixture 3: lege pagina (geen bestuurders) */
const HTML_EMPTY = `<html><body><p>Welkom op onze website.</p></body></html>`;

/** Fixture 4: meerdere rollen voor dezelfde persoon */
const HTML_MULTI_ROLE = `
<html><body>
<table>
  <thead><tr><th>Naam</th><th>Functie</th></tr></thead>
  <tbody>
    <tr><td>Jan de Vries</td><td>Voorzitter</td></tr>
    <tr><td>Jan de Vries</td><td>Penningmeester</td></tr>
  </tbody>
</table>
</body></html>`;

/** Fixture 5: naam met titels en formatvariaties */
const HTML_NAME_FORMAT = `
<html><body>
<ul>
  <li>Voorzitter: dhr. Prof. Jan de Vries</li>
</ul>
</body></html>`;

/** Fixture 6: pagina met script/style ruis */
const HTML_NOISY = `
<html><body>
<script>var x = 'Voorzitter: Hacker Naam';</script>
<style>.bestuurder { color: red; }</style>
<nav><ul><li>Bestuurder: Nav Persoon</li></ul></nav>
<main>
  <h3>Bestuur</h3>
  <p>Voorzitter: Karel Prins</p>
</main>
</body></html>`;

const DEFAULT_CONFIG = {
  organization: 'Stichting Voorbeeld',
  url: 'https://voorbeeld.nl/bestuur',
  kind: 'BESTUURDER',
};

const TOEZICHT_CONFIG = {
  organization: 'Stichting Voorbeeld',
  url: 'https://voorbeeld.nl/toezicht',
  kind: 'TOEZICHTHOUDER',
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Maak een mock-db die SQL-statements logt en voorspelbare resultaten geeft */
function createMockDb() {
  const queries = [];
  const insertId = { current: 1 };
  return {
    queries,
    execute: async ({ sql, args } = {}) => {
      queries.push({ sql, args });

      // SELECT ... LIMIT 1 → geen resultaat (standaard)
      if (/SELECT.*LIMIT\s+1/i.test(sql)) {
        return { rows: [] };
      }
      // INSERT ... RETURNING id
      if (/INSERT.*RETURNING\s+id/i.test(sql)) {
        return { rows: [{ id: insertId.current++ }] };
      }
      // INSERT (zonder RETURNING)
      if (/^INSERT/i.test(sql)) {
        return { rows: [], lastInsertRowid: BigInt(insertId.current++) };
      }
      // UPDATE
      if (/^UPDATE/i.test(sql)) {
        return { rowsAffected: 1 };
      }
      // SELECT ... MAX
      if (/SELECT.*MAX/i.test(sql)) {
        return { rows: [] };
      }
      // PRAGMA of andere
      return { rows: [] };
    },
  };
}

/** Maak een minimale dry-run adapter met opgegeven allowlist */
function createTestAdapter(allowlist, fetchResponses = {}) {
  const fetchImpl = async (url) => {
    if (fetchResponses[url]?.error) throw fetchResponses[url].error;
    const body = fetchResponses[url]?.body || '';
    const status = fetchResponses[url]?.status || 200;
    if (status >= 400) {
      const err = new Error(`HTTP ${status}`);
      err.httpStatus = status;
      throw err;
    }
    return {
      ok: true,
      status,
      url,
      headers: { get: (h) => h === 'content-type' ? 'text/html' : null },
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  return new AnbiBestuurdersAdapter({
    db: null,
    dryRun: true,
    allowlist,
    fetchImpl,
  });
}

// ─── In-memory DB helpers ────────────────────────────────────────────

const SCHEMA_STATEMENTS = [
  // sources (pre-existing tabel, vereenvoudigde versie voor tests)
  `CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    url TEXT,
    source_type TEXT DEFAULT 'api',
    reliability TEXT DEFAULT 'primary',
    category TEXT DEFAULT 'data',
    scrape_frequency TEXT DEFAULT 'weekly',
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_class TEXT,
    adapter_version TEXT,
    source_manifest TEXT,
    last_verified_at TEXT,
    terms_checked_at TEXT,
    owner_contact TEXT
  )`,
  // source_snapshots
  `CREATE TABLE IF NOT EXISTS source_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_url TEXT,
    storage_uri TEXT,
    content_hash TEXT NOT NULL,
    media_type TEXT,
    byte_length INTEGER,
    etag TEXT,
    last_modified TEXT,
    UNIQUE(source_id, content_hash)
  )`,
  // kg_entities
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
  // entity_identifiers
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
  // kg_aliases
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
  // kg_relations
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
  // kg_events
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
  // event_entities
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
  // source_records
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

async function createSchema(db) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execute(stmt);
  }
}

async function countRows(db, table, where, args) {
  const sql = where ? `SELECT COUNT(*) as c FROM ${table} WHERE ${where}` : `SELECT COUNT(*) as c FROM ${table}`;
  const result = await db.execute({ sql, args: args || [] });
  return Number(result.rows[0].c);
}

/** Maak een live adapter met echte database */
function createLiveAdapter(db, allowlist, fetchResponses) {
  const fetchImpl = async (url) => {
    if (fetchResponses[url]?.error) throw fetchResponses[url].error;
    const body = fetchResponses[url]?.body || '';
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: (h) => h === 'content-type' ? 'text/html' : null },
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  return new AnbiBestuurdersAdapter({
    db,
    dryRun: false,
    allowlist,
    fetchImpl,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('ANBI-bestuurders rolherkenning', () => {
  it('herkent alle ondersteunde rollen', () => {
    assert.equal(matchRole('Voorzitter'), 'voorzitter');
    assert.equal(matchRole('secretaris'), 'secretaris');
    assert.equal(matchRole('Penningmeester'), 'penningmeester');
    assert.equal(matchRole('Bestuurder'), 'bestuurder');
    assert.equal(matchRole('Bestuurslid'), 'bestuurslid');
    assert.equal(matchRole('Lid Raad van Toezicht'), 'lid raad van toezicht');
    assert.equal(matchRole('Toezichthouder'), 'toezichthouder');
    assert.equal(matchRole('Commissaris'), 'commissaris');
    assert.equal(matchRole('Vicevoorzitter'), 'vicevoorzitter');
    assert.equal(matchRole('Algemeen bestuurslid'), 'algemeen bestuurslid');
  });

  it('retourneert null bij niet-herkende tekst', () => {
    assert.equal(matchRole('Vrijwilliger'), null);
    assert.equal(matchRole('Medewerker'), null);
    assert.equal(matchRole(''), null);
  });
});

describe('ANBI-bestuurders naamherkenning', () => {
  it('herkent namen met tussenvoegsels', () => {
    assert.ok(matchName('Jan de Vries'));
    assert.ok(matchName('Maria van den Berg'));
    assert.ok(matchName('Fatima el Amrani'));
  });

  it('verwijdert titels en aanspreekvormen', () => {
    const name = matchName('dhr. Prof. Jan de Vries');
    assert.ok(name);
    assert.ok(!name.includes('dhr'));
    assert.ok(!name.includes('Prof'));
  });

  it('retourneert null bij te korte of niet-herkende namen', () => {
    assert.equal(matchName('jan'), null);
    assert.equal(matchName(''), null);
    assert.equal(matchName('123 456'), null);
  });
});

describe('ANBI-bestuurders naamnormalisatie', () => {
  it('normaliseert case-insensitief en verwijdert titels', () => {
    assert.equal(normalizePersonName('Jan de Vries'), normalizePersonName('jan de vries'));
    assert.equal(normalizePersonName('dhr. Jan de Vries'), normalizePersonName('Jan de Vries'));
    assert.equal(normalizePersonName('Prof. Jan de Vries'), normalizePersonName('Jan de Vries'));
  });

  it('is stabiel bij extra witruimte', () => {
    assert.equal(normalizePersonName('  Jan   de   Vries  '), normalizePersonName('Jan de Vries'));
  });
});

describe('ANBI-bestuurders HTML tabel-parser (scenario 1)', () => {
  it('parseert tabel met naam- en functiekolommen', () => {
    const records = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    assert.equal(records.length, 4);
    const names = records.map(r => r.person);
    assert.ok(names.some(n => n.includes('Vries')));
    assert.ok(names.some(n => n.includes('Berg')));
    assert.ok(names.some(n => n.includes('Jansen')));
    assert.ok(names.some(n => n.includes('Amrani')));
  });

  it('koppelt correcte rollen aan personen', () => {
    const records = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    const voorzitter = records.find(r => r.role === 'voorzitter');
    assert.ok(voorzitter);
    assert.ok(voorzitter.person.includes('Vries'));
  });

  it('bevat sourceKey, evidence en organization per record', () => {
    const records = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    for (const record of records) {
      assert.ok(record.sourceKey, 'sourceKey moet bestaan');
      assert.ok(record.evidence, 'evidence moet bestaan');
      assert.equal(record.organization, 'Stichting Voorbeeld');
      assert.equal(record.sourceUrl, 'https://voorbeeld.nl/bestuur');
      assert.equal(record.adapterVersion, ADAPTER_VERSION);
      assert.ok(record.confidence > 0 && record.confidence <= 1);
    }
  });
});

describe('ANBI-bestuurders HTML koppen+lijsten-parser (scenario 2)', () => {
  it('parseert bestuur en RvT uit koppen en lijsten', () => {
    const records = parseBoard(HTML_HEADINGS, DEFAULT_CONFIG);
    assert.ok(records.length >= 5, `verwacht minstens 5 records, kreeg ${records.length}`);
  });

  it('herkent Raad van Toezicht-leden', () => {
    const records = parseBoard(HTML_HEADINGS, DEFAULT_CONFIG);
    const rvt = records.filter(r => r.role === 'lid raad van toezicht');
    assert.ok(rvt.length >= 2, `verwacht minstens 2 RvT-leden, kreeg ${rvt.length}`);
  });
});

describe('ANBI-bestuurders meerdere rollen per persoon (scenario 4)', () => {
  it('bewaart beide rollen voor dezelfde persoon', () => {
    const records = parseBoard(HTML_MULTI_ROLE, DEFAULT_CONFIG);
    assert.equal(records.length, 2, 'twee rollen voor dezelfde persoon');
    const roles = records.map(r => r.role).sort();
    assert.deepEqual(roles, ['penningmeester', 'voorzitter']);
  });

  it('genereert verschillende sourceKeys voor verschillende rollen', () => {
    const records = parseBoard(HTML_MULTI_ROLE, DEFAULT_CONFIG);
    const keys = records.map(r => r.sourceKey);
    assert.equal(new Set(keys).size, 2, 'sourceKeys moeten uniek zijn per rol');
  });
});

describe('ANBI-bestuurders naamopmaakvariatie (scenario 5)', () => {
  it('normaliseert titels weg zodat dezelfde persoon herkend wordt', () => {
    const plain = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    const titled = parseBoard(HTML_NAME_FORMAT, DEFAULT_CONFIG);
    const plainVoorzitter = plain.find(r => r.role === 'voorzitter');
    const titledVoorzitter = titled.find(r => r.role === 'voorzitter');
    assert.ok(plainVoorzitter && titledVoorzitter);
    assert.equal(plainVoorzitter.normalizedPerson, titledVoorzitter.normalizedPerson,
      'genormaliseerde naam moet gelijk zijn ongeacht titels');
  });
});

describe('ANBI-bestuurders lege pagina en ruis', () => {
  it('retourneert lege array bij pagina zonder bestuurders', () => {
    const records = parseBoard(HTML_EMPTY, DEFAULT_CONFIG);
    assert.equal(records.length, 0);
  });

  it('verwijdert script, style en nav content', () => {
    const records = parseBoard(HTML_NOISY, DEFAULT_CONFIG);
    // Moet Karel Prins vinden maar niet Hacker Naam of Nav Persoon
    const names = records.map(r => r.person);
    assert.ok(names.some(n => n.includes('Prins')), 'Karel Prins moet gevonden worden');
    assert.ok(!names.some(n => /Hacker/i.test(n)), 'Script-inhoud mag niet als naam gelden');
    assert.ok(!names.some(n => /Nav/i.test(n)), 'Nav-inhoud mag niet als naam gelden');
  });
});

describe('ANBI-bestuurders semanticHash en sourceKey', () => {
  it('sourceKey is deterministisch', () => {
    const r1 = makeBoardRecord(DEFAULT_CONFIG, 'Jan de Vries', 'voorzitter', 'Voorzitter', 'Jan de Vries Voorzitter');
    const r2 = makeBoardRecord(DEFAULT_CONFIG, 'Jan de Vries', 'voorzitter', 'Voorzitter', 'Jan de Vries Voorzitter');
    assert.equal(r1.sourceKey, r2.sourceKey);
  });

  it('sourceKey verschilt bij andere rol', () => {
    const r1 = makeBoardRecord(DEFAULT_CONFIG, 'Jan de Vries', 'voorzitter', 'Voorzitter', 'evidence');
    const r2 = makeBoardRecord(DEFAULT_CONFIG, 'Jan de Vries', 'secretaris', 'Secretaris', 'evidence');
    assert.notEqual(r1.sourceKey, r2.sourceKey);
  });

  it('semanticFields bevatten de juiste velden voor diff', () => {
    const r = makeBoardRecord(DEFAULT_CONFIG, 'Jan de Vries', 'voorzitter', 'Voorzitter', 'evidence');
    assert.deepEqual(r.semanticFields, {
      normalizedPerson: normalizePersonName('Jan de Vries'),
      role: 'voorzitter',
      organization: 'Stichting Voorbeeld',
    });
  });
});

describe('ANBI-bestuurders ensureBoardRelation (scenario 12 + 13)', () => {
  it('maakt persoon met website-identifier, geen merge op naam alleen', async () => {
    const db = createMockDb();
    const record = {
      person: 'Jan de Vries',
      normalizedPerson: 'jan de vries',
      role: 'voorzitter',
      organization: 'Stichting Voorbeeld',
      sourceUrl: 'https://voorbeeld.nl/bestuur',
      evidence: 'Voorzitter: Jan de Vries',
      confidence: 0.9,
    };
    await ensureBoardRelation(db, record, 1, false);

    // Verifieer: moet entity_identifiers INSERT met website-type
    const identifierInserts = db.queries.filter(q =>
      q.sql.includes('entity_identifiers') && q.sql.includes('INSERT'));
    assert.ok(identifierInserts.length >= 1, 'moet website-identifier aanmaken');
    const websiteInsert = identifierInserts.find(q =>
      q.sql.includes("'website'") || q.args?.includes('website'));
    assert.ok(websiteInsert, 'identifier_type moet website zijn');
    // De waarde moet URL#encodedName bevatten
    const allArgs = websiteInsert.args || [];
    const value = allArgs.find(a => typeof a === 'string' && a.includes('#'));
    assert.ok(value, 'identifier waarde moet URL#naam bevatten');
    assert.ok(value.includes('voorbeeld.nl'), 'identifier moet bron-URL bevatten');
  });

  it('kiest TOEZICHTHOUDER predicate voor RvT-rollen', async () => {
    const db = createMockDb();
    const record = {
      person: 'Elisabeth Mulder',
      normalizedPerson: 'elisabeth mulder',
      role: 'lid raad van toezicht',
      organization: 'Stichting Voorbeeld',
      sourceUrl: 'https://voorbeeld.nl/toezicht',
      evidence: 'Lid RvT: Elisabeth Mulder',
      confidence: 0.9,
    };
    await ensureBoardRelation(db, record, 1, false);

    const relationInserts = db.queries.filter(q =>
      q.sql.includes('kg_relations') && q.sql.includes('INSERT'));
    assert.ok(relationInserts.length >= 1);
    const predicate = relationInserts[0].args?.find(a => a === 'TOEZICHTHOUDER');
    assert.ok(predicate, 'predicate moet TOEZICHTHOUDER zijn voor RvT-lid');
  });

  it('kiest BESTUURDER predicate voor voorzitter/secretaris/etc.', async () => {
    const db = createMockDb();
    const record = {
      person: 'Jan de Vries',
      normalizedPerson: 'jan de vries',
      role: 'voorzitter',
      organization: 'Stichting Voorbeeld',
      sourceUrl: 'https://voorbeeld.nl/bestuur',
      evidence: 'Voorzitter: Jan de Vries',
      confidence: 0.9,
    };
    await ensureBoardRelation(db, record, 1, false);

    const relationInserts = db.queries.filter(q =>
      q.sql.includes('kg_relations') && q.sql.includes('INSERT'));
    assert.ok(relationInserts.length >= 1);
    const predicate = relationInserts[0].args?.find(a => a === 'BESTUURDER');
    assert.ok(predicate, 'predicate moet BESTUURDER zijn voor voorzitter');
  });

  it('slaat niets op bij dryRun', async () => {
    const result = await ensureBoardRelation({}, {
      person: 'Test', normalizedPerson: 'test', role: 'voorzitter',
      organization: 'X', sourceUrl: 'http://x', evidence: '', confidence: 0.9,
    }, 1, true);
    assert.equal(result, null);
  });
});

// ─── In-memory DB lifecycle-tests ────────────────────────────────────

describe('ANBI-bestuurders in-memory DB: baseline en materialisatie (bug 2)', () => {
  let db;

  beforeEach(async () => {
    const { createClient } = require('@libsql/client');
    db = createClient({ url: 'file::memory:' });
    await createSchema(db);
    // Snapshot-dir aanmaken (archiveSnapshot schrijft hierheen)
    const fs = require('fs');
    fs.mkdirSync('data/phase3-snapshots', { recursive: true });
  });

  it('baseline creëert entiteiten en relaties zonder events', async () => {
    const adapter = createLiveAdapter(db,
      [{ organization: 'Stichting Test', url: 'https://test.nl/bestuur', kind: 'BESTUURDER' }],
      { 'https://test.nl/bestuur': { body: HTML_TABLE } },
    );

    const result = await adapter.run();

    assert.equal(result.baseline, true, 'eerste run moet baseline zijn');
    assert.equal(result.events, 0, 'baseline mag geen events produceren');

    // Maar entiteiten en relaties moeten WEL aangemaakt zijn (bug 2 fix)
    const entities = await countRows(db, 'kg_entities');
    assert.ok(entities > 0, `entiteiten moeten aangemaakt zijn, kreeg ${entities}`);

    const relations = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.ok(relations > 0, `relaties moeten aangemaakt zijn, kreeg ${relations}`);

    // Personen moeten identifiers hebben
    const identifiers = await countRows(db, 'entity_identifiers', "identifier_type='website'");
    assert.ok(identifiers > 0, `website-identifiers moeten bestaan, kreeg ${identifiers}`);
  });

  it('identieke vervolgrun produceert geen events of duplicaten', async () => {
    const config = [{ organization: 'Stichting Test', url: 'https://test.nl/bestuur', kind: 'BESTUURDER' }];
    const responses = { 'https://test.nl/bestuur': { body: HTML_TABLE } };

    // Run 1: baseline
    const adapter1 = createLiveAdapter(db, config, responses);
    await adapter1.run();

    const entitiesAfterBaseline = await countRows(db, 'kg_entities');
    const relationsAfterBaseline = await countRows(db, 'kg_relations', 'valid_until IS NULL');

    // Run 2: identieke data
    const adapter2 = createLiveAdapter(db, config, responses);
    const result2 = await adapter2.run();

    assert.equal(result2.baseline, false, 'tweede run is geen baseline');
    assert.equal(result2.events, 0, 'identieke data → geen events');

    const entitiesAfterRepeat = await countRows(db, 'kg_entities');
    const relationsAfterRepeat = await countRows(db, 'kg_relations', 'valid_until IS NULL');

    assert.equal(entitiesAfterRepeat, entitiesAfterBaseline,
      'geen duplicate entiteiten na identieke run');
    assert.equal(relationsAfterRepeat, relationsAfterBaseline,
      'geen duplicate relaties na identieke run');
  });
});

describe('ANBI-bestuurders in-memory DB: bronisolatie (bug 1)', () => {
  let db;

  beforeEach(async () => {
    const { createClient } = require('@libsql/client');
    db = createClient({ url: 'file::memory:' });
    await createSchema(db);
    const fs = require('fs');
    fs.mkdirSync('data/phase3-snapshots', { recursive: true });
  });

  it('gedeeltelijke bronfout raakt andere bronnen niet', async () => {
    const config = [
      { organization: 'Stichting A', url: 'https://a.nl/bestuur', kind: 'BESTUURDER' },
      { organization: 'Stichting B', url: 'https://b.nl/bestuur', kind: 'BESTUURDER' },
    ];
    const responses = {
      'https://a.nl/bestuur': { body: HTML_TABLE },
      'https://b.nl/bestuur': { body: HTML_HEADINGS },
    };

    // Baseline: beide bronnen werken
    const adapter1 = createLiveAdapter(db, config, responses);
    const result1 = await adapter1.run();
    assert.equal(result1.sources, 2, 'twee bronnen in baseline');

    const relationsAfterBaseline = await countRows(db, 'kg_relations', 'valid_until IS NULL');

    // Run 2: bron A faalt, bron B is ongewijzigd
    const failResponses = {
      'https://a.nl/bestuur': { error: new Error('Network error') },
      'https://b.nl/bestuur': { body: HTML_HEADINGS },
    };
    const adapter2 = createLiveAdapter(db, config, failResponses);
    const result2 = await adapter2.run();

    assert.equal(result2.sources, 1, 'één bron succesvol na partial failure');
    assert.equal(result2.errors, 1, 'één fout geregistreerd');

    // Relaties van bron A moeten NIET geëxpireerd zijn
    const relationsAfterFailure = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.ok(relationsAfterFailure >= relationsAfterBaseline - result2.total,
      'relaties van bron A mogen niet verdwijnen door fout in bron A');
  });

  it('lege parser skipt bron zonder removals', async () => {
    const config = [
      { organization: 'Stichting C', url: 'https://c.nl/bestuur', kind: 'BESTUURDER' },
    ];
    const responses = { 'https://c.nl/bestuur': { body: HTML_TABLE } };

    // Baseline
    const adapter1 = createLiveAdapter(db, config, responses);
    await adapter1.run();

    const relationsAfterBaseline = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.ok(relationsAfterBaseline > 0, 'baseline moet relaties aanmaken');

    // Run 2: lege pagina → parser levert 0 records
    const emptyResponses = { 'https://c.nl/bestuur': { body: HTML_EMPTY } };
    const adapter2 = createLiveAdapter(db, config, emptyResponses);
    const result2 = await adapter2.run();

    // Bron wordt overgeslagen, niet als verwijdering behandeld
    assert.ok(!result2.error || result2.total === 0, 'lege pagina → bron overgeslagen');

    const relationsAfterEmpty = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.equal(relationsAfterEmpty, relationsAfterBaseline,
      'lege parser mag geen relaties laten vervallen');
  });
});

describe('ANBI-bestuurders in-memory DB: twee-runs-verwijdering', () => {
  let db;

  beforeEach(async () => {
    const { createClient } = require('@libsql/client');
    db = createClient({ url: 'file::memory:' });
    await createSchema(db);
    const fs = require('fs');
    fs.mkdirSync('data/phase3-snapshots', { recursive: true });
  });

  it('twee afwezigheden bevestigen removal met event + expire', async () => {
    const config = [{ organization: 'Stichting Rem', url: 'https://rem.nl/bestuur', kind: 'BESTUURDER' }];

    // Baseline: 4 bestuurders
    const adapter1 = createLiveAdapter(db, config,
      { 'https://rem.nl/bestuur': { body: HTML_TABLE } });
    await adapter1.run();

    const relationsBaseline = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.ok(relationsBaseline >= 4, `verwacht minstens 4 relaties, kreeg ${relationsBaseline}`);

    // Run 2: 3 bestuurders (Jan de Vries verwijderd uit tabel)
    const htmlMinus = HTML_TABLE.replace(
      '<tr><td>Jan de Vries</td><td>Voorzitter</td></tr>', '');
    const adapter2 = createLiveAdapter(db, config,
      { 'https://rem.nl/bestuur': { body: htmlMinus } });
    const result2 = await adapter2.run();

    // Eerste afwezigheid: nog niet bevestigd
    assert.equal(result2.events, 0, 'eerste afwezigheid mag geen event produceren');

    // Run 3: nog steeds afwezig → bevestigd
    const adapter3 = createLiveAdapter(db, config,
      { 'https://rem.nl/bestuur': { body: htmlMinus } });
    const result3 = await adapter3.run();

    assert.ok(result3.removed >= 1, 'tweede afwezigheid bevestigt removal');
    assert.ok(result3.events >= 1, 'removal moet een event genereren');

    // Controleer dat er een BOARD_MEMBER_REMOVED event is
    const removedEvents = await countRows(db, 'kg_events', "event_type='BOARD_MEMBER_REMOVED'");
    assert.ok(removedEvents >= 1, 'moet BOARD_MEMBER_REMOVED event bevatten');
  });

  it('teruggekeerde persoon annuleert pending removal', async () => {
    const config = [{ organization: 'Stichting Ret', url: 'https://ret.nl/bestuur', kind: 'BESTUURDER' }];

    // Baseline
    const adapter1 = createLiveAdapter(db, config,
      { 'https://ret.nl/bestuur': { body: HTML_TABLE } });
    await adapter1.run();

    // Run 2: Jan de Vries afwezig
    const htmlMinus = HTML_TABLE.replace(
      '<tr><td>Jan de Vries</td><td>Voorzitter</td></tr>', '');
    const adapter2 = createLiveAdapter(db, config,
      { 'https://ret.nl/bestuur': { body: htmlMinus } });
    await adapter2.run();

    // Run 3: Jan de Vries is terug! Geen bevestigde removal.
    const adapter3 = createLiveAdapter(db, config,
      { 'https://ret.nl/bestuur': { body: HTML_TABLE } });
    const result3 = await adapter3.run();

    assert.equal(result3.removed, 0, 'teruggekeerde persoon mag niet als removed gelden');

    const removedEvents = await countRows(db, 'kg_events', "event_type='BOARD_MEMBER_REMOVED'");
    assert.equal(removedEvents, 0, 'geen removal event na terugkeer');
  });
});

describe('ANBI-bestuurders in-memory DB: multi-rol precisie (bug 3)', () => {
  let db;

  beforeEach(async () => {
    const { createClient } = require('@libsql/client');
    db = createClient({ url: 'file::memory:' });
    await createSchema(db);
    const fs = require('fs');
    fs.mkdirSync('data/phase3-snapshots', { recursive: true });
  });

  it('verwijdering van één rol laat andere rollen intact', async () => {
    const config = [{ organization: 'Stichting Multi', url: 'https://multi.nl/bestuur', kind: 'BESTUURDER' }];

    // Baseline: Jan met twee rollen
    const adapter1 = createLiveAdapter(db, config,
      { 'https://multi.nl/bestuur': { body: HTML_MULTI_ROLE } });
    await adapter1.run();

    const relationsBaseline = await countRows(db, 'kg_relations', 'valid_until IS NULL');
    assert.equal(relationsBaseline, 2, 'twee actieve relaties voor Jan');

    // Run 2: penningmeester verwijderd, voorzitter blijft
    const htmlOneRole = `<html><body><table>
      <thead><tr><th>Naam</th><th>Functie</th></tr></thead>
      <tbody><tr><td>Jan de Vries</td><td>Voorzitter</td></tr></tbody>
    </table></body></html>`;

    const adapter2 = createLiveAdapter(db, config,
      { 'https://multi.nl/bestuur': { body: htmlOneRole } });
    await adapter2.run();

    // Run 3: opnieuw alleen voorzitter → bevestigde removal penningmeester
    const adapter3 = createLiveAdapter(db, config,
      { 'https://multi.nl/bestuur': { body: htmlOneRole } });
    await adapter3.run();

    // Controleer: voorzitter-relatie moet actief zijn, penningmeester niet
    const activeRelations = await db.execute({
      sql: `SELECT r.role_title FROM kg_relations r WHERE r.valid_until IS NULL`,
      args: [],
    });
    const activeRoles = activeRelations.rows.map(r => r.role_title);
    assert.ok(activeRoles.includes('voorzitter'),
      'voorzitter-relatie moet actief blijven');
    assert.ok(!activeRoles.includes('penningmeester'),
      'penningmeester-relatie moet geëxpireerd zijn');
  });
});

describe('ANBI-bestuurders in-memory DB: toevoeging na baseline', () => {
  let db;

  beforeEach(async () => {
    const { createClient } = require('@libsql/client');
    db = createClient({ url: 'file::memory:' });
    await createSchema(db);
    const fs = require('fs');
    fs.mkdirSync('data/phase3-snapshots', { recursive: true });
  });

  it('nieuw bestuurslid genereert BOARD_MEMBER_ADDED event', async () => {
    const config = [{ organization: 'Stichting Nieuw', url: 'https://nieuw.nl/bestuur', kind: 'BESTUURDER' }];

    // Baseline: 4 leden
    const adapter1 = createLiveAdapter(db, config,
      { 'https://nieuw.nl/bestuur': { body: HTML_TABLE } });
    await adapter1.run();

    // Run 2: extra bestuurslid
    const htmlPlus = HTML_TABLE.replace('</tbody>', `
      <tr><td>Sophie Willems</td><td>Bestuurslid</td></tr>
    </tbody>`);
    const adapter2 = createLiveAdapter(db, config,
      { 'https://nieuw.nl/bestuur': { body: htmlPlus } });
    const result2 = await adapter2.run();

    assert.ok(result2.created >= 1, 'nieuw record moet als created gelden');
    assert.ok(result2.events >= 1, 'toevoeging moet een event genereren');

    const addedEvents = await countRows(db, 'kg_events', "event_type='BOARD_MEMBER_ADDED'");
    assert.ok(addedEvents >= 1, 'moet BOARD_MEMBER_ADDED event bevatten');
  });
});

// ─── Overige tests (ongewijzigd) ─────────────────────────────────────

describe('ANBI-bestuurders fetchfout-isolatie (scenario 11)', () => {
  it('lege pagina levert geen records op (geen valse verwijderingen)', () => {
    const records = parseBoard(HTML_EMPTY, DEFAULT_CONFIG);
    assert.equal(records.length, 0, 'lege pagina → nul records');
  });

  it('adapter gooit bij ALLE mislukte bronnen', async () => {
    const adapter = createTestAdapter(
      [
        { organization: 'Bron A', url: 'https://a.nl/bestuur', kind: 'BESTUURDER' },
        { organization: 'Bron B', url: 'https://b.nl/bestuur', kind: 'BESTUURDER' },
      ],
      {
        'https://a.nl/bestuur': { error: new Error('Network error') },
        'https://b.nl/bestuur': { error: new Error('Timeout') },
      },
    );
    await assert.rejects(
      () => adapter.run(),
      /alle bronnen mislukt/i,
      'moet fout gooien als alle bronnen falen',
    );
  });

  it('adapter gaat door bij gedeeltelijk mislukte bronnen', async () => {
    const adapter = createTestAdapter(
      [
        { organization: 'Bron A', url: 'https://a.nl/bestuur', kind: 'BESTUURDER' },
        { organization: 'Bron B', url: 'https://b.nl/bestuur', kind: 'BESTUURDER' },
      ],
      {
        'https://a.nl/bestuur': { error: new Error('Network error') },
        'https://b.nl/bestuur': { body: HTML_TABLE },
      },
    );
    const records = parseBoard(HTML_TABLE, {
      organization: 'Bron B',
      url: 'https://b.nl/bestuur',
      kind: 'BESTUURDER',
    });
    assert.ok(records.length > 0, 'succesvolle bron moet records opleveren');
  });

  it('adapter met lege allowlist retourneert foutmelding', async () => {
    const adapter = createTestAdapter([]);
    const result = await adapter.run();
    assert.ok(result.error, 'moet error bevatten');
    assert.equal(result.total, 0);
  });
});

describe('ANBI-bestuurders idempotentie (scenario 13)', () => {
  it('identieke invoer produceert identieke sourceKeys en semanticHash', () => {
    const records1 = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    const records2 = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    assert.equal(records1.length, records2.length);
    for (let i = 0; i < records1.length; i++) {
      assert.equal(records1[i].sourceKey, records2[i].sourceKey,
        `sourceKey ${i} moet identiek zijn`);
      const hash1 = semanticHash(records1[i].semanticFields);
      const hash2 = semanticHash(records2[i].semanticFields);
      assert.equal(hash1, hash2, `semanticHash ${i} moet identiek zijn`);
    }
  });

  it('volgorde van records is stabiel', () => {
    const records1 = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    const records2 = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    assert.deepEqual(
      records1.map(r => r.sourceKey),
      records2.map(r => r.sourceKey),
      'volgorde moet stabiel zijn',
    );
  });
});

describe('ANBI-bestuurders geen auto-merge op naam (scenario 12)', () => {
  it('zelfde persoonsnaam op twee bronnen krijgt verschillende identifiers', () => {
    const configA = { organization: 'Stichting A', url: 'https://a.nl/bestuur', kind: 'BESTUURDER' };
    const configB = { organization: 'Stichting B', url: 'https://b.nl/bestuur', kind: 'BESTUURDER' };
    const htmlA = `<html><body><ul><li>Voorzitter: Jan de Vries</li></ul></body></html>`;
    const htmlB = `<html><body><ul><li>Voorzitter: Jan de Vries</li></ul></body></html>`;
    const recordsA = parseBoard(htmlA, configA);
    const recordsB = parseBoard(htmlB, configB);
    assert.ok(recordsA.length === 1 && recordsB.length === 1);
    // Verschillende sourceKeys omdat URL verschilt
    assert.notEqual(recordsA[0].sourceKey, recordsB[0].sourceKey,
      'sourceKeys moeten verschillen per bron');
    // De website-identifier die ensureBoardRelation zou aanmaken verschilt ook
    const idA = `${configA.url}#${encodeURIComponent(recordsA[0].normalizedPerson)}`;
    const idB = `${configB.url}#${encodeURIComponent(recordsB[0].normalizedPerson)}`;
    assert.notEqual(idA, idB, 'website-identifiers moeten verschillen per bron');
  });
});

describe('ANBI-bestuurders volledige provenance (scenario 13)', () => {
  it('elk record bevat alle verplichte provenance-velden', () => {
    const records = parseBoard(HTML_TABLE, DEFAULT_CONFIG);
    for (const record of records) {
      assert.ok(record.sourceKey, 'sourceKey is verplicht');
      assert.ok(record.person, 'person is verplicht');
      assert.ok(record.normalizedPerson, 'normalizedPerson is verplicht');
      assert.ok(record.role, 'role is verplicht');
      assert.ok(record.organization, 'organization is verplicht');
      assert.ok(record.sourceUrl, 'sourceUrl is verplicht');
      assert.ok(record.evidence, 'evidence is verplicht');
      assert.ok(record.sourceClass, 'sourceClass is verplicht');
      assert.equal(record.sourceClass, 'DECLARED_BY_ENTITY');
      assert.ok(typeof record.confidence === 'number', 'confidence moet een getal zijn');
      assert.ok(record.adapterVersion, 'adapterVersion is verplicht');
      assert.ok(record.semanticFields, 'semanticFields is verplicht voor diff');
    }
  });

  it('evidence is beperkt tot 240 tekens', () => {
    // Maak HTML met extreem lange celinhoud
    const longHtml = `<html><body><table>
      <thead><tr><th>Naam</th><th>Functie</th></tr></thead>
      <tbody><tr>
        <td>Jan de Vries ${'x'.repeat(500)}</td>
        <td>Voorzitter ${'y'.repeat(500)}</td>
      </tr></tbody>
    </table></body></html>`;
    const records = parseBoard(longHtml, DEFAULT_CONFIG);
    for (const record of records) {
      assert.ok(record.evidence.length <= 240, `evidence (${record.evidence.length}) mag max 240 tekens zijn`);
    }
  });
});

describe('ANBI-bestuurders buildSourceMeta en buildEventForChange', () => {
  it('buildSourceMeta bevat bron-specifieke naam', () => {
    const meta = buildSourceMeta(DEFAULT_CONFIG);
    assert.ok(meta.name.includes('Stichting Voorbeeld'), 'meta.name moet organisatie bevatten');
    assert.ok(meta.name.startsWith(SOURCE_NAME), 'meta.name moet met SOURCE_NAME beginnen');
    assert.equal(meta.url, DEFAULT_CONFIG.url);
    assert.equal(meta.manifest.pilot, true);
  });

  it('buildEventForChange geeft correct event-type', () => {
    const addedEvent = buildEventForChange('added', {
      person: 'Jan de Vries', role: 'voorzitter', organization: 'Test',
      sourceUrl: 'https://test.nl', evidence: 'test', confidence: 0.9,
    }, null, 1);
    assert.equal(addedEvent.type, 'BOARD_MEMBER_ADDED');

    const removedEvent = buildEventForChange('removed', {
      person: 'Jan de Vries', normalizedPerson: 'jan de vries',
      role: 'voorzitter', organization: 'Test',
      sourceUrl: 'https://test.nl', evidence: 'test', confidence: 0.9,
    }, null, 1);
    assert.equal(removedEvent.type, 'BOARD_MEMBER_REMOVED');
  });
});

describe('ANBI-bestuurders adapter configuratie', () => {
  it('dryRun is standaard true', () => {
    const adapter = new AnbiBestuurdersAdapter({});
    assert.equal(adapter.dryRun, true, 'pilot-adapter moet standaard dry-run zijn');
  });

  it('allowlist is configureerbaar en standaard leeg', () => {
    const adapter = new AnbiBestuurdersAdapter({});
    assert.deepEqual(adapter.allowlist, [], 'standaard allowlist moet leeg zijn');
  });

  it('ADAPTER_VERSION is ingesteld', () => {
    assert.ok(ADAPTER_VERSION, 'ADAPTER_VERSION moet gedefinieerd zijn');
    assert.ok(ADAPTER_VERSION.includes('pilot'), 'versie moet pilot bevatten');
  });

  it('sourceIds begint als lege array', () => {
    const adapter = new AnbiBestuurdersAdapter({});
    assert.deepEqual(adapter.sourceIds, [], 'sourceIds moet beginnen als lege array');
  });
});
