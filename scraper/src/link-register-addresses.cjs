// Registeradressen aan de BAG koppelen (2026-09-23, uitgebreid 2026-09-24).
// Leest de nieuwste versie van registers uit source_records (LRK, GLEIF, DUO,
// zorgverantwoording, OSM, UIT-agenda, asbestovertredingen) en haalt voor
// rijksmonumenten het BAG-adres live op bij de RCE (SPARQL). Schrijft per
// vestiging de nummeraanduiding-id naar register_addresses. Wijzigt
// source_records niet. Herhaalbaar: bestaande rijen worden alleen bijgewerkt als
// adres of label verandert; PDOK-antwoorden komen uit bag_lookup_cache.
//
// Aanroep: node src/link-register-addresses.cjs [--dry-run] [--only lrk,gleif,duo,zorg,osm,uit,asbest,monumenten]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { EXTRACTOR_VERSION, parseStreetLine, lookup } = require('./kg/address-links.cjs');

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const RCE_SPARQL = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/cho/services/cho/sparql';
const MONUMENT_SOURCE_ID = 154;

async function latest(sourceId, key) {
  const sql = key
    ? 'SELECT source_key, raw_object FROM source_records WHERE source_id = ? AND source_key = ? ORDER BY id DESC LIMIT 1'
    : `SELECT sr.source_key, sr.raw_object FROM source_records sr
       WHERE sr.source_id = ? AND sr.source_key NOT LIKE '__baseline%'
         AND sr.id = (SELECT MAX(id) FROM source_records x WHERE x.source_id = sr.source_id AND x.source_key = sr.source_key)
         AND COALESCE(sr.change_type, '') <> 'removed'`;
  return (await db.execute({ sql, args: key ? [sourceId, key] : [sourceId] })).rows;
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Elke bron levert { sourceId, ref, role, label, line, postcode }.
const SOURCES = {
  lrk: async () => {
    const [row] = await latest(139, 'lrk_full');
    // Gastouders (type VGO) staan in het LRK met hun eigen naam op hun woonadres:
    // particulieren. Die koppelen we niet, anders meldt de weger "kinderopvang op
    // dit adres" bij de verbouwing van een woonhuis (besluit Jasper, 24-9-2026).
    return Object.entries(parse(row.raw_object) || {}).filter(([, v]) => v && v.adres && v.type !== 'VGO').map(([id, v]) => ({
      sourceId: 139, ref: `lrk_full#${id}`, role: 'vestiging', label: `${v.naam}${v.houder && v.houder !== v.naam ? ' (' + v.houder + ')' : ''} [${v.type}]`, line: v.adres, postcode: v.postcode,
    }));
  },
  gleif: async () => {
    const [row] = await latest(159, 'gleif_full');
    const out = [];
    for (const [lei, v] of Object.entries(parse(row.raw_object) || {})) {
      if (v.legalCountry === 'NL' && v.legalAddressLines) out.push({ sourceId: 159, ref: `gleif_full#${lei}`, role: 'statutair', label: v.legalName, line: v.legalAddressLines, postcode: v.legalPostalCode });
      if (v.hqCountry === 'NL' && v.hqAddressLines && (v.hqAddressLines !== v.legalAddressLines || v.hqPostalCode !== v.legalPostalCode)) {
        out.push({ sourceId: 159, ref: `gleif_full#${lei}`, role: 'hoofdkantoor', label: v.legalName, line: v.hqAddressLines, postcode: v.hqPostalCode });
      }
    }
    return out;
  },
  duo: async () => (await latest(140)).map((r) => {
    const v = parse(r.raw_object) || {};
    return { sourceId: 140, ref: r.source_key, role: 'vestiging', label: v.naam, line: `${v.straat} ${v.huisnummer}`, postcode: v.postcode };
  }),
  // Jaarverantwoording zorg: veel rijen per organisatie; één adres per KvK/naam.
  zorg: async () => {
    const seen = new Map();
    for (const r of await latest(150)) {
      const d = (parse(r.raw_object) || {}).data || {};
      if (!d.straat_streetname || !d.huisnummer_housenumber || !d.postcode_postalcode) continue;
      const naam = d.naam_van_de_organisatie_zoals_geregistreerd_qnawnaamlrza || d.naam_name || '';
      const ref = `zorg:${d.kvknummer_externalorganizationid || naam}`;
      seen.set(ref, { sourceId: 150, ref, role: 'vestiging', label: naam, line: `${d.straat_streetname} ${d.huisnummer_housenumber}`, postcode: d.postcode_postalcode });
    }
    return [...seen.values()];
  },
  osm: async () => {
    const [row] = await latest(160, (await db.execute('SELECT source_key FROM source_records WHERE source_id = 160 ORDER BY id DESC LIMIT 1')).rows[0]?.source_key);
    return Object.values(parse(row.raw_object) || {}).filter((v) => v && v.name && v.housenumber && v.postcode).map((v) => ({
      sourceId: 160, ref: `osm#${v.osmId}`, role: 'vestiging', label: `${v.name} [${v.category}]`, line: `${v.street} ${v.housenumber}`, postcode: v.postcode,
    }));
  },
  // UIT-agenda: één rij per locatie, niet per evenement.
  uit: async () => {
    const seen = new Map();
    for (const r of await latest(152)) {
      const v = parse(r.raw_object) || {};
      if (!v.streetAddress || !v.postalCode) continue;
      const ref = `uit#${String(v.postalCode).replace(/\s+/g, '')}|${v.streetAddress}`;
      const prev = seen.get(ref);
      const count = (prev?.count || 0) + 1;
      seen.set(ref, { sourceId: 152, ref, role: 'evenementlocatie', label: `${v.venue || 'evenementlocatie'} (${count} evenement${count > 1 ? 'en' : ''} in de agenda)`, line: v.streetAddress, postcode: v.postalCode, count });
    }
    return [...seen.values()];
  },
  asbest: async () => (await latest(138)).map((r) => {
    const v = parse(r.raw_object) || {};
    const t = String(v.locatieText || '').replace(/\s+/g, ' ').trim();
    const m = /^(.+?)\s+(\d{1,5}\s*[A-Za-z]?)\b.*?(\d{4}\s?[A-Z]{2})\b/.exec(t);
    return m ? { sourceId: 138, ref: r.source_key, role: 'overtredingslocatie', label: `${v.bedrijf} (asbestovertreding)`, line: `${m[1]} ${m[2]}`, postcode: m[3] } : null;
  }).filter(Boolean),
  // Rijksmonumenten: BAG-relatie uit het RCE-register (per verblijfsobject).
  monumenten: async () => {
    const query = `PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
      SELECT DISTINCT ?nr ?pc ?adres WHERE {
        ?m ceo:rijksmonumentnummer ?nr ; ceo:heeftBasisregistratieRelatie ?b .
        ?b ceo:gemeentenaam ?g . FILTER(?g IN ("Amersfoort", "Leusden"))
        ?b ceo:heeftBAGRelatie ?r . ?r ceo:postcode ?pc ; ceo:volledigAdres ?adres . }`;
    const url = new URL(RCE_SPARQL);
    url.searchParams.set('query', query);
    const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'Stadsgeest/1.0' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`RCE SPARQL HTTP ${res.status}`);
    const rows = (await res.json()).results.bindings;
    return rows.map((b) => ({
      sourceId: MONUMENT_SOURCE_ID, ref: `monument:${b.nr.value}#${b.adres.value}`, role: 'monument',
      label: `Rijksmonument ${b.nr.value}`, line: b.adres.value, postcode: b.pc.value,
    }));
  },
};

