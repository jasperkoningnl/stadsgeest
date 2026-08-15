// officielebekendmakingen-wekelijks.js — Provinciaal blad en Waterschapsblad
//
// Herschreven op 9 augustus 2026. Wat hier stond deugde op drie punten niet.
//
//   1. Het draaide op `zoek.officielebekendmakingen.nl/sru/Search`. Dat endpoint
//      geeft HTTP 500 op élke query, ook op `operation=explain`. De drie bronnen
//      leverden sinds begin juli niets meer. Nu `repository.overheid.nl/sru`.
//   2. Er stond geen filter op plaats. `dcterms.creator any "provincie Utrecht"`
//      geeft de hele provincie: Nieuwegein, Renswoude, Mijdrecht, Utrechtse
//      Heuvelrug. `Vallei en Veluwe` geeft 555 berichten van Wageningen tot
//      Nunspeet. Dat is de landelijke ruis waar BRONNEN.md voor waarschuwt.
//      Er zit nu een plaatsfilter op de titel.
//   3. De bron `ob-gemeenschappelijke-regelingen` stond hier met de query
//      `dcterms.creator any "Regio Amersfoort"` en de aantekening dat BGR "0 geeft
//      op dit endpoint". Wat die query in werkelijkheid ophaalde waren gewone
//      Amersfoortse gemeentebladberichten — een schutting aan de Larixstraat, het
//      Aanwijzingsbesluit betaald parkeren, tijdelijk cameratoezicht. 86 items
//      onder een naam die de lading niet dekt. Die bron is hier weggehaald;
//      gemeenschappelijke regelingen worden nu in `run-nieuw.js` opgehaald via
//      `w.publicatienaam=="Blad gemeenschappelijke regeling"` met een lijst
//      opstellers waar Amersfoort in deelneemt.
//
// De juiste index voor het soort publicatie is `w.publicatienaam`, niet
// `dcterms.type`. Dat laatste bevat de rubriek ("ander besluit van algemene
// strekking"), niet het blad.

import { createDb, ensureSource, insertItem, log } from '../lib.js';

const db = createDb();
const SRU = 'https://repository.overheid.nl/sru';
const OB_BASE = 'https://zoek.officielebekendmakingen.nl';
const UA = 'Stadsgeest033/1.0 (persbureau Amersfoort)';

const VENSTER_DAGEN = Number(process.env.OB_WINDOW_DAYS || 30);
const MAX_RECORDS = 100;

// Plaatsnamen binnen Amersfoort en Leusden. Achterveld en Stoutenburg horen bij
// Leusden, Hoogland en Hooglanderveen bij Amersfoort. Zonder deze lijst haalt een
// creator-query de halve provincie binnen.
const PLAATSEN = [
  { naam: 'Amersfoort', gemeente: 'Amersfoort' },
  { naam: 'Hoogland', gemeente: 'Amersfoort' },
  { naam: 'Hooglanderveen', gemeente: 'Amersfoort' },
  { naam: 'Vathorst', gemeente: 'Amersfoort' },
  { naam: 'Leusden', gemeente: 'Leusden' },
  { naam: 'Achterveld', gemeente: 'Leusden' },
  { naam: 'Stoutenburg', gemeente: 'Leusden' },
];

const BRONNEN = [
  {
    sourceId: 'ob-waterschapsblad',
    name: 'Officiële Bekendmakingen — Waterschapsblad',
    tier: 1,
    publicatienaam: 'Waterschapsblad',
    creator: 'Vallei en Veluwe',
  },
  {
    sourceId: 'ob-provinciaal-blad',
    name: 'Officiële Bekendmakingen — Provinciaal blad',
    tier: 2,
    publicatienaam: 'Provinciaal blad',
    creator: 'Utrecht',
  },
];

function sindsDatum() {
  return new Date(Date.now() - VENSTER_DAGEN * 86400000).toISOString().slice(0, 10);
}

// Welke gemeente raakt dit bericht? Null als het geen van beide is.
function bepaalGemeente(tekst) {
  for (const p of PLAATSEN) {
    // Woordgrens, anders matcht "Leusden" ook in "Leusderweg" — dat is Amersfoort.
    if (new RegExp(`\\b${p.naam}\\b`, 'i').test(tekst)) return p;
  }
  return null;
}

