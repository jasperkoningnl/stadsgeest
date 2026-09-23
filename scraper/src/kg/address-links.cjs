'use strict';

// Adressen uit documenttekst halen en exact aan de BAG koppelen via de PDOK
// Locatieserver (koppelsleutel: nummeraanduiding-id). Alleen exacte treffers
// tellen: postcode + huisnummer (+ letter/toevoeging), of straat + huisnummer +
// woonplaats. Nabijheid of alleen een straatnaam is bewust geen koppeling.

const PDOK_FREE_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const EXTRACTOR_VERSION = 'adres-1';
const TARGET_MUNICIPALITIES = new Set(['amersfoort', 'leusden']);
// Langste eerst, anders wint 'Stoutenburg' van 'Stoutenburg Noord'.
const PLACES = ['Stoutenburg Noord', 'Hooglanderveen', 'Amersfoort', 'Achterveld', 'Stoutenburg', 'Hoogland', 'Leusden'];

const PARTICLES = "van|de|der|den|het|'t|ter|la|le|du";
const WORD = "[A-Z\\u00C0-\\u00DE][\\p{L}'\\u2019.\\-]*";
const STREET = `(${WORD}(?:\\s+(?:${WORD}|${PARTICLES})){0,4})`;
const HOUSE = '(\\d{1,5})(?:\\s?([A-Za-z])(?![\\p{L}]))?(?:\\s?[-/]\\s?(\\d{1,4}|[A-Za-z]{1,4})(?![\\p{L}\\d]))?';
const RE_POSTCODE = new RegExp(`${STREET}\\s+${HOUSE}\\s*,?\\s*(\\d{4})\\s?([A-Z]{2})(?![\\p{L}])`, 'gu');
const RE_PLACE = new RegExp(`${STREET}\\s+${HOUSE}\\s*,?\\s+(?:te\\s+|in\\s+)?(${PLACES.join('|')})(?![\\p{L}])`, 'gu');

const squash = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function keyFor(a) {
  const tail = `${a.huisnummer}|${squash(a.huisletter)}|${squash(a.toevoeging)}`;
  return a.postcode ? `pc:${a.postcode}|${tail}` : `str:${squash(a.street)}|${tail}|${squash(a.place)}`;
}

// Zoekt adressen in tekst. Eén resultaat per sleutel, met eerste positie en aantal.
function extractAddresses(text) {
  const src = String(text || '');
  const found = new Map();
  const add = (a, index, matchText) => {
    const last = a.street.trim().split(/\s+/).pop();
    if (/^postbus$/i.test(last)) return;
    // Kadastrale aanduiding ('(AMF00) M 431, Amersfoort') is geen adres.
    if (a.street.trim().length === 1) return;
    // '69-71' is een reeks huisnummers, geen toevoeging: neem het eerste nummer.
    if (/^\d+$/.test(a.toevoeging) && Number(a.toevoeging) > Number(a.huisnummer) && Number(a.toevoeging) - Number(a.huisnummer) <= 20) {
      a = { ...a, toevoeging: '' };
    }
    const key = keyFor(a);
    if (found.has(key)) { found.get(key).occurrences++; return; }
    found.set(key, { ...a, key, index, text: matchText.replace(/\s+/g, ' ').trim(), occurrences: 1 });
  };
  const covered = [];
  for (const m of src.matchAll(RE_POSTCODE)) {
    add({ method: 'postcode', street: m[1], huisnummer: m[2], huisletter: m[3] || '', toevoeging: m[4] || '', postcode: `${m[5]}${m[6]}`, place: '' }, m.index, m[0]);
    covered.push([m.index, m.index + m[0].length]);
  }
  for (const m of src.matchAll(RE_PLACE)) {
    if (covered.some(([s, e]) => m.index < e && m.index + m[0].length > s)) continue;
    add({ method: 'plaatsnaam', street: m[1], huisnummer: m[2], huisletter: m[3] || '', toevoeging: m[4] || '', postcode: '', place: m[5] }, m.index, m[0]);
  }
  return [...found.values()];
}

// 'Camera Obscurastraat 63', 'Kapelweg 148 A', 'Utrechtseweg 11-2' -> delen.
// Voor registers met een aparte postcode. Geeft null als er geen huisnummer is.
function parseStreetLine(line, postcode) {
  const m = /^(.*?\S)\s+(\d{1,5})\s*([A-Za-z])?(?:\s*[-\s/]\s*([0-9A-Za-z]{1,4}))?\s*$/.exec(String(line || '').replace(/\s+/g, ' ').trim());
  const pc = String(postcode || '').replace(/\s+/g, '').toUpperCase();
  if (!m || !/^\d{4}[A-Z]{2}$/.test(pc)) return null;
  const a = { method: 'postcode', street: m[1], huisnummer: m[2], huisletter: m[3] || '', toevoeging: m[4] || '', postcode: pc, place: '' };
  return { ...a, key: keyFor(a), text: `${line}, ${pc}` };
}

