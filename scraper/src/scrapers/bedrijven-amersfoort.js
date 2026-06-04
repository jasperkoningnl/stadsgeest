// bedrijven-amersfoort.js — Bedrijven gevestigd in of verbonden aan Amersfoort
// Actief: Qbuzz (OV-vervoerder), Noordhoff (educatieve uitgever)
// Stub:   RHDHV (domein onbereikbaar), ASR (pers-pagina 404), AmersfoortBusiness (domein 404)

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ─── Qbuzz — /nieuws ──────────────────────────────────────────────────────
async function scrapeQbuzz() {
  const PAGE_URL = 'https://www.qbuzz.nl/nieuws';
  const BASE_URL  = 'https://www.qbuzz.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Qbuzz',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;
  try {
    const html = await fetchHtml(PAGE_URL);
    const $ = cheerio.load(html);
    const links = new Map();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || href === PAGE_URL || href.endsWith('/nieuws') || href.endsWith('/nieuws/')) return;
      if (!href.includes('/nieuws/') && !href.includes('/artikel/') && !href.includes('/bericht/')) return;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      if (links.has(url)) return;
      const title = ($(el).text().trim()
        || $(el).closest('article').find('h1,h2,h3,h4').first().text().trim()
        || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
        || '').trim();
      if (title) links.set(url, title);
    });

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Qbuzz fout:', e.message); errors++; }
  logResult('Qbuzz', saved, skipped, errors);
}

// ─── Noordhoff — /pers ────────────────────────────────────────────────────
async function scrapeNoordhoff() {
  const PAGE_URL = 'https://www.noordhoff.nl/pers';
  const BASE_URL  = 'https://www.noordhoff.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Noordhoff',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;
  try {
    const html = await fetchHtml(PAGE_URL);
    const $ = cheerio.load(html);
    const links = new Map();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
      // Persberichten staan typisch op /pers/<slug> of /nieuws/<slug>
      if (!href.includes('/pers/') && !href.includes('/nieuws/') && !href.includes('/persbericht')) return;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      if (links.has(url)) return;
      const title = ($(el).text().trim()
        || $(el).closest('article,li,.card,.item').find('h1,h2,h3,h4').first().text().trim()
        || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
        || '').trim();
      if (title && url !== PAGE_URL) links.set(url, title);
    });

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Noordhoff fout:', e.message); errors++; }
  logResult('Noordhoff', saved, skipped, errors);
}

// ─── FrieslandCampina — UITGESCHAKELD ────────────────────────────────────
// Client-side rendered (volledig JS): geen links in ruwe HTML.
// TODO: Playwright-scraper toevoegen (run-browser.js).
async function scrapeFrieslandCampina() {
  const PAGE_URL = 'https://www.frieslandcampina.com/nl/nieuws/';
  const BASE_URL  = 'https://www.frieslandcampina.com';

  const sourceId = await getOrCreateSource(db, {
    name: 'FrieslandCampina',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;
  try {
    const html = await fetchHtml(PAGE_URL);
    const $ = cheerio.load(html);
    const links = new Map();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
      if (!href.includes('/nieuws/') && !href.includes('/news/') && !href.includes('/pers/') && !href.includes('/press/')) return;
      if (href === PAGE_URL || href.endsWith('/nieuws/') || href.endsWith('/news/')) return;
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      if (links.has(url)) return;
      const title = ($(el).text().trim()
        || $(el).closest('article,.card,.item').find('h1,h2,h3,h4').first().text().trim()
        || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
        || '').replace(/\s+/g, ' ').trim();
      if (title) links.set(url, title);
    });

    // (stub: pagina laadt niet zonder JS)
    skipped = 0;
  } catch (e) { /* stub */ }
  logResult('FrieslandCampina', saved, skipped, errors);
}

// ─── RHDHV — UITGESCHAKELD ────────────────────────────────────────────────
// Royal HaskoningDHV: haskoning.com en royalhaskoningdhv.com /nl-nl/nieuws leveren 404.
// TODO: controleer periodiek of het domein hersteld is.

// ─── ASR — UITGESCHAKELD ─────────────────────────────────────────────────
// a.s.r. verzekeringen: asr.nl/over-asr/pers 404, alternatief pad onbekend.
// TODO: controleer periodiek (probeer /over-asr/pers-en-media of /nieuws).

// ─── AmersfoortBusiness — UITGESCHAKELD ──────────────────────────────────
// amersfoortbusiness.nl en amersfoortbusiness.com: domein onbereikbaar.
// TODO: controleer of er een opvolger is.

async function scrape() {
  await scrapeFrieslandCampina();
  await scrapeQbuzz();
  await scrapeNoordhoff();
}

scrape().catch(console.error);