function parseRecords(xml) {
  const records = [];
  for (const m of xml.matchAll(/<sru:record>[\s\S]*?<\/sru:record>/g)) {
    const blok = m[0];
    const identifier = (blok.match(/<dcterms:identifier>([^<]+)</) || [])[1];
    if (!identifier) continue;
    const title = (blok.match(/<dcterms:title>([^<]+)</) || [])[1] || identifier;
    const date = (blok.match(/<dcterms:modified>([^<]+)</) || [])[1] || '';
    const docType = (blok.match(/<dcterms:type[^>]*>([^<]+)</) || [])[1] || '';
    const preferred = (blok.match(/<gzd:preferredUrl>([^<]+)</) || [])[1];
    records.push({
      identifier,
      title: title.trim(),
      date: date.trim(),
      docType: docType.trim(),
      url: preferred || `${OB_BASE}/${identifier}.html`,
    });
  }
  return records;
}

async function haalPagina(bron, startRecord, sinds) {
  const query = `c.product-area==officielepublicaties`
    + ` AND w.publicatienaam=="${bron.publicatienaam}"`
    + ` AND dt.creator any "${bron.creator}"`
    + ` AND dt.modified>="${sinds}"`;
  const url = `${SRU}?operation=searchRetrieve&version=2.0&maximumRecords=${MAX_RECORDS}`
    + `&startRecord=${startRecord}&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`SRU HTTP ${r.status}`);
  return r.text();
}

async function scrapeBron(bron, sinds) {
  const sourceId = await ensureSource(db, {
    name: bron.name,
    url: `${SRU}?rubriek=${bron.sourceId}`,
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'weekly',
    tier: bron.tier,
  });

  const stats = { new: 0, skipped: 0, errors: 0 };
  let bekeken = 0;
  let start = 1;
  let total = null;

  while (total === null || start <= total) {
    let xml;
    try {
      xml = await haalPagina(bron, start, sinds);
    } catch (e) {
      console.error(`[OB-WEEK] ${bron.name}: ${e.message}`);
      stats.errors++;
      break;
    }
    if (total === null) {
      total = Number((xml.match(/<sru:numberOfRecords>(\d+)</) || [])[1] || 0);
      if (total === 0) break;
    }

    const records = parseRecords(xml);
    if (records.length === 0) break;

    for (const rec of records) {
      bekeken++;
      const plaats = bepaalGemeente(rec.title);
      if (!plaats) { stats.skipped++; continue; }

      const result = await insertItem(db, {
        source_id: sourceId,
        title: rec.title.substring(0, 300),
        content: `${rec.title}\n\nOpsteller: ${bron.creator}. Blad: ${bron.publicatienaam}.`
          + `${rec.docType ? ` Rubriek: ${rec.docType}.` : ''}`
          + `${rec.date ? ` Laatst gewijzigd: ${rec.date}.` : ''}`
          + `\nGemeente: ${plaats.gemeente} (herkend op plaatsnaam "${plaats.naam}" in de titel).`,
        summary: [bron.creator, rec.docType, rec.date].filter(Boolean).join(' | '),
        external_url: rec.url,
        scraped_at: new Date().toISOString(),
        published_at: rec.date || null,
      });
      if (result === true) stats.new++;
      else if (result === false) stats.skipped++;
      else stats.errors++;
    }
    start += MAX_RECORDS;
  }

  console.log(`[OB-WEEK] ${bron.name}: ${bekeken} berichten van ${bron.creator} bekeken, `
    + `${stats.new} nieuw voor Amersfoort of Leusden`);
  await log(db, sourceId, bron.name, stats, bekeken);
  return stats;
}

async function scrape() {
  const sinds = sindsDatum();
  console.log(`\n[OB-WEEK] gestart ${new Date().toISOString()} — venster vanaf ${sinds}`);
  for (const bron of BRONNEN) {
    try {
      await scrapeBron(bron, sinds);
    } catch (e) {
      console.error(`[OB-WEEK] fataal bij ${bron.name}: ${e.message}`);
    }
  }
}

scrape().catch(e => { console.error('[OB-WEEK] fataal:', e); process.exit(1); });
