// Migratie spoor 1 (NER): documentvermeldingen uit spaCy, los van de KG.
// Additief: alleen CREATE TABLE/INDEX IF NOT EXISTS. Raakt geen bestaande tabellen.
// NER-vermeldingen gaan bewust NIET naar entity_identifiers of kg_aliases;
// koppeling aan kg_entities is een kandidaat tot iemand hem bevestigt.
// Aanroep: node migrate-document-mentions.cjs
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const statements = [
  `CREATE TABLE IF NOT EXISTS document_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    entity_type TEXT NOT NULL CHECK(entity_type IN ('person','organization','location')),
    mention_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    model_label TEXT NOT NULL,
    span_start INTEGER NOT NULL,
    span_end INTEGER NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1,
    context_snippet TEXT,
    extractor TEXT NOT NULL,
    model_version TEXT NOT NULL,
    confidence REAL,
    alias_overlap INTEGER NOT NULL DEFAULT 0,
    resolution_status TEXT NOT NULL DEFAULT 'unresolved'
      CHECK(resolution_status IN ('unresolved','candidate','ambiguous','confirmed','rejected')),
    resolved_entity_id INTEGER REFERENCES kg_entities(id),
    resolution_method TEXT,
    resolution_detail TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(raw_item_id, extractor, model_version, entity_type, normalized_text)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dm_raw_item ON document_mentions(raw_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_entity ON document_mentions(resolved_entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_status ON document_mentions(resolution_status, entity_type)`,
  `CREATE INDEX IF NOT EXISTS idx_dm_norm ON document_mentions(entity_type, normalized_text)`,
  `CREATE TABLE IF NOT EXISTS ner_scans (
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    extractor TEXT NOT NULL,
    model_version TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    text_length INTEGER NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    mentions_raw INTEGER NOT NULL,
    mentions_kept INTEGER NOT NULL,
    dropped_json TEXT,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (raw_item_id, extractor, model_version)
  )`,
];

(async () => {
  for (const sql of statements) await db.execute(sql);
  for (const t of ['document_mentions', 'ner_scans']) {
    const n = (await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    const cols = (await db.execute(`PRAGMA table_info(${t})`)).rows.length;
    console.log(`${t}: ${cols} kolommen, ${n} rijen`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
