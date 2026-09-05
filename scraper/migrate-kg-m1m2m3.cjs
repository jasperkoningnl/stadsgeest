// Migratie M1, M2, M3 — Stadsgeest 2.0 kennisgraaf
// Alle statements zijn additief (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN)
// Rollback: DROP TABLE IF EXISTS ...; ALTER TABLE ... DROP COLUMN ...
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function hasColumn(table, col) {
  const cols = (await db.execute(`PRAGMA table_info(${table})`)).rows;
  return cols.some(r => r.name === col);
}

async function main() {
  console.log('=== M1: Schema-uitbreidingen op bestaande tabellen ===');

  if (!(await hasColumn('sources', 'source_class'))) {
    await db.execute("ALTER TABLE sources ADD COLUMN source_class TEXT");
    console.log('  sources.source_class toegevoegd');
  } else console.log('  sources.source_class bestaat al');

  if (!(await hasColumn('sources', 'adapter_version'))) {
    await db.execute("ALTER TABLE sources ADD COLUMN adapter_version TEXT");
    console.log('  sources.adapter_version toegevoegd');
  } else console.log('  sources.adapter_version bestaat al');

  if (!(await hasColumn('sources', 'source_manifest'))) {
    await db.execute("ALTER TABLE sources ADD COLUMN source_manifest TEXT");
    console.log('  sources.source_manifest toegevoegd');
  } else console.log('  sources.source_manifest bestaat al');

  if (!(await hasColumn('signals', 'detection_rule'))) {
    await db.execute("ALTER TABLE signals ADD COLUMN detection_rule TEXT");
    console.log('  signals.detection_rule toegevoegd');
  } else console.log('  signals.detection_rule bestaat al');

  if (!(await hasColumn('signals', 'provenance'))) {
    await db.execute("ALTER TABLE signals ADD COLUMN provenance TEXT");
    console.log('  signals.provenance toegevoegd');
  } else console.log('  signals.provenance bestaat al');

  if (!(await hasColumn('raw_items', 'raw_hash'))) {
    await db.execute("ALTER TABLE raw_items ADD COLUMN raw_hash TEXT");
    console.log('  raw_items.raw_hash toegevoegd');
  } else console.log('  raw_items.raw_hash bestaat al');

  if (!(await hasColumn('raw_items', 'semantic_hash'))) {
    await db.execute("ALTER TABLE raw_items ADD COLUMN semantic_hash TEXT");
    console.log('  raw_items.semantic_hash toegevoegd');
  } else console.log('  raw_items.semantic_hash bestaat al');

  console.log('M1 klaar.\n');

  console.log('=== M2: Nieuwe entity-tabellen ===');

  await db.execute(`CREATE TABLE IF NOT EXISTS kg_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('person','organization','location')),
    canonical_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    source_person_id INTEGER,
    source_org_id INTEGER,
    merged_into_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(entity_type)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_kg_entities_norm ON kg_entities(normalized_name)");
  console.log('  kg_entities aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS entity_identifiers (
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
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_eid_entity ON entity_identifiers(entity_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_eid_type_val ON entity_identifiers(identifier_type, value)");
  console.log('  entity_identifiers aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS kg_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    match_mode TEXT NOT NULL DEFAULT 'ci' CHECK(match_mode IN ('ci','cs')),
    source TEXT,
    score_weight INTEGER NOT NULL DEFAULT 35,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_id, normalized_alias, match_mode)
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_kg_aliases_norm ON kg_aliases(normalized_alias)");
  console.log('  kg_aliases aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    street TEXT,
    house_number TEXT,
    postal_code TEXT,
    city TEXT NOT NULL DEFAULT 'Amersfoort',
    municipality TEXT,
    neighborhood TEXT,
    district TEXT,
    bag_id TEXT,
    lat REAL,
    lon REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_loc_bag ON locations(bag_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_loc_postal ON locations(postal_code)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_loc_city ON locations(city)");
  console.log('  locations aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS entity_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    relation_type TEXT NOT NULL DEFAULT 'vestiging'
      CHECK(relation_type IN ('vestiging','woonadres','werkgebied','postadres')),
    valid_from TEXT,
    valid_until TEXT,
    source_url TEXT,
    UNIQUE(entity_id, location_id, relation_type)
  )`);
  console.log('  entity_locations aangemaakt');

  console.log('M2 klaar.\n');

  console.log('=== M3: Relaties, events, source_records, fetch_runs ===');

  await db.execute(`CREATE TABLE IF NOT EXISTS kg_relations (
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
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_rel_subject ON kg_relations(subject_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_rel_object ON kg_relations(object_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_rel_predicate ON kg_relations(predicate)");
  console.log('  kg_relations aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS kg_events (
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
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_events_type ON kg_events(event_type)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_events_occurred ON kg_events(occurred_at)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_events_source ON kg_events(source_id)");
  console.log('  kg_events aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS event_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES kg_events(id),
    entity_id INTEGER NOT NULL REFERENCES kg_entities(id),
    role TEXT NOT NULL DEFAULT 'subject'
      CHECK(role IN ('subject','object','location','related')),
    evidence TEXT,
    confidence REAL DEFAULT 1.0,
    UNIQUE(event_id, entity_id, role)
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_ee_event ON event_entities(event_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_ee_entity ON event_entities(entity_id)");
  console.log('  event_entities aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS source_records (
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
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_sr_source_key ON source_records(source_id, source_key)");
  console.log('  source_records aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS fetch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    adapter_version TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running'
      CHECK(status IN ('running','ok','error','timeout','suspect')),
    records_found INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    records_changed INTEGER DEFAULT 0,
    records_removed INTEGER DEFAULT 0,
    error_message TEXT,
    http_status INTEGER,
    duration_ms INTEGER
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_fr_source ON fetch_runs(source_id)");
  console.log('  fetch_runs aangemaakt');

  await db.execute(`CREATE TABLE IF NOT EXISTS entity_merge_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a_id INTEGER NOT NULL REFERENCES kg_entities(id),
    entity_b_id INTEGER NOT NULL REFERENCES kg_entities(id),
    score REAL NOT NULL,
    match_details TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','merged','rejected','review')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_emc_status ON entity_merge_candidates(status)");
  console.log('  entity_merge_candidates aangemaakt');

  console.log('M3 klaar.\n');

  // Verificatie
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows;
  console.log('=== VERIFICATIE: ' + tables.length + ' tabellen ===');
  const newTables = ['kg_entities','entity_identifiers','kg_aliases','locations','entity_locations',
    'kg_relations','kg_events','event_entities','source_records','fetch_runs','entity_merge_candidates'];
  for (const t of newTables) {
    const exists = tables.some(r => r.name === t);
    const cnt = exists ? (await db.execute('SELECT COUNT(*) c FROM "' + t + '"')).rows[0].c : 'NIET GEVONDEN';
    console.log('  ' + t + ': ' + cnt + ' rijen');
  }

  console.log('\nMigratie M1-M3 voltooid.');
}
main().catch(e => { console.error(e); process.exit(1); });
