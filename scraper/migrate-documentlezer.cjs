#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function migrate(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS document_uittreksels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sleutel TEXT NOT NULL,
      raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
      bijlage_id INTEGER REFERENCES raw_item_attachments(id),
      deel_item_id INTEGER REFERENCES raw_items(id),
      begin_in_document INTEGER NOT NULL DEFAULT 0,
      tekens INTEGER NOT NULL,
      document_tekens INTEGER NOT NULL,
      tekst_sha TEXT NOT NULL,
      instructie_versie TEXT NOT NULL,
      model TEXT NOT NULL,
      kern TEXT NOT NULL,
      feiten TEXT NOT NULL,
      controle TEXT NOT NULL,
      tekstbron TEXT,
      afgekapt INTEGER NOT NULL DEFAULT 0 CHECK (afgekapt IN (0,1)),
      input_tokens INTEGER,
      output_tokens INTEGER,
      vaste_overhead_tokens INTEGER,
      gecontroleerd_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (sleutel, tekst_sha, instructie_versie, model)
    );
    CREATE INDEX IF NOT EXISTS idx_document_uittreksels_item
      ON document_uittreksels(raw_item_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_document_uittreksels_bijlage
      ON document_uittreksels(bijlage_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_signal_items_raw_item
      ON signal_items(raw_item_id, signal_id);
  `);
  const kolommen = new Set((await db.execute("PRAGMA table_info('document_uittreksels')")).rows.map((r) => String(r.name)));
  if (!kolommen.has('input_tokens')) await db.execute('ALTER TABLE document_uittreksels ADD COLUMN input_tokens INTEGER');
  if (!kolommen.has('output_tokens')) await db.execute('ALTER TABLE document_uittreksels ADD COLUMN output_tokens INTEGER');
  if (!kolommen.has('vaste_overhead_tokens')) await db.execute('ALTER TABLE document_uittreksels ADD COLUMN vaste_overhead_tokens INTEGER');
}

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await migrate(db);
    const kolommen = (await db.execute("PRAGMA table_info('document_uittreksels')")).rows.map((r) => r.name);
    const indexen = (await db.execute("PRAGMA index_list('document_uittreksels')")).rows.map((r) => r.name);
    console.log(JSON.stringify({ tabel: 'document_uittreksels', kolommen, indexen }, null, 2));
  } finally {
    db.close();
  }
}

module.exports = { migrate };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
