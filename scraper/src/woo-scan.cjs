#!/usr/bin/env node
'use strict';

// woo-scan.cjs — doorzoekt de tekst van Woo- en convenantbijlagen (iBabs) op
// termen die op nieuwswaarde wijzen en legt de treffers vast in woo_scan_hits.
// Toegevoegd 2026-09-24. Zie docs/SOURCES.md, 'iBabs-bijlagen'.
//
// Twee stappen:
// 1. Scan: iedere bijlage met status 'ok' die nog niet (of vóór haar laatste
//    ophaalmoment) is gescand. Treffers per term met hoogstens drie fragmenten.
// 2. Promotie: een Woo-item dat bij het ophalen als historisch is weggezet
//    (is_processed=1, geen signaal) maar zware treffers heeft (itemScore >=
//    PROMOTIE_DREMPEL), krijgt is_processed=0. De gewone intake maakt er dan
//    een 'watching'-signaal met label [HISTORISCH] van. Hoogstens MAX_PROMOTIES
//    per run, zodat er geen signaalgolf ontstaat. Ieder item wordt één keer
//    gepromoveerd (woo_promoties).
//
// Aanroep (vanuit de repowortel):
//   node scraper/src/woo-scan.cjs [--dry-run] [--alleen-scan] [--opnieuw] [--max 500] [--max-promoties 10]

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { scanTekst, itemScore, PROMOTIE_DREMPEL } = require('./woo-scan-lib.cjs');

const BRON = 'Bestuurlijke informatie gemeente Amersfoort (iBabs)';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry-run');
const ALLEEN_SCAN = process.argv.includes('--alleen-scan');
// Na een wijziging in de zoekregels: alle bijlagen opnieuw scannen.
const OPNIEUW = process.argv.includes('--opnieuw');
const MAX = Number(arg('--max', '500'));
const MAX_PROMOTIES = Number(arg('--max-promoties', '10'));
const TIJDBUDGET_MS = Number(arg('--budget-ms', '240000'));
const ITEM_IDS = String(arg('--ids', '')).split(',').map(Number).filter(Boolean);
const BATCH = 10;

