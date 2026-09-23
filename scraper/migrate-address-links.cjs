// Migratie adreskoppeling (2026-09-23). Additief: alleen CREATE ... IF NOT EXISTS.
// Koppelsleutel is de BAG-nummeraanduiding-id, zoals al in locations.bag_id.
// Aanroep: node migrate-address-links.cjs
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  // Eén rij per unieke zoekvraag aan PDOK; voorkomt herhaalde aanvragen.
  `CREATE TABLE IF NOT EXISTS bag_lookup_cache (
    query_key TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('exact','none','ambiguous','outside_area')),
    nummeraanduiding_id TEXT,
    verblijfsobject_id TEXT,
    weergavenaam TEXT,
    gemeente TEXT,
    buurtcode TEXT,
    lat REAL,
    lon REAL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS document_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    query_key TEXT NOT NULL,
    address_text TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('postcode','plaatsnaam')),
    span_start INTEGER,
    occurrences INTEGER NOT NULL DEFAULT 1,
    context_snippet TEXT,
    match_status TEXT NOT NULL CHECK(match_status IN ('exact','none','ambiguous','outside_area')),
    nummeraanduiding_id TEXT,
    verblijfsobject_id TEXT,
    buurtcode TEXT,
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(raw_item_id, query_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_da_item ON document_addresses(raw_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_da_na ON document_addresses(nummeraanduiding_id)`,
  `CREATE INDEX IF NOT EXISTS idx_da_vbo ON document_addresses(verblijfsobject_id)`,
  `CREATE TABLE IF NOT EXISTS address_scans (
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    extractor_version TEXT NOT NULL,
    found INTEGER NOT NULL,
    exact INTEGER NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (raw_item_id, extractor_version)
  )`,
  // Adressen uit registers (source_records). record_ref = source_key, of
  // source_key#sleutel voor registers die als één groot record zijn opgeslagen.
  `CREATE TABLE IF NOT EXISTS register_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    record_ref TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'vestiging',
    label TEXT,
    query_key TEXT NOT NULL,
    address_text TEXT NOT NULL,
    match_status TEXT NOT NULL CHECK(match_status IN ('exact','none','ambiguous','outside_area')),
    nummeraanduiding_id TEXT,
    verblijfsobject_id TEXT,
    buurtcode TEXT,
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, record_ref, role)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ra_na ON register_addresses(nummeraanduiding_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ra_vbo ON register_addresses(verblijfsobject_id)`,
];

(async () => {
  for (const sql of statements) await db.execute(sql);
  for (const t of ['bag_lookup_cache', 'document_addresses', 'address_scans', 'register_addresses']) {
    const n = (await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    console.log(`${t}: ${n} rijen`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
