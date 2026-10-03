#!/usr/bin/env node
'use strict';

// Bouwt en onderhoudt een lokale, doorzoekbare kopie van documentteksten.
// Turso wordt uitsluitend via oplopende primaire sleutels gelezen. Een eerste
// volledige synchronisatie vereist bewust --initial; vervolgruns herlezen een
// kleine staart om later aangevulde fulltext/OCR mee te nemen.

const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { ensureSchema, openLocal, setStateStatement, state } = require('./archive-local.cjs');

const BATCH = 100;
const LOOKBACK = 1000;

function hash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function asText(value) { return value == null ? null : String(value); }

function documentFromRaw(row, now) {
  const body = String(row.body ?? '');
  return {
    docKey: `item:${row.id}`, remoteId: Number(row.id), rawItemId: Number(row.id), kind: 'raw_item',
    sourceId: Number(row.source_id), sourceName: asText(row.source_name), title: asText(row.title),
    url: asText(row.external_url), publishedAt: asText(row.published_at), updatedAt: asText(row.updated_at),
    body, contentHash: hash(`${row.title ?? ''}\n${body}`), syncedAt: now,
  };
}

function documentFromAttachment(row, now) {
  const body = String(row.body ?? '');
  return {
    docKey: `attachment:${row.id}`, remoteId: Number(row.id), rawItemId: Number(row.raw_item_id), kind: 'attachment',
    sourceId: Number(row.source_id), sourceName: asText(row.source_name), title: asText(row.title),
    url: asText(row.url), publishedAt: asText(row.published_at), updatedAt: asText(row.updated_at),
    body, contentHash: hash(`${row.title ?? ''}\n${body}`), syncedAt: now,
  };
}

function upsertStatements(document) {
  const d = document;
  return [
    {
      sql: `INSERT INTO archive_documents
              (doc_key,remote_id,raw_item_id,kind,source_id,source_name,title,url,published_at,updated_at,body,content_hash,synced_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(doc_key) DO UPDATE SET
              raw_item_id=excluded.raw_item_id,source_id=excluded.source_id,source_name=excluded.source_name,
              title=excluded.title,url=excluded.url,published_at=excluded.published_at,updated_at=excluded.updated_at,
              body=excluded.body,content_hash=excluded.content_hash,synced_at=excluded.synced_at`,
      args: [d.docKey, d.remoteId, d.rawItemId, d.kind, d.sourceId, d.sourceName, d.title, d.url,
        d.publishedAt, d.updatedAt, d.body, d.contentHash, d.syncedAt],
    },
    { sql: 'DELETE FROM archive_documents_fts WHERE doc_key=?', args: [d.docKey] },
    { sql: 'INSERT INTO archive_documents_fts(doc_key,title,body,source_name) VALUES (?,?,?,?)', args: [d.docKey, d.title, d.body, d.sourceName] },
  ];
}

async function syncType(remote, local, options) {
  const high = Number(await state(local, options.stateName, '0'));
  const start = options.initial ? 0 : Math.max(0, high - options.lookback);
  let cursor = start;
  let total = 0;
  let maxSeen = high;
  while (true) {
    const result = await remote.execute({ sql: options.sql, args: [cursor, options.batch] });
    if (!result.rows.length) break;
    const now = new Date().toISOString();
    const documents = result.rows.map((row) => options.map(row, now));
    const statements = documents.flatMap(upsertStatements);
    cursor = Math.max(...documents.map((d) => d.remoteId));
    maxSeen = Math.max(maxSeen, cursor);
    statements.push(await setStateStatement(options.stateName, maxSeen, now));
    await local.batch(statements, 'write');
    total += documents.length;
    if (result.rows.length < options.batch) break;
  }
  return { gelezen: total, vanaf_id: start, hoogste_id: maxSeen };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Gebruik: node scraper/src/archive-sync.cjs [--initial] [--batch 100] [--lookback 1000]');
    return;
  }
  const initial = argv.includes('--initial');
  const batchArg = argv.indexOf('--batch');
  const batch = batchArg >= 0 ? Number(argv[batchArg + 1]) : BATCH;
  const lookbackArg = argv.indexOf('--lookback');
  const lookback = lookbackArg >= 0 ? Number(argv[lookbackArg + 1]) : LOOKBACK;
  if (!Number.isInteger(batch) || batch < 10 || batch > 500) throw new Error('--batch moet tussen 10 en 500 liggen.');
  if (!Number.isInteger(lookback) || lookback < 0 || lookback > 5000) throw new Error('--lookback moet tussen 0 en 5000 liggen.');
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken in scraper/.env.');

  const local = openLocal();
  const remote = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await ensureSchema(local);
    const count = Number((await local.execute('SELECT COUNT(*) AS n FROM archive_documents')).rows[0]?.n ?? 0);
    if (count === 0 && !initial) {
      throw new Error('Lokale archiefkopie is leeg. Start de eenmalige eerste synchronisatie bewust met --initial.');
    }
    const raw = await syncType(remote, local, {
      initial, batch, lookback, stateName: 'raw_items_high_water', map: documentFromRaw,
      sql: `SELECT r.id,r.source_id,s.name AS source_name,r.title,r.external_url,r.published_at,
                   COALESCE(r.fulltext_fetched_at,r.scraped_at) AS updated_at,
                   COALESCE(r.full_text,r.content,r.summary,'') AS body
            FROM raw_items r JOIN sources s ON s.id=r.source_id
            WHERE r.id>?
              -- Deelitems van een stuk met bijlagen overslaan: die tekst komt al
              -- per bijlage in het archief en zou anders dubbel worden gevonden.
              AND NOT EXISTS (SELECT 1 FROM raw_item_parts p
                              JOIN raw_item_attachments a ON a.raw_item_id=p.parent_id
                              WHERE p.part_id=r.id)
            ORDER BY r.id LIMIT ?`,
    });
    const attachments = await syncType(remote, local, {
      initial, batch, lookback, stateName: 'attachments_high_water', map: documentFromAttachment,
      sql: `SELECT a.id,a.raw_item_id,r.source_id,s.name AS source_name,
                   COALESCE(a.titel,r.title) AS title,a.url,r.published_at,
                   COALESCE(a.ocr_at,a.opgehaald_at) AS updated_at,COALESCE(a.tekst,'') AS body
            FROM raw_item_attachments a
            JOIN raw_items r ON r.id=a.raw_item_id JOIN sources s ON s.id=r.source_id
            WHERE a.id>? AND a.status='ok' ORDER BY a.id LIMIT ?`,
    });
    console.log(JSON.stringify({ mode: initial ? 'initial' : 'incremental', raw_items: raw, bijlagen: attachments }, null, 2));
  } finally {
    remote.close();
    local.close();
  }
}

if (require.main === module) main().catch((error) => { console.error(`Archiefsync mislukt: ${error.message}`); process.exitCode = 1; });

module.exports = { documentFromAttachment, documentFromRaw, hash, syncType, upsertStatements };
