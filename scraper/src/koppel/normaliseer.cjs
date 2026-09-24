'use strict';

// Pure hulpfuncties voor de organisatiekoppeling (docs/KOPPELING.md).
// Geen netwerk en geen database, zodat ze los te testen zijn. De Python-worker
// krijgt de genormaliseerde velden van hier en normaliseert zelf niets.

// Rechtsvormen en toevoegingen die niets over de identiteit zeggen. Alles na
// "h.o.d.n." valt weg: de handelsnaam staat dan al vooraan.
const RECHTSVORM = /\b(b\.?\s?v\.?|n\.?\s?v\.?|v\.?o\.?f\.?|c\.?v\.?|u\.?a\.?|w\.?a\.?|stichting|stg|vereniging|coop(eratie|eratieve)?|holding|besloten vennootschap|naamloze vennootschap|h\.?o\.?d\.?n\.?.*$|i\.?o\.?|in liquidatie)(?=\s|$|[^a-z0-9])/g;

function normaliseerNaam(naam) {
  let s = String(naam || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^\x00-\x7f]/g, '').replace(/&/g, ' en ');
  s = s.replace(RECHTSVORM, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function normaliseerKvk(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(0, 8) : null;
}

function normaliseerPostcode(v) {
  const p = String(v || '').replace(/\s/g, '').toUpperCase();
  return /^\d{4}[A-Z]{2}$/.test(p) ? p : null;
}

// Woonkernen tellen als hun gemeente, zodat "Hoogland" en "Amersfoort" geen
// plaatsconflict geven. Iets dat geen plaatsnaam is (een datum in een verkeerd
// veld) wordt leeg.
const KERN = { hoogland: 'amersfoort', hooglanderveen: 'amersfoort', vathorst: 'amersfoort', achterveld: 'leusden', stoutenburg: 'leusden' };
function normaliseerPlaats(v) {
  const p = String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (!p || !/^[a-z' -]+$/.test(p)) return null;
  return KERN[p] || p;
}

// Huisnummer plus eventuele letter uit een adresregel ("Basicweg 12 a" → "12a").
function huisnummer(adres) {
  const m = String(adres || '').match(/(\d+)\s*([a-zA-Z]?)\b/);
  return m ? `${m[1]}${(m[2] || '').toLowerCase()}` : null;
}

// Rol van een bron in een verband. Geld en toezicht samen is waar de weger naar
// zoekt; een register zegt alleen dat een organisatie bestaat.
const ROL = {
  subsidie: 'geld', rvo: 'geld', tender_winnaar: 'geld',
  asbest: 'toezicht', arbeidsinspectie: 'toezicht', nvwa: 'toezicht', onderwijsinspectie: 'toezicht',
  insolventie: 'toezicht',
  anbi: 'register', gleif: 'register', lrk: 'register', afm: 'register', dnb: 'register', zorg: 'register',
  governance: 'register', seveso: 'register', openkvk: 'register', kg: 'register',
};

function rolVan(bron) {
  return ROL[bron] || 'register';
}

// Een record voor de worker: alleen de velden die Splink vergelijkt plus de
// harde sleutels. Namen korter dan 3 tekens na normalisatie tellen niet mee.
function maakRecord(ruw) {
  const naamNorm = normaliseerNaam(ruw.naam);
  if (naamNorm.length < 3) return null;
  return {
    bron: ruw.bron,
    rol: ruw.rol || rolVan(ruw.bron),
    bron_ref: String(ruw.bron_ref || ''),
    naam: String(ruw.naam).trim().slice(0, 300),
    naam_norm: naamNorm,
    kvk: normaliseerKvk(ruw.kvk),
    rsin: String(ruw.rsin || '').replace(/\D/g, '') || null,
    lei: String(ruw.lei || '').trim().toUpperCase() || null,
    postcode: normaliseerPostcode(ruw.postcode),
    huisnr: ruw.adres ? huisnummer(ruw.adres) : null,
    plaats: normaliseerPlaats(ruw.plaats),
    extra: String(ruw.extra || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
}

// Records met dezelfde bron en dezelfde genormaliseerde naam worden één record:
// een subsidieontvanger met tien regelingen is één organisatie in die bron.
function voegSamen(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.bron}|${r.naam_norm}`;
    const oud = map.get(key);
    if (!oud) { map.set(key, { ...r, n_rijen: 1, extras: r.extra ? [r.extra] : [] }); continue; }
    oud.n_rijen += 1;
    // Eén inspectie met overtreding maakt de organisatie in die bron een toezichtsgeval.
    if (r.rol === 'toezicht' || (r.rol === 'geld' && oud.rol === 'register')) oud.rol = r.rol;
    for (const veld of ['kvk', 'rsin', 'lei', 'postcode', 'huisnr', 'plaats']) if (!oud[veld] && r[veld]) oud[veld] = r[veld];
    if (r.extra && oud.extras.length < 8 && !oud.extras.includes(r.extra)) oud.extras.push(r.extra);
  }
  return [...map.values()].map(({ extras, ...r }, uid) => ({ ...r, uid, extra: extras.join(' | ').slice(0, 600) }));
}

// Clusteren uit paren van de worker plus harde sleutels (KvK, RSIN, LEI).
// Een paar waarvan beide kanten een ander KvK-nummer hebben, wordt niet
// samengevoegd: dat zijn twee rechtspersonen, ook als naam en adres lijken.
// Records moeten uid = hun index hebben (zoals voegSamen ze aflevert).
function clusteren(records, paren, drempel = 0.6) {
  const ouder = records.map((_, i) => i);
  const vind = (x) => { while (ouder[x] !== x) { ouder[x] = ouder[ouder[x]]; x = ouder[x]; } return x; };
  const kvkVan = new Map(records.map((r) => [r.uid, new Set(r.kvk ? [r.kvk] : [])]));
  const plaatsVan = new Map(records.map((r) => [r.uid, new Set(r.plaats ? [r.plaats] : [])]));
  const overlapt = (x, y) => !x.size || !y.size || [...x].some((k) => y.has(k));
  // Zacht (Splink-paar): ook de plaatsen van beide clusters moeten passen, zodat
  // een naamloze KG-entiteit geen brug slaat tussen De Baander in Amersfoort en
  // De Baander in Elim. Hard (gelijke identifier): alleen het KvK-conflict telt.
  const unie = (a, b, zacht) => {
    const ra = vind(a); const rb = vind(b);
    if (ra === rb) return true;
    if (!overlapt(kvkVan.get(ra), kvkVan.get(rb))) return false;
    if (zacht && !overlapt(plaatsVan.get(ra), plaatsVan.get(rb))) return false;
    ouder[rb] = ra;
    kvkVan.set(ra, new Set([...kvkVan.get(ra), ...kvkVan.get(rb)]));
    plaatsVan.set(ra, new Set([...plaatsVan.get(ra), ...plaatsVan.get(rb)]));
    return true;
  };
  for (const veld of ['kvk', 'rsin', 'lei']) {
    const eerste = new Map();
    for (const r of records) {
      if (!r[veld]) continue;
      if (eerste.has(r[veld])) unie(eerste.get(r[veld]), r.uid, false); else eerste.set(r[veld], r.uid);
    }
  }
  let geweigerd = 0;
  let afgewezen = 0;
  for (const paar of [...paren].sort((a, b) => b[2] - a[2])) {
    if (paar[2] < drempel) continue;
    if (!accepteerPaar(paar)) { afgewezen++; continue; }
    if (!unie(paar[0], paar[1], true)) geweigerd++;
  }
  const clusterVan = records.map((r) => vind(r.uid));
  return { clusterVan, geweigerd, afgewezen };
}

// Extra eisen boven de Splink-kans, op de vergelijkingsniveaus van de worker
// ([l, r, kans, naam, postcode, huisnr, plaats]). Proef 24-9: met alleen de kans
// gingen bedrijven in hetzelfde verzamelgebouw samen (Hoge Boom Beheer en
// Mobiliteitsfabriek) en een school in Elim met een naamgenoot in Amersfoort.
// - naam exact of Jaro-Winkler >= 0,97: goed, tenzij beide plaatsen bekend en verschillend;
// - naam Jaro-Winkler >= 0,9: alleen met hetzelfde postcode en huisnummer;
// - anders nooit.
// Paren zonder niveaus (oude worker) vallen terug op de kans alleen.
function accepteerPaar(paar) {
  if (paar.length < 7) return true;
  const [, , , naam, postcode, huisnr, plaats] = paar;
  if (naam >= 2) return plaats !== 0;
  if (naam === 1) return postcode === 1 && huisnr === 1;
  return false;
}

module.exports = {
  normaliseerNaam, normaliseerKvk, normaliseerPostcode, normaliseerPlaats, huisnummer, rolVan, maakRecord, voegSamen, clusteren,
  accepteerPaar, ROL,
};
