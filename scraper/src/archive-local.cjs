'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const DEFAULT_DIR = path.join(__dirname, '..', 'data', 'archive-research');
const DEFAULT_DB = path.join(DEFAULT_DIR, 'archive.sqlite');
const DEFAULT_CANDIDATES = path.join(DEFAULT_DIR, 'candidates.json');

function localUrl(file) {
  return `file:${path.resolve(file).replace(/\\/g, '/')}`;
}

function openLocal(file = process.env.ARCHIVE_RESEARCH_DB || DEFAULT_DB) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  return createClient({ url: localUrl(file) });
}

async function ensureSchema(db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS archive_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_key TEXT NOT NULL UNIQUE,
      remote_id INTEGER NOT NULL,
      raw_item_id INTEGER,
      kind TEXT NOT NULL CHECK(kind IN ('raw_item','attachment')),
      source_id INTEGER,
      source_name TEXT,
      title TEXT,
      url TEXT,
      published_at TEXT,
      updated_at TEXT,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      synced_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_archive_documents_raw_item ON archive_documents(raw_item_id)',
    'CREATE INDEX IF NOT EXISTS idx_archive_documents_remote_kind ON archive_documents(kind, remote_id)',
    `CREATE VIRTUAL TABLE IF NOT EXISTS archive_documents_fts USING fts5(
      doc_key UNINDEXED, title, body, source_name,
      tokenize='unicode61 remove_diacritics 2'
    )`,
    `CREATE TABLE IF NOT EXISTS archive_sync_state (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS archive_candidate_history (
      track TEXT NOT NULL,
      doc_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(track, doc_key)
    )`,
  ], 'write');
}

async function state(db, name, fallback = '0') {
  const row = (await db.execute({ sql: 'SELECT value FROM archive_sync_state WHERE name=?', args: [name] })).rows[0];
  return row?.value == null ? fallback : String(row.value);
}

async function setStateStatement(name, value, now) {
  return {
    sql: `INSERT INTO archive_sync_state(name,value,updated_at) VALUES (?,?,?)
          ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
    args: [name, String(value), now],
  };
}

module.exports = { DEFAULT_CANDIDATES, DEFAULT_DB, ensureSchema, openLocal, setStateStatement, state };
