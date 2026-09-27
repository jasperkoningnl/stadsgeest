#!/usr/bin/env node
'use strict';

// Doorzoekt de lokale FTS5-index langs journalistieke zoeksporen. Alleen de
// compacte kandidatenlijst gaat naar de dagelijkse weger. Met --promote worden
// hoogstens tien bijbehorende raw_items gericht teruggezet voor de intake; er
// vindt daarbij geen vrije-tekstscan op Turso plaats.

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { DEFAULT_CANDIDATES, ensureSchema, openLocal } = require('./archive-local.cjs');
const { SPOREN, inhoudHash, scoreKandidaat, uniekOpDocument } = require('./archive-research-lib.cjs');

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
}

async function zoekSpoor(db, spoor, perSpoor) {
  const result = await db.execute({
    sql: `SELECT d.doc_key,d.raw_item_id,d.kind,d.source_name,d.title,d.url,d.published_at,
                 d.body,d.content_hash,bm25(archive_documents_fts) AS rank,
                 snippet(archive_documents_fts,2,'[',']',' … ',32) AS fragment
          FROM archive_documents_fts
          JOIN archive_documents d ON d.doc_key=archive_documents_fts.doc_key
          WHERE archive_documents_fts MATCH ?
          ORDER BY rank LIMIT ?`,
    args: [spoor.query, perSpoor],
  });
  const uit = [];
  for (const row of result.rows) {
    const beoordeeld = (await db.execute({
      sql: 'SELECT content_hash FROM archive_candidate_history WHERE track=? AND doc_key=?',
      args: [spoor.id, row.doc_key],
    })).rows[0];
    if (beoordeeld && String(beoordeeld.content_hash) === String(row.content_hash)) continue;
    const waardering = scoreKandidaat(spoor, row);
    if (waardering.termen.length === 0) continue;
    uit.push({
      spoor: spoor.id,
      spoor_label: spoor.label,
      doc_key: String(row.doc_key),
      raw_item_id: row.raw_item_id == null ? null : Number(row.raw_item_id),
      soort: String(row.kind),
      bron: String(row.source_name ?? ''),
      titel: String(row.title ?? ''),
      url: String(row.url ?? ''),
      gepubliceerd: row.published_at == null ? null : String(row.published_at),
      score: waardering.score,
      termen: waardering.termen,
      fragment: String(row.fragment ?? '').replace(/\s+/g, ' ').trim().slice(0, 900),
      content_hash: String(row.content_hash),
      inhoud_hash: inhoudHash(row.fragment),
      status: beoordeeld ? 'gewijzigd' : 'nieuw',
      lokale_rank: Number(row.rank),
    });
  }
  return uit;
}

async function promoveer(kandidaten, maximum) {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('--promote vereist TURSO_URL en TURSO_AUTH_TOKEN in scraper/.env.');
  }
  const ids = [...new Set(kandidaten.map((k) => k.raw_item_id).filter((id) => Number.isInteger(id) && id > 0))].slice(0, maximum);
  if (!ids.length) return 0;
  const remote = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const placeholders = ids.map(() => '?').join(',');
    const result = await remote.execute({
      sql: `UPDATE raw_items SET is_processed=0
            WHERE id IN (${placeholders}) AND is_processed=1
              AND NOT EXISTS (SELECT 1 FROM signal_items WHERE signal_items.raw_item_id=raw_items.id)`,
      args: ids,
    });
    return Number(result.rowsAffected ?? 0);
  } finally {
    remote.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const shouldPromote = argv.includes('--promote');
  const maximum = Number(arg(argv, '--max', '20'));
  const perSpoor = Number(arg(argv, '--per-spoor', '40'));
  const maxPromoties = Number(arg(argv, '--max-promoties', '10'));
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) throw new Error('--max moet tussen 1 en 100 liggen.');
  if (!Number.isInteger(perSpoor) || perSpoor < 5 || perSpoor > 200) throw new Error('--per-spoor moet tussen 5 en 200 liggen.');
  if (!Number.isInteger(maxPromoties) || maxPromoties < 0 || maxPromoties > 25) throw new Error('--max-promoties moet tussen 0 en 25 liggen.');

  const db = openLocal();
  try {
    await ensureSchema(db);
    const docs = Number((await db.execute('SELECT COUNT(*) AS n FROM archive_documents')).rows[0]?.n ?? 0);
    if (!docs) throw new Error('De lokale archiefindex is leeg; voer eerst archive-sync.cjs --initial uit.');
    const alle = [];
    for (const spoor of SPOREN) alle.push(...await zoekSpoor(db, spoor, perSpoor));
    alle.sort((a, b) => b.score - a.score || a.lokale_rank - b.lokale_rank);
    const kandidaten = uniekOpDocument(alle, maximum).map(({ lokale_rank, inhoud_hash, ...k }) => k);
    const gegenereerd = new Date().toISOString();
    const output = { generated_at: gegenereerd, document_count: docs, candidate_count: kandidaten.length, candidates: kandidaten };

    let gepromoveerd = 0;
    if (!dryRun && shouldPromote) gepromoveerd = await promoveer(kandidaten, maxPromoties);
    output.promoted_for_intake = gepromoveerd;

    if (!dryRun) {
      fs.mkdirSync(path.dirname(DEFAULT_CANDIDATES), { recursive: true });
      fs.writeFileSync(DEFAULT_CANDIDATES, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      const history = kandidaten.map((k) => ({
        sql: `INSERT INTO archive_candidate_history(track,doc_key,content_hash,first_seen_at,last_seen_at)
              VALUES (?,?,?,?,?) ON CONFLICT(track,doc_key) DO UPDATE SET
              content_hash=excluded.content_hash,last_seen_at=excluded.last_seen_at`,
        args: [k.spoor, k.doc_key, k.content_hash, gegenereerd, gegenereerd],
      }));
      if (history.length) await db.batch(history, 'write');
    }
    console.log(JSON.stringify({ ...output, candidates: kandidaten.map(({ content_hash, ...k }) => k), mode: dryRun ? 'dry-run' : 'applied' }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch((error) => { console.error(`Archiefonderzoek mislukt: ${error.message}`); process.exitCode = 1; });

module.exports = { main, promoveer, zoekSpoor };