async function zorgVoorTabellen(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS woo_scans (
    attachment_id INTEGER PRIMARY KEY REFERENCES raw_item_attachments(id),
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    treffers INTEGER NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS woo_scan_hits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attachment_id INTEGER NOT NULL REFERENCES raw_item_attachments(id),
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    term TEXT NOT NULL,
    gewicht INTEGER NOT NULL,
    aantal INTEGER NOT NULL,
    fragmenten TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(attachment_id, term)
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_wsh_item ON woo_scan_hits(raw_item_id)');
  await db.execute(`CREATE TABLE IF NOT EXISTS woo_promoties (
    raw_item_id INTEGER PRIMARY KEY REFERENCES raw_items(id),
    score INTEGER NOT NULL,
    termen TEXT NOT NULL,
    promoted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

async function scan(db, bronId) {
  const idFilter = ITEM_IDS.length ? `AND a.raw_item_id IN (${ITEM_IDS.map(() => '?').join(',')})` : '';
  const teDoen = (await db.execute({
    sql: `SELECT a.id, a.raw_item_id FROM raw_item_attachments a
          JOIN raw_items r ON r.id = a.raw_item_id
          LEFT JOIN woo_scans w ON w.attachment_id = a.id
          WHERE r.source_id = ? AND a.status = 'ok'
            AND (? = 1 OR w.attachment_id IS NULL OR datetime(a.opgehaald_at) > datetime(w.scanned_at))
            ${idFilter}
          ORDER BY a.id DESC LIMIT ?`,
    args: [bronId, OPNIEUW ? 1 : 0, ...ITEM_IDS, MAX],
  })).rows;
  const start = Date.now();
  let gescand = 0, metTreffers = 0, treffersTotaal = 0;
  for (let i = 0; i < teDoen.length; i += BATCH) {
    if (Date.now() - start > TIJDBUDGET_MS) break;
    const ids = teDoen.slice(i, i + BATCH).map((r) => Number(r.id));
    const rijen = (await db.execute({
      sql: `SELECT id, raw_item_id, tekst FROM raw_item_attachments WHERE id IN (${ids.map(() => '?').join(',')})`,
      args: ids,
    })).rows;
    const stmts = [];
    for (const rij of rijen) {
      const treffers = scanTekst(rij.tekst);
      gescand++;
      if (treffers.length) metTreffers++;
      treffersTotaal += treffers.length;
      stmts.push({ sql: 'DELETE FROM woo_scan_hits WHERE attachment_id = ?', args: [rij.id] });
      for (const t of treffers) {
        stmts.push({
          sql: `INSERT INTO woo_scan_hits (attachment_id, raw_item_id, term, gewicht, aantal, fragmenten) VALUES (?,?,?,?,?,?)`,
          args: [rij.id, rij.raw_item_id, t.term, t.gewicht, t.aantal, JSON.stringify(t.fragmenten)],
        });
      }
      stmts.push({
        sql: `INSERT INTO woo_scans (attachment_id, raw_item_id, treffers, scanned_at) VALUES (?,?,?,datetime('now'))
              ON CONFLICT(attachment_id) DO UPDATE SET treffers = excluded.treffers, scanned_at = excluded.scanned_at`,
        args: [rij.id, rij.raw_item_id, treffers.length],
      });
    }
    if (!DRY && stmts.length) await db.batch(stmts, 'write');
  }
  return { teDoen: teDoen.length, gescand, metTreffers, treffersTotaal, itemIds: [...new Set(teDoen.map((r) => Number(r.raw_item_id)))] };
}

async function herberekenPromoties(db, itemIds) {
  for (const id of itemIds) {
    const hits = (await db.execute({ sql: 'SELECT term,MAX(gewicht) gewicht FROM woo_scan_hits WHERE raw_item_id=? GROUP BY term', args: [id] })).rows;
    const score = itemScore(hits.map((h) => ({ term: String(h.term), gewicht: Number(h.gewicht) })));
    const termen = hits.sort((a, b) => Number(b.gewicht) - Number(a.gewicht)).map((h) => String(h.term));
    await db.execute({ sql: 'UPDATE woo_promoties SET score=?,termen=? WHERE raw_item_id=?', args: [score, JSON.stringify(termen), id] });
  }
}

async function promoveer(db, bronId) {
  // Alleen items die nu geen signaal hebben en nog niet eerder zijn gepromoveerd.
  const kandidaten = (await db.execute({
    sql: `SELECT r.id, r.title, r.published_at, h.term, MAX(h.gewicht) AS gewicht
          FROM raw_items r
          JOIN woo_scan_hits h ON h.raw_item_id = r.id
          WHERE r.source_id = ? AND r.is_processed = 1
            AND NOT EXISTS (SELECT 1 FROM signal_items si WHERE si.raw_item_id = r.id)
            AND NOT EXISTS (SELECT 1 FROM woo_promoties p WHERE p.raw_item_id = r.id)
          GROUP BY r.id, h.term`,
    args: [bronId],
  })).rows;
  const perItem = new Map();
  for (const k of kandidaten) {
    const id = Number(k.id);
    if (!perItem.has(id)) perItem.set(id, { id, titel: k.title, gepubliceerd: k.published_at, treffers: [] });
    perItem.get(id).treffers.push({ term: k.term, gewicht: Number(k.gewicht) });
  }
  const lijst = [...perItem.values()]
    .map((i) => ({ ...i, score: itemScore(i.treffers) }))
    .filter((i) => i.score >= PROMOTIE_DREMPEL)
    .sort((a, b) => b.score - a.score || String(b.gepubliceerd).localeCompare(String(a.gepubliceerd)));
  const gekozen = lijst.slice(0, MAX_PROMOTIES);
  if (!DRY) {
    for (const i of gekozen) {
      const termen = i.treffers.sort((a, b) => b.gewicht - a.gewicht).map((t) => t.term);
      await db.batch([
        { sql: 'UPDATE raw_items SET is_processed = 0 WHERE id = ? AND is_processed = 1', args: [i.id] },
        { sql: 'INSERT INTO woo_promoties (raw_item_id, score, termen) VALUES (?,?,?)', args: [i.id, i.score, JSON.stringify(termen)] },
      ], 'write');
    }
  }
  return { boveDrempel: lijst.length, gekozen };
}

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken in scraper/.env.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const bron = (await db.execute({ sql: 'SELECT id FROM sources WHERE name = ?', args: [BRON] })).rows[0];
    if (!bron) throw new Error(`Bron '${BRON}' niet gevonden.`);
    const bronId = Number(bron.id);
    if (!DRY) await zorgVoorTabellen(db);
    else {
      const bestaat = (await db.execute("SELECT 1 FROM sqlite_master WHERE name='woo_scans'")).rows.length;
      if (!bestaat) {
        console.log('Dry-run: tabellen bestaan nog niet; alleen een telling van de te scannen bijlagen.');
        const n = (await db.execute({ sql: "SELECT COUNT(*) AS n FROM raw_item_attachments a JOIN raw_items r ON r.id=a.raw_item_id WHERE r.source_id=? AND a.status='ok'", args: [bronId] })).rows[0].n;
        console.log(JSON.stringify({ mode: 'dry-run', te_scannen: Number(n) }));
        return;
      }
    }
    const s = await scan(db, bronId);
    if (!DRY && s.itemIds.length) await herberekenPromoties(db, s.itemIds);
    const p = ALLEEN_SCAN ? { boveDrempel: null, gekozen: [] } : await promoveer(db, bronId);
    console.log(JSON.stringify({
      mode: DRY ? 'dry-run' : 'applied',
      scan: s,
      promotie: {
        boven_drempel: p.boveDrempel,
        gepromoveerd: p.gekozen.map((i) => ({ raw_item_id: i.id, score: i.score, titel: String(i.titel).slice(0, 90) })),
      },
    }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`woo-scan mislukt: ${e.message}`); process.exitCode = 1; });
}

module.exports = { main };
