const PDOK_FREE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const TARGET_MUNICIPALITIES = new Set(['amersfoort', 'leusden']);

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function coordinates(value) {
  const match = /^POINT\((-?[\d.]+)\s+(-?[\d.]+)\)$/.exec(String(value || '').trim());
  return match ? { lon: Number(match[1]), lat: Number(match[2]) } : { lon: null, lat: null };
}

function selectExactAddress(location, docs) {
  const postcode = normalize(location.postal_code);
  const house = normalize(location.house_number).replace(/-/g, '');
  return (docs || []).find(doc => {
    const municipality = normalize(doc.gemeentenaam);
    const docHouse = normalize(doc.huis_nlt || doc.huisnummer).replace(/-/g, '');
    return doc.bron === 'BAG' && doc.type === 'adres' && normalize(doc.postcode) === postcode &&
      docHouse === house && TARGET_MUNICIPALITIES.has(municipality) && doc.nummeraanduiding_id;
  }) || null;
}

async function lookupBag(location, fetchImpl = globalThis.fetch) {
  const url = new URL(PDOK_FREE_URL);
  url.searchParams.set('q', `${location.postal_code} ${location.house_number}`);
  url.searchParams.set('fq', 'type:adres');
  url.searchParams.set('rows', '5');
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Stadsgeest/1.0 (lokale journalistieke data-audit)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`PDOK Locatieserver HTTP ${response.status}`);
  const payload = await response.json();
  const doc = selectExactAddress(location, payload?.response?.docs);
  if (!doc) return null;
  const point = coordinates(doc.centroide_ll);
  return {
    bagId: String(doc.nummeraanduiding_id),
    lat: point.lat,
    lon: point.lon,
    sourceUrl: String(doc.rdf_seealso || ''),
    displayName: String(doc.weergavenaam || ''),
  };
}

async function backfillBagLocations(db, options = {}) {
  const apply = options.apply === true;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const limit = Number.isInteger(options.limit) ? options.limit : 500;
  const rows = (await db.execute({
    sql: `SELECT id,label,street,house_number,postal_code,city,municipality
          FROM locations WHERE (bag_id IS NULL OR bag_id='') AND postal_code IS NOT NULL
          AND house_number IS NOT NULL ORDER BY id LIMIT ?`,
    args: [limit],
  })).rows;
  const result = { mode: apply ? 'apply' : 'dry-run', candidates: rows.length, matched: 0, unmatched: 0, failed: 0, updated: 0, examples: [] };
  for (const row of rows) {
    try {
      const match = await lookupBag(row, fetchImpl);
      if (!match) { result.unmatched++; continue; }
      result.matched++;
      if (result.examples.length < 5) result.examples.push({ locationId: Number(row.id), bagId: match.bagId, displayName: match.displayName });
      if (apply) {
        await db.execute({
          sql: `UPDATE locations SET bag_id=?,lat=COALESCE(?,lat),lon=COALESCE(?,lon) WHERE id=? AND (bag_id IS NULL OR bag_id='')`,
          args: [match.bagId, match.lat, match.lon, row.id],
        });
        result.updated++;
      }
    } catch (error) {
      result.failed++;
      if (result.examples.length < 5) result.examples.push({ locationId: Number(row.id), error: error.message });
    }
  }
  return result;
}

module.exports = { PDOK_FREE_URL, coordinates, selectExactAddress, lookupBag, backfillBagLocations };
