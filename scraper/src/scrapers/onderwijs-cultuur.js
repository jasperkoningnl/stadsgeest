// onderwijs-cultuur.js — Onderwijs en cultuur in Amersfoort
// Actief: Diabetesfonds, MBO Amersfoort
// Stub:   Musiom (domein onbereikbaar), Cavaleriemuseum (onbereikbaar), Rietveldpaviljoen (onbereikbaar)

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

function extractLinks($, baseUrl, pathPatterns) {
  const links = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const matches = pathPatterns.some(p => href.includes(p));
    if (!matches) return;
    const url = href.startsWith('http') ? href : `${baseUrl}${href}`;
    if (links.has(url)) return;
    const title = ($(el).text().trim()
      || $(el).closest('article,.card,.item,li').find('h1,h2,h3,h4').first().text().trim()
      || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ')
      || '').replace(/\s+/g, ' ').trim();
    if (title && url !== baseUrl) links.set(url, title);
  });
  return links;
}

// ─── Diabetesfonds ────────────────────────────────────────────────────────
// Gevestigd in Amersfoort. Fondsenwervende gezondheidsorganisatie.
async function scrapeDiabetesfonds() {
  const PAGE_URL = 'https://www.diabetesfonds.nl/nieuws';
  const BASE_URL  = 'https://www.diabetesfonds.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Diabetesfonds',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/artikel/', '/bericht/']);

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Diabetesfonds fout:', e.message); errors++; }
  logResult('Diabetesfonds', saved, skipped, errors);
}

// ─── MBO Amersfoort ───────────────────────────────────────────────────────
// ROC/MBO in Amersfoort.
async function scrapeMboAmersfoort() {
  const PAGE_URL = 'https://www.mboamersfoort.nl/actueel/nieuws/';
  const BASE_URL  = 'https://www.mboamersfoort.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'MBO Amersfoort',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/actueel/']);

    for (const [url, title] of links) {
      if (url === PAGE_URL || url.endsWith('/actueel/') || url.endsWith('/nieuws/')) continue;
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('MBO Amersfoort fout:', e.message); errors++; }
  logResult('MBO Amersfoort', saved, skipped, errors);
}

// ─── CliniClowns ──────────────────────────────────────────────────────────
// Gevestigd in Amersfoort. Ziekenhuisclowns.
async function scrapeCliniClowns() {
  const PAGE_URL = 'https://www.cliniclowns.nl/nieuws/';
  const BASE_URL  = 'https://www.cliniclowns.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'CliniClowns',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/artikel/', '/bericht/']);

    for (const [url, title] of links) {
      if (url === PAGE_URL) continue;
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('CliniClowns fout:', e.message); errors++; }
  logResult('CliniClowns', saved, skipped, errors);
}

// ─── Museum Flehite ────────────────────────────────────────────────────────
// Lokaalhistorisch museum Amersfoort. Nieuwsoverzicht: /menu-thematisch/te-zien-en-te-doen/nieuws-en-agenda/
// Site gebruikt relatieve URLs zonder leading slash.
async function scrapeFlehite() {
  const PAGE_URL = 'https://museumflehite.nl/menu-thematisch/te-zien-en-te-doen/nieuws-en-agenda/';
  const BASE_URL  = 'https://museumflehite.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Museum Flehite',
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
      if (!href.includes('nieuws/') && !href.includes('agenda/')) return;
      // Relatieve URLs kunnen zonder leading slash zijn
      const url = href.startsWith('http') ? href : (href.startsWith('/') ? `${BASE_URL}${href}` : `${BASE_URL}/${href}`);
      if (links.has(url)) return;
      // Haal de beste titel op: omliggende h2/h3 of tekst van link (skip 'Lees meer')
      const linkText = $(el).text().trim();
      const contextTitle = $(el).closest('article,.card,.item,section').find('h2,h3,h4').first().text().trim();
      const title = (contextTitle || (linkText !== 'Lees meer' ? linkText : '') || url.split('/').filter(Boolean).pop()?.replace(/[-_.]/g, ' ') || '').replace(/\s+/g, ' ').trim();
      if (title) links.set(url, title);
    });

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Museum Flehite fout:', e.message); errors++; }
  logResult('Museum Flehite', saved, skipped, errors);
}

// ─── Hogeschool Utrecht ───────────────────────────────────────────────────
// Campus in Utrecht, veel studenten en locaties in Amersfoort-regio.
// Filter op 'amersfoort' in tekst.
async function scrapeHU() {
  const PAGE_URL = 'https://www.hu.nl/nieuws';
  const BASE_URL  = 'https://www.hu.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Hogeschool Utrecht',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/pers/']);

    for (const [url, title] of links) {
      if (url === PAGE_URL || url.endsWith('/nieuws') || url.endsWith('/nieuws/')) continue;
      // Filter op Amersfoort in titel
      if (!title.toLowerCase().includes('amersfoort')) { skipped++; continue; }
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('HU fout:', e.message); errors++; }
  logResult('Hogeschool Utrecht', saved, skipped, errors);
}

// ─── Musiom — UITGESCHAKELD ───────────────────────────────────────────────
// musiom.nl onbereikbaar (connection error). Muziekschool Amersfoort.
// TODO: controleer periodiek of domein hersteld is.

// ─── Cavaleriemuseum — UITGESCHAKELD ─────────────────────────────────────
// cavaleriemuseum.nl onbereikbaar (connection error).
// TODO: controleer periodiek.

// ─── Rietveldpaviljoen — UITGESCHAKELD ───────────────────────────────────
// rietveldpaviljoen.nl onbereikbaar (connection error).
// TODO: controleer periodiek.

async function scrape() {
  await scrapeDiabetesfonds();
  await scrapeMboAmersfoort();
  await scrapeCliniClowns();
  await scrapeFlehite();
  await scrapeHU();
}

scrape().catch(console.error);
