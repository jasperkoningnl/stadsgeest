// Adreskoppeling (2026-09-23): haalt adressen met huisnummer uit raw_items en
// koppelt ze exact aan de BAG (nummeraanduiding-id) via de PDOK Locatieserver.
// Schrijft naar document_addresses en address_scans; raakt de KG niet aan.
// Zelfde bronbereik als extract-ner.cjs (geen sociale, community- of noodbronnen).
//
// Aanroep:
//   node src/extract-addresses.cjs [--limit N] [--dry-run] [--ids 1,2,3]
//   --dry-run  alleen extractie tellen, geen PDOK en geen schrijfacties
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { EXTRACTOR_VERSION, extractAddresses, lookup } = require('./kg/address-links.cjs');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const CATEGORIES = ['government', 'registry', 'data', 'local_news'];
// Een document met meer adressen is een lijst (restrictielijst parkeren: 2.378
// adressen). Die koppelt aan alles en zegt over geen enkel adres iets; alleen tellen.
const MAX_ADDRESSES_PER_ITEM = 50;

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}
const DRY = process.argv.includes('--dry-run');
const LIMIT = parseInt(arg('--limit', '500'), 10);
const IDS = arg('--ids', null);

async function main() {
  let items;
  if (IDS) {
    const ids = IDS.split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    items = (await db.execute({ sql: `SELECT id, title, summary, content, full_text FROM raw_items WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids })).rows;
  } else {
    items = (await db.execute({
      sql: `SELECT r.id, r.title, r.summary, r.content, r.full_text
            FROM raw_items r JOIN sources s ON s.id = r.source_id
            WHERE s.category IN (${CATEGORIES.map(() => '?').join(',')})
              AND r.id NOT IN (SELECT raw_item_id FROM address_scans WHERE extractor_version = ?)
            ORDER BY r.id DESC LIMIT ?`,
      args: [...CATEGORIES, EXTRACTOR_VERSION, LIMIT],
    })).rows;
  }
  console.log(`Te verwerken items: ${items.length}${DRY ? ' (dry-run)' : ''}`);

  const stats = { items: items.length, found: 0, byMethod: {}, byStatus: {}, pdokCalls: 0, cached: 0, failed: 0, inserted: 0, scans: 0 };
  const uniqueKeys = new Set();

  for (const it of items) {
    const text = [it.title, it.summary, it.content, it.full_text].filter(Boolean).join('\n');
    const found = extractAddresses(text);
    stats.found += found.length;
    for (const a of found) { stats.byMethod[a.method] = (stats.byMethod[a.method] || 0) + 1; uniqueKeys.add(a.key); }
    if (DRY) continue;
    if (found.length > MAX_ADDRESSES_PER_ITEM) {
      stats.lists = (stats.lists || 0) + 1;
      const r = await db.execute({
        sql: 'INSERT OR IGNORE INTO address_scans (raw_item_id, extractor_version, found, exact) VALUES (?,?,?,0)',
        args: [Number(it.id), EXTRACTOR_VERSION, found.length],
      });
      stats.scans += r.rowsAffected;
      continue;
    }

    const stmts = [];
    let exact = 0, failed = false;
    for (const a of found) {
      let res;
      try {
        res = await lookup(db, a);
      } catch (e) {
        // Netwerkfout: dit item niet als gescand markeren, dan komt het de volgende run terug.
        stats.failed++; failed = true;
        console.error(`PDOK-fout bij ${a.key}: ${e.message}`);
        continue;
      }
      if (res.cached) stats.cached++; else stats.pdokCalls++;
      stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1;
      if (res.status === 'exact') exact++;
      const snippet = text.substring(Math.max(0, a.index - 60), a.index + a.text.length + 60).replace(/\s+/g, ' ').trim();
      stmts.push({
        sql: `INSERT OR IGNORE INTO document_addresses (raw_item_id, query_key, address_text, method, span_start, occurrences,
                context_snippet, match_status, nummeraanduiding_id, verblijfsobject_id, buurtcode, extractor_version)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [Number(it.id), a.key, res.weergavenaam || a.text, a.method, a.index, a.occurrences, snippet,
          res.status, res.nummeraanduiding_id, res.verblijfsobject_id, res.buurtcode, EXTRACTOR_VERSION],
      });
    }
    if (failed) { if (stmts.length) await db.batch(stmts, 'write'); continue; }
    stmts.push({
      sql: 'INSERT OR IGNORE INTO address_scans (raw_item_id, extractor_version, found, exact) VALUES (?,?,?,?)',
      args: [Number(it.id), EXTRACTOR_VERSION, found.length, exact],
    });
    const out = await db.batch(stmts, 'write');
    out.forEach((o, i) => { if (i < stmts.length - 1) stats.inserted += o.rowsAffected; else stats.scans += o.rowsAffected; });
  }
  stats.uniqueKeys = uniqueKeys.size;
  console.log(JSON.stringify(stats, null, 2));
  if (stats.failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
