// officielebekendmakingen-repo.js — Officiële Bekendmakingen via repository.overheid.nl
//
// VERVANGT: officielebekendmakingen.js (broken), officielebekendmakingen-split.js,
//           officielebekendmakingen-wekelijks.js
//
// Waarom een nieuwe scraper (24-07-2026):
//   1. zoek.officielebekendmakingen.nl/sru/Search geeft sinds enige tijd HTTP 500 op ELKE query.
//      De split-scraper draaide daardoor sinds 4 juni 2026 leeg.
//   2. De oude queries gebruikten dcterms.spatial. Dat veld is vrijwel nooit gevuld
//      (1.101 records) en de wekelijkse creator-queries stonden op Vallei en Veluwe /
//      provincie Utrecht — die leverden landelijke ruis op (Heerhugowaard, Bergambacht).
//      Correcte index is dt.creator=="Amersfoort" → 60.198 records.
//   3. De itemtekst werd opgehaald van zoek.officielebekendmakingen.nl → 157 tekens
//      navigatie-boilerplate. De repository-URL levert de VOLLEDIGE besluittekst
//      (2.500–6.000 tekens) inclusief adressen, kenmerken, aanvragers en bezwaartermijnen.
//      Die tekst gaat naar raw_items.full_text en is de basis voor entiteitsmatching.
//
// Getest 24-07-2026: 262 Amersfoortse publicaties in de laatste 9 dagen.

import * as cheerio from 'cheerio';
import { createDb, ensureSource, insertItem, log, makeSummary } from '../lib.js';

const db = createDb();
const SRU = 'https://repository.overheid.nl/sru';
const UA = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';

// Aantal dagen terugkijken. Ruim genomen: dedup in insertItem vangt overlap af.
const WINDOW_DAYS = Number(process.env.OB_WINDOW_DAYS || 7);
const MAX_RECORDS = 100;
const FETCH_DELAY_MS = 700;

// Elk item krijgt een bron op basis van zijn rubriek. Zo blijft de tier-indeling
// bruikbaar en kan de speurder onderscheid maken tussen een dakkapel en een
// bestemmingsplanwijziging.
const RUBRIEK_ROUTING = [
  { match: /omgevingsvergunning|omgevingsmelding|bouw/i, source: 'ob-omgevingsvergunningen', name: 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort', tier: 1 },
  { match: /verkeersbesluit/i,                            source: 'ob-verkeersbesluiten',      name: 'Officiële Bekendmakingen — Verkeersbesluiten Amersfoort', tier: 1 },
  { match: /verordening|algemeen verbindend voorschrift/i, source: 'ob-verordeningen',          name: 'Officiële Bekendmakingen — Verordeningen Amersfoort', tier: 1 },
  { match: /beleidsregel/i,                               source: 'ob-beleidsregels',          name: 'Officiële Bekendmakingen — Beleidsregels Amersfoort', tier: 1 },
  { match: /evenementenvergunning|apv|ontheffing/i,       source: 'ob-vergunningen-overig',    name: 'Officiële Bekendmakingen — Vergunningen overig Amersfoort', tier: 1 },
  { match: /ruimtelijk|bestemmingsplan|omgevingsplan/i,   source: 'ob-ruimtelijke-plannen',    name: 'Officiële Bekendmakingen — Ruimtelijke plannen Amersfoort', tier: 1 },
];
const FALLBACK_SOURCE = { source: 'ob-gemeenteblad-overig', name: 'Officiële Bekendmakingen — Gemeenteblad overig Amersfoort', tier: 1 };

function routeRubriek(docTypes) {
  const joined = docTypes.join(' ');
  for (const r of RUBRIEK_ROUTING) if (r.match.test(joined)) return r;
  return FALLBACK_SOURCE;
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

async function fetchPage(startRecord, since, creator = 'Amersfoort') {
  const query = `c.product-area==officielepublicaties AND dt.creator=="${creator}" AND dt.modified>="${since}"`;
  const url = `${SRU}?operation=searchRetrieve&version=2.0&maximumRecords=${MAX_RECORDS}` +
              `&startRecord=${startRecord}&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`SRU HTTP ${r.status}`);
  return await r.text();
}

function parseRecords(xml) {
  const out = [];
  for (const m of xml.matchAll(/<sru:record>[\s\S]*?<\/sru:record>/g)) {
    const b = m[0];
    const identifier = (b.match(/<dcterms:identifier>([^<]+)</) || [])[1];
    if (!identifier) continue;
    const title = (b.match(/<dcterms:title>([^<]+)</) || [])[1] || identifier;
    const modified = (b.match(/<dcterms:modified>([^<]+)</) || [])[1] || '';
    const docTypes = [...b.matchAll(/<dcterms:type[^>]*>([^<]+)</g)].map(x => x[1].trim());
    // gzd:itemUrl bevat de directe repository-URL naar de HTML-versie.
    const itemUrl = (b.match(/<gzd:itemUrl[^>]*>([^<]+)</) || [])[1];
    out.push({ identifier, title, modified, docTypes, itemUrl });
  }
  return out;
}

// De repository-HTML bevat een vaste navigatiekop. Alles vóór "Lichaam" is boilerplate.
function cleanDocumentText(html) {
  const $ = cheerio.load(html);
  $('nav, footer, aside, script, style, .skiplinks, .menu, .breadcrumb').remove();
  let txt = ($('article, .stuk, main, .content').first().text() || $('body').text())
    .replace(/\s+/g, ' ')
    .trim();
  const cut = txt.indexOf('Lichaam');
  if (cut > -1 && cut < 1200) txt = txt.slice(cut + 'Lichaam'.length).trim();
  // Staartboilerplate van overheid.nl afkappen
  txt = txt.split(/Deze site is een initiatief van|Naar boven|Snelzoeken/)[0].trim();
  return txt;
}

async function fetchDocument(rec) {
  const candidates = [
    rec.itemUrl,
    `https://repository.overheid.nl/frbr/officielepublicaties/${rec.identifier.split('-')[0]}/${rec.identifier.split('-')[1]}/${rec.identifier}/1/html/${rec.identifier}.html`,
  ].filter(Boolean);

  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.trim().startsWith('%PDF')) continue;
      const txt = cleanDocumentText(html);
      if (txt.length > 120) return { text: txt, url };
    } catch { /* volgende kandidaat */ }
  }
  return null;
}