async function main() {
  const stats = {};
  // Cache en bestaande rijen vooraf laden: de dagelijkse run doet dan alleen nog
  // PDOK-aanvragen en schrijfacties voor nieuwe of gewijzigde vestigingen.
  const cache = new Map((await db.execute('SELECT * FROM bag_lookup_cache')).rows.map((r) => [r.query_key, r]));
  const existing = new Map((await db.execute('SELECT source_id, record_ref, role, query_key, label FROM register_addresses')).rows
    .map((r) => [`${r.source_id}|${r.record_ref}|${r.role}`, r]));
  let anyFailed = false;
  for (const [name, load] of Object.entries(SOURCES)) {
    if (ONLY && !ONLY.has(name)) continue;
    let records;
    try { records = await load(); } catch (e) { console.error(`${name}: laden mislukt: ${e.message}`); anyFailed = true; continue; }
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
      try {
        res = cache.has(a.key) ? { ...cache.get(a.key), cached: true } : await lookup(db, a);
      } catch (e) { s.failed++; anyFailed = true; console.error(`${name} ${rec.ref}: ${e.message}`); continue; }
      if (!res.cached) { s.pdokCalls++; cache.set(a.key, res); }
      s.byStatus[res.status] = (s.byStatus[res.status] || 0) + 1;
      const r = await db.execute({
        sql: `INSERT INTO register_addresses (source_id, record_ref, role, label, query_key, address_text, match_status,
                nummeraanduiding_id, verblijfsobject_id, buurtcode, extractor_version)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(source_id, record_ref, role) DO UPDATE SET
                label = excluded.label, query_key = excluded.query_key, address_text = excluded.address_text,
                match_status = excluded.match_status, nummeraanduiding_id = excluded.nummeraanduiding_id,
                verblijfsobject_id = excluded.verblijfsobject_id, buurtcode = excluded.buurtcode,
                extractor_version = excluded.extractor_version, updated_at = datetime('now')`,
        args: [rec.sourceId, rec.ref, rec.role, rec.label, a.key, res.weergavenaam || a.text, res.status,
          res.nummeraanduiding_id, res.verblijfsobject_id, res.buurtcode, EXTRACTOR_VERSION],
      });
      s.written += r.rowsAffected;
    }
  }
  console.log(JSON.stringify(stats, null, 2));
  if (anyFailed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
