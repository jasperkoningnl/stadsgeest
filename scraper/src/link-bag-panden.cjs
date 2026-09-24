// Pand bij verblijfsobject ophalen (2026-09-24) via de PDOK BAG OGC API (geen
// sleutel nodig). Voor elk exact gekoppeld verblijfsobject in bag_lookup_cache
// dat nog niet is opgezocht: verblijfsobject -> pand-link(s) -> pand-id en bouwjaar.
// Schrijft naar bag_vbo_pand en bag_pand_scan. Herhaalbaar; alleen nieuwe objecten.
//
// Aanroep: node src/link-bag-panden.cjs [--limit N]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const BASE = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections';
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : 20000;
const CONCURRENCY = 4;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Stadsgeest/1.0 (lokale journalistieke adreskoppeling)' };

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
  }
}

const pandCache = new Map(); // pand-uuid -> { id, bouwjaar, aantal }

async function pandFor(href) {
  const uuid = href.split('/').pop().split('?')[0];
  if (pandCache.has(uuid)) return pandCache.get(uuid);
  const j = await getJson(`${BASE}/pand/items/${uuid}?f=json`);
  const p = j?.properties ? { id: String(j.properties.identificatie), bouwjaar: j.properties.bouwjaar ?? null, aantal: j.properties.aantal_verblijfsobjecten ?? null } : null;
  pandCache.set(uuid, p);
  return p;
}

async function one(vbo) {
  const j = await getJson(`${BASE}/verblijfsobject/items?f=json&identificatie=${vbo}&limit=1`);
  const f = j?.features?.[0];
  if (!f) return { vbo, status: 'not_found', panden: [] };
  const hrefs = [].concat(f.properties['pand.href'] || []);
  const panden = [];
  for (const h of hrefs) { const p = await pandFor(h); if (p) panden.push(p); }
  return { vbo, status: panden.length ? 'ok' : 'not_found', panden };
}

async function main() {
  // Alleen echte verblijfsobjecten (objecttypecode 01 op positie 5-6).
  const todo = (await db.execute({
    sql: `SELECT DISTINCT verblijfsobject_id AS vbo FROM bag_lookup_cache
          WHERE status = 'exact' AND verblijfsobject_id IS NOT NULL AND substr(verblijfsobject_id, 5, 2) = '01'
            AND verblijfsobject_id NOT IN (SELECT verblijfsobject_id FROM bag_pand_scan)
          LIMIT ?`,
    args: [LIMIT],
  })).rows.map((r) => String(r.vbo));
  console.log(`Op te zoeken verblijfsobjecten: ${todo.length}`);
  const stats = { vbo: todo.length, ok: 0, notFound: 0, failed: 0, rows: 0 };
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const vbo = todo[i++];
      let res;
      try { res = await one(vbo); } catch (e) { stats.failed++; console.error(`${vbo}: ${e.message}`); continue; }
      const stmts = res.panden.map((p) => ({
        sql: 'INSERT OR IGNORE INTO bag_vbo_pand (verblijfsobject_id, pand_id, bouwjaar, aantal_verblijfsobjecten) VALUES (?,?,?,?)',
        args: [vbo, p.id, p.bouwjaar, p.aantal],
      }));
      stmts.push({ sql: 'INSERT OR REPLACE INTO bag_pand_scan (verblijfsobject_id, status) VALUES (?,?)', args: [vbo, res.status] });
      const out = await db.batch(stmts, 'write');
      stats.rows += out.slice(0, -1).reduce((n, o) => n + o.rowsAffected, 0);
      if (res.status === 'ok') stats.ok++; else stats.notFound++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(JSON.stringify(stats, null, 2));
  if (stats.failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
