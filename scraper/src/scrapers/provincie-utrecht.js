// provincie-utrecht.js — nieuws van de provincie Utrecht, gefilterd op Amersfoort
//
// Herbouwd op 9 augustus 2026. Wat hier stond logde 0/0/0 zonder iets te proberen,
// met als reden dat provincie-utrecht.nl een Cloudflare-challenge geeft. Dat klopte,
// maar de oorzaak lag bij ons. De challenge vuurt op de User-Agent: met de
// Chrome-string die alle scrapers hier meesturen komt er een pagina van 14 kB terug
// met de titel "Security verifications". Met een eerlijke, zichzelf benoemende
// User-Agent — of helemaal zonder — geeft dezelfde URL gewoon 78 kB HTML.
// Getest 9 augustus 2026 op vier varianten: geen UA, curl, deze UA en Googlebot;
// alleen de browser-achtige strings worden uitgedaagd.
//
// Dus geen omweg om een beveiliging heen: we stellen ons voor in plaats van ons
// voor te doen als iemand anders. Dat is ook waarom hier niet de gedeelde
// BROWSER_UA uit de andere scrapers staat.
//
// De nieuwsindex is server-rendered en levert de negen meest recente berichten.
// Die worden stuk voor stuk opgehaald en alleen bewaard als ze aantoonbaar over
// Amersfoort of de directe regio gaan — de provincie publiceert veel over
// Woudenberg, Den Dolder en het landelijk gebied, en dat is voor deze redactie ruis.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BASIS = 'https://www.provincie-utrecht.nl';
const SOURCE_URL = `${BASIS}/actueel/nieuws`;
const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const PAUZE_MS = 700;

// Amersfoort plus de kernen en dossiers waar de redactie over gaat.
//
// Twee niveaus, en dat is nodig gebleken. De eerste versie testte één ruime regex
// op de hele artikeltekst en hield 5 van de 9 berichten over, waarvan er maar één
// over Amersfoort ging. De rest kwam binnen op woorden uit de aanbevolen-artikelen
// en kruimelpaden onderaan de pagina, die binnen <main> staan en dus niet met
// nav/footer worden weggegooid. Nu: kop of URL is genoeg bewijs, en anders moet de
// tekst de regio minstens twee keer noemen.
const RELEVANT_KOP = /amersfoort|eemland|leusden|soesterkwartier|vathorst|hoogland|nieuwland|kattenbroek|schothorst|liendert|randenbroek|n199|n221|knooppunt hoevelaken|eemplein/i;
const RELEVANT_TEKST = /amersfoort|eemland|leusden/gi;
const MINSTENS_IN_TEKST = 2;

function gaatOverDeRegio(titel, url, tekst) {
  if (RELEVANT_KOP.test(titel) || RELEVANT_KOP.test(url)) return true;
  return (tekst.match(RELEVANT_TEKST) ?? []).length >= MINSTENS_IN_TEKST;
}

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

async function haal(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} op ${url}`);
  const tekst = await resp.text();
  if (/Security verifications/i.test(tekst)) {
    throw new Error('Cloudflare-challenge — de User-Agent wordt weer uitgedaagd, zie kop van dit bestand');
  }
  return tekst;
}

function leesArtikel(html) {
  const $ = cheerio.load(html);
  const titel = ($('h1').first().text() || $('title').text() || '').replace(/\s+/g, ' ').trim();
  // .views-element-container is het blok "gerelateerd nieuws" onderaan. Dat staat
  // binnen <main> en bevatte bij het bericht over de rotonde in Woudenberg drie keer
  // het woord Amersfoort, waardoor het bericht ten onrechte werd bewaard. Eerst weg,
  // en daarna liefst alleen de tekstblokken van het artikel zelf.
  $('script, style, nav, header, footer, aside, .views-element-container').remove();
  const artikel = $('.content-block--text');
  const body = artikel.length ? artikel : ($('main').first().length ? $('main').first() : $('body'));
  const tekst = body.text().replace(/\s+/g, ' ').trim();
  const datum = $('time[datetime]').first().attr('datetime')
    || $('meta[property="article:published_time"]').attr('content')
    || null;
  return { titel, tekst, datum };
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Provincie Utrecht — nieuws Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;

  try {
    const $ = cheerio.load(await haal(SOURCE_URL));
    const links = [...new Set(
      $('a[href*="/actueel/nieuws/"]')
        .map((_, e) => $(e).attr('href'))
        .get()
        .filter((h) => h && h !== '/actueel/nieuws' && !h.includes('#')),
    )];
    if (links.length === 0) throw new Error('Geen artikellinks op de nieuwsindex — opbouw gewijzigd');

    for (const href of links) {
      const url = href.startsWith('http') ? href : BASIS + href;
      gevonden++;
      try {
        await pauze(PAUZE_MS);
        const { titel, tekst, datum } = leesArtikel(await haal(url));
        if (!titel || tekst.length < 200) { skipped++; continue; }
        if (!gaatOverDeRegio(titel, url, tekst)) { skipped++; continue; }

        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: url,
          title: titel.substring(0, 500),
          content: tekst.substring(0, 8000),
          summary: `Provincie Utrecht${datum ? `, ${String(datum).substring(0, 10)}` : ''} — ${titel}`.substring(0, 500),
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Artikel ${url}: ${err.message}`);
      }
    }
  } catch (err) {
    errors++;
    console.error(`[Provincie Utrecht] ${err.message}`);
  }

  await logResult(db, sourceId, 'Provincie Utrecht — nieuws Amersfoort', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