async function scrape() {
  const since = isoDaysAgo(WINDOW_DAYS);
  console.log(`\n[OB-REPO] gestart ${new Date().toISOString()} — venster vanaf ${since}`);

  // Bron-ids vooraf klaarzetten
  const sourceIds = {};
  for (const def of [...RUBRIEK_ROUTING, FALLBACK_SOURCE]) {
    sourceIds[def.source] = await ensureSource(db, {
      name: def.name,
      url: `${SRU}?rubriek=${def.source}`,
      source_type: 'api',
      reliability: 'primary',
      category: 'government',
      scrape_frequency: 'daily',
      tier: def.tier ?? 1,
    });
  }

  const stats = { new: 0, skipped: 0, errors: 0, fulltext: 0, nofulltext: 0 };
  // Per rubriek meetellen, zodat elke bron zijn eigen rij in scrape_runs krijgt.
  const perBron = {};
  const teller = (bron) => {
    if (!perBron[bron]) perBron[bron] = { new: 0, skipped: 0, errors: 0 };
    return perBron[bron];
  };
  let start = 1;
  let total = null;

  while (total === null || start <= total) {
    let xml;
    try {
      xml = await fetchPage(start, since);
    } catch (e) {
      console.error(`[OB-REPO] SRU-fout bij startRecord=${start}: ${e.message}`);
      break;
    }
    if (total === null) {
      total = Number((xml.match(/<sru:numberOfRecords>(\d+)</) || [])[1] || 0);
      console.log(`[OB-REPO] ${total} publicaties gevonden sinds ${since}`);
      if (total === 0) break;
    }

    const records = parseRecords(xml);
    if (records.length === 0) break;

    for (const rec of records) {
      const route = routeRubriek(rec.docTypes);
      const publicUrl = `https://zoek.officielebekendmakingen.nl/${rec.identifier}.html`;
      try {
        const doc = await fetchDocument(rec);
        await new Promise(r => setTimeout(r, FETCH_DELAY_MS));

        if (doc) stats.fulltext++; else stats.nofulltext++;

        const meta = [rec.docTypes.join(' / '), rec.modified].filter(Boolean).join(' | ');
        const summary = doc ? makeSummary(doc.text) : meta;
        const saved = await insertItem(db, {
          source_id: sourceIds[route.source],
          title: rec.title,
          content: doc ? doc.text.substring(0, 25000) : meta,
          summary,
          external_url: publicUrl,
          scraped_at: new Date().toISOString(),
          published_at: rec.modified || null,
          full_text: doc ? doc.text : null,
        });
        const b = teller(route.source);
        if (saved === true) { stats.new++; b.new++; }
        else if (saved === false) { stats.skipped++; b.skipped++; }
        else { stats.errors++; b.errors++; }
      } catch (e) {
        stats.errors++;
        teller(route.source).errors++;
        console.error(`[OB-REPO] fout bij ${rec.identifier}: ${e.message}`);
      }
    }

    start += MAX_RECORDS;
  }

  // Per rubriek loggen. Hier stond `log('Officiële Bekendmakingen Amersfoort (repo)', stats)`,
  // maar log() uit lib.js verwacht (db, sourceId, sourceName, stats). De aanroep
  // wierp daardoor bij elke run een TypeError op stats.new — ná het wegschrijven van
  // de items, dus die kwamen wel binnen, maar er is sinds 24 juli 2026 geen enkele
  // rij in scrape_runs geschreven voor deze bronnen. In het bronnenoverzicht zag dat
  // eruit alsof de scraper nooit had gedraaid.
  for (const def of [...RUBRIEK_ROUTING, FALLBACK_SOURCE]) {
    await log(db, sourceIds[def.source], def.name, teller(def.source));
  }
  console.log(`[OB-REPO] volledige tekst opgehaald: ${stats.fulltext}, mislukt: ${stats.nofulltext}`);

  await scrapeLeusden(since);
  return stats;
}

