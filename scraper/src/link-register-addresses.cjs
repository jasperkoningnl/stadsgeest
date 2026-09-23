// Registeradressen aan de BAG koppelen (2026-09-23). Leest de meest recente
// versie van LRK, GLEIF en DUO uit source_records en schrijft per vestiging de
// nummeraanduiding-id naar register_addresses. Wijzigt source_records niet.
// Herhaalbaar: bestaande rijen worden bijgewerkt, PDOK-antwoorden komen uit de cache.
//
// Aanroep: node src/link-register-addresses.cjs [--dry-run] [--only lrk,gleif,duo]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { EXTRACTOR_VERSION, parseStreetLine, lookup } = require('./kg/address-links.cjs');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

async function latest(sourceId, key) {
  const sql = key
    ? 'SELECT source_key, raw_object FROM source_records WHERE source_id = ? AND source_key = ? ORDER BY id DESC LIMIT 1'
    : `SELECT sr.source_key, sr.raw_object FROM source_records sr
       WHERE sr.source_id = ? AND sr.source_key NOT LIKE '__baseline%'
         AND sr.id = (SELECT MAX(id) FROM source_records x WHERE x.source_id = sr.source_id AND x.source_key = sr.source_key)
         AND COALESCE(sr.change_type, '') <> 'removed'`;
  return (await db.execute({ sql, args: key ? [sourceId, key] : [sourceId] })).rows;
}

// Elke bron levert { sourceId, ref, role, label, line, postcode }.
const SOURCES = {
  lrk: async () => {
    const [row] = await latest(139, 'lrk_full');
    const all = JSON.parse(row.raw_object);
    return Object.entries(all).filter(([, v]) => v && v.adres).map(([id, v]) => ({
      sourceId: 139, ref: `lrk_full#${id}`, role: 'vestiging', label: `${v.naam}${v.houder && v.houder !== v.naam ? ' (' + v.houder + ')' : ''} [${v.type}]`, line: v.adres, postcode: v.postcode,
    }));
  },
  gleif: async () => {
    const [row] = await latest(159, 'gleif_full');
    const all = JSON.parse(row.raw_object);
    const out = [];
    for (const [lei, v] of Object.entries(all)) {
      if (v.legalCountry === 'NL' && v.legalAddressLines) out.push({ sourceId: 159, ref: `gleif_full#${lei}`, role: 'statutair', label: v.legalName, line: v.legalAddressLines, postcode: v.legalPostalCode });
      if (v.hqCountry === 'NL' && v.hqAddressLines && (v.hqAddressLines !== v.legalAddressLines || v.hqPostalCode !== v.legalPostalCode)) {
        out.push({ sourceId: 159, ref: `gleif_full#${lei}`, role: 'hoofdkantoor', label: v.legalName, line: v.hqAddressLines, postcode: v.hqPostalCode });
      }
    }
    return out;
  },
  duo: async () => (await latest(140)).map((r) => {
    const v = JSON.parse(r.raw_object);
    return { sourceId: 140, ref: r.source_key, role: 'vestiging', label: v.naam, line: `${v.straat} ${v.huisnummer}`, postcode: v.postcode };
  }),
};

async function main() {
  const stats = {};
  // Cache en bestaande rijen vooraf laden: de dagelijkse run doet dan alleen nog
  // PDOK-aanvragen en schrijfacties voor nieuwe of gewijzigde vestigingen.
  const cache = new Map((await db.execute('SELECT * FROM bag_lookup_cache')).rows.map((r) => [r.query_key, r]));
  const existing = new Map((await db.execute('SELECT source_id, record_ref, role, query_key, label FROM register_addresses')).rows
    .map((r) => [`${r.source_id}|${r.record_ref}|${r.role}`, r]));
  for (const [name, load] of Object.entries(SOURCES)) {
    if (ONLY && !ONLY.has(name)) continue;
    const records = await load();
    const s = { records: records.length, parsed: 0, skipped: 0, byStatus: {}, pdokCalls: 0, failed: 0, written: 0 };
    stats[name] = s;
    for (const rec of records) {
      const a = parseStreetLine(rec.line, rec.postcode);
      if (!a || /^postbus$/i.test(a.street.trim())) { s.skipped++; continue; }
      s.parsed++;
      if (DRY) continue;
      const prev = existing.get(`${rec.sourceId}|${rec.ref}|${rec.role}`);
      if (prev && prev.query_key === a.key && prev.label === rec.label && cache.has(a.key)) {
        const st = cache.get(a.key).status;
        s.byStatus[st] = (s.byStatus[st] || 0) + 1;
        continue;
      }
      let res;
      try { res = cache.has(a.key) ? { ...cache.get(a.key), cached: true } : await lookup(db, a); } catch (e) { s.failed++; console.error(`${name} ${rec.ref}: ${e.message}`); continue; }
      if (!res.cached) s.pdokCalls++;
      s.byStatus[res.status] = (s.byStatus[res.status] || 0) + 1;
      const r = await db.execute({
        sql: `INSERT INTO register_addresses (source_id, record_ref, role, label, query_key, address_text, match_status,
                nummeraanduiding_id, verblijfsobject_id, buurtcode, extractor_version)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(source_id, record_ref, role) DO UPDATE SET
                label = excluded.label, query_key = excluded.query_key, address_text = excluded.address_text,
                match_status = excluded.match_status, nummeraanduiding_id = excluded.nummeraanduiding_id,
                verblijfsobject_id = excluded.verblijfsobject_id, buurtcode = excluded.buurtcode,
                extractor_version = excluded.extractor_version, updated_at = datetime('now')
              WHERE register_addresses.query_key <> excluded.query_key OR register_addresses.label IS NOT excluded.label
                 OR register_addresses.match_status <> excluded.match_status`,
        args: [rec.sourceId, rec.ref, rec.role, rec.label, a.key, res.weergavenaam || a.text, res.status,
          res.nummeraanduiding_id, res.verblijfsobject_id, res.buurtcode, EXTRACTOR_VERSION],
      });
      s.written += r.rowsAffected;
    }
  }
  console.log(JSON.stringify(stats, null, 2));
  if (Object.values(stats).some((s) => s.failed)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