function point(wkt) {
  const m = /^POINT\((-?[\d.]+)\s+(-?[\d.]+)\)$/.exec(String(wkt || '').trim());
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : { lon: null, lat: null };
}

// Kiest het exacte BAG-adres uit PDOK-resultaten, of geeft de reden waarom niet.
function selectExact(a, docs) {
  const adressen = (docs || []).filter((d) => d.bron === 'BAG' && d.type === 'adres');
  let hits = adressen.filter((d) => String(d.huisnummer) === String(a.huisnummer));
  if (a.postcode) hits = hits.filter((d) => squash(d.postcode) === squash(a.postcode));
  else {
    const street = squash(a.street);
    hits = hits.filter((d) => {
      const s = squash(d.straatnaam);
      return s && street.endsWith(s) && squash(d.woonplaatsnaam) === squash(a.place);
    });
    // 'Korte Langestraat 143' mag niet op 'Langestraat 143' landen: langste straatnaam wint.
    const longest = Math.max(0, ...hits.map((d) => squash(d.straatnaam).length));
    hits = hits.filter((d) => squash(d.straatnaam).length === longest);
  }
  // Letter en toevoeging samen vergelijken: '11-A' en '11A' zijn in de praktijk hetzelfde.
  const extra = squash(a.huisletter) + squash(a.toevoeging);
  if (extra) {
    hits = hits.filter((d) => squash(d.huisletter) + squash(d.huisnummertoevoeging) === extra);
  } else {
    const plain = hits.filter((d) => !d.huisletter && !d.huisnummertoevoeging);
    if (plain.length) hits = plain;
  }
  const unique = [...new Map(hits.map((d) => [d.nummeraanduiding_id, d])).values()];
  if (unique.length === 0) return { status: 'none' };
  if (unique.length > 1) return { status: 'ambiguous' };
  const d = unique[0];
  if (!TARGET_MUNICIPALITIES.has(squash(d.gemeentenaam))) return { status: 'outside_area', doc: d };
  return { status: 'exact', doc: d };
}

function toRow(result) {
  const d = result.doc || {};
  const p = point(d.centroide_ll);
  return {
    status: result.status,
    nummeraanduiding_id: d.nummeraanduiding_id ? String(d.nummeraanduiding_id) : null,
    verblijfsobject_id: d.adresseerbaarobject_id ? String(d.adresseerbaarobject_id) : null,
    weergavenaam: d.weergavenaam || null,
    gemeente: d.gemeentenaam || null,
    buurtcode: d.buurtcode || null,
    lat: p.lat,
    lon: p.lon,
  };
}

async function queryPdok(a, fetchImpl = globalThis.fetch) {
  const url = new URL(PDOK_FREE_URL);
  const nr = `${a.huisnummer}${a.huisletter || ''}${a.toevoeging ? '-' + a.toevoeging : ''}`;
  url.searchParams.set('q', a.postcode ? `${a.postcode} ${nr}` : `${a.street} ${nr} ${a.place}`);
  url.searchParams.set('fq', 'type:adres');
  url.searchParams.set('rows', '10');
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Stadsgeest/1.0 (lokale journalistieke adreskoppeling)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`PDOK Locatieserver HTTP ${response.status}`);
  const payload = await response.json();
  return toRow(selectExact(a, payload?.response?.docs));
}

// Opzoeken met cache in bag_lookup_cache. Netwerkfouten worden niet gecachet.
async function lookup(db, a, { fetchImpl, delayMs = 120 } = {}) {
  const key = a.key || keyFor(a);
  const hit = (await db.execute({ sql: 'SELECT * FROM bag_lookup_cache WHERE query_key = ?', args: [key] })).rows[0];
  if (hit) return { ...hit, cached: true };
  const row = await queryPdok(a, fetchImpl);
  await db.execute({
    sql: `INSERT OR REPLACE INTO bag_lookup_cache (query_key, status, nummeraanduiding_id, verblijfsobject_id,
            weergavenaam, gemeente, buurtcode, lat, lon) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [key, row.status, row.nummeraanduiding_id, row.verblijfsobject_id, row.weergavenaam, row.gemeente, row.buurtcode, row.lat, row.lon],
  });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return { query_key: key, ...row, cached: false };
}

module.exports = { EXTRACTOR_VERSION, extractAddresses, parseStreetLine, keyFor, selectExact, toRow, queryPdok, lookup, squash };