// Leusden. Nieuwsplein33 bedient Amersfoort én Leusden, maar de bronnenlijst was
// tot 8 augustus 2026 volledig Amersfoorts — de helft van hun gebied leverde nul.
// Dit is de goedkoopste manier om daar iets aan te doen: dezelfde SRU-index, alleen
// een andere `dt.creator`.
//
// Anders dan bij Amersfoort gaat alles naar één bron in plaats van naar zeven
// rubrieken. Leusden publiceert ongeveer acht stukken per week; die opsplitsen
// levert zeven bronnen op die elk vrijwel altijd leeg zijn, en dat maakt het
// bronnenoverzicht juist onleesbaar.
async function scrapeLeusden(since) {
  const sourceId = await ensureSource(db, {
    name: 'Officiële Bekendmakingen — Leusden',
    url: `${SRU}?rubriek=ob-leusden`,
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'daily',
    tier: 1,
  });
  await db.execute({
    sql: `UPDATE sources SET gemeente = 'Leusden' WHERE id = ? AND (gemeente IS NULL OR gemeente <> 'Leusden')`,
    args: [sourceId],
  });

  const s = { new: 0, skipped: 0, errors: 0 };
  let start = 1;
  let total = null;

  while (total === null || start <= total) {
    let xml;
    try {
      xml = await fetchPage(start, since, 'Leusden');
    } catch (e) {
      console.error(`[OB-LEUSDEN] SRU-fout bij startRecord=${start}: ${e.message}`);
      s.errors++;
      break;
    }
    if (total === null) {
      total = Number((xml.match(/<sru:numberOfRecords>(\d+)</) || [])[1] || 0);
      console.log(`[OB-LEUSDEN] ${total} publicaties gevonden sinds ${since}`);
      if (total === 0) break;
    }

    const records = parseRecords(xml);
    if (records.length === 0) break;

    for (const rec of records) {
      try {
        const doc = await fetchDocument(rec);
        await new Promise(r => setTimeout(r, FETCH_DELAY_MS));
        const meta = [rec.docTypes.join(' / '), rec.modified].filter(Boolean).join(' | ');
        const summary = doc ? makeSummary(doc.text) : meta;
        const saved = await insertItem(db, {
          source_id: sourceId,
          title: rec.title,
          content: doc ? doc.text.substring(0, 25000) : meta,
          summary,
          external_url: `https://zoek.officielebekendmakingen.nl/${rec.identifier}.html`,
          scraped_at: new Date().toISOString(),
          published_at: rec.modified || null,
          full_text: doc ? doc.text : null,
        });
        if (saved === true) s.new++;
        else if (saved === false) s.skipped++;
        else s.errors++;
      } catch (e) {
        s.errors++;
        console.error(`[OB-LEUSDEN] fout bij ${rec.identifier}: ${e.message}`);
      }
    }
    start += MAX_RECORDS;
  }

  await log(db, sourceId, 'Officiële Bekendmakingen — Leusden', s);
  return s;
}

scrape().catch(e => { console.error('[OB-REPO] fataal:', e); process.exit(1); });
