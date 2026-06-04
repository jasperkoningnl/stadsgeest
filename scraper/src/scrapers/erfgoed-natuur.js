// erfgoed-natuur.js — Erfgoed en natuur: Staatsbosbeheer, Restauratiefonds, Eigen Huis
// Staatsbosbeheer en Eigen Huis zijn nationaal; filter op 'amersfoort' in tekst.
// Restauratiefonds is gevestigd in Amersfoort: geen filter.

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

// Generieke nieuwslink-extractor: zoekt <a> tags met nieuwsachtige paden
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

// ─── Staatsbosbeheer ──────────────────────────────────────────────────────
// Beheert natuur rondom Amersfoort (Utrechtse Heuvelrug, Soestduinen, Birkhoven).
// Filter: alleen berichten met 'amersfoort' in titel of content snippet.
async function scrapeStaatsbosbeheer() {
  const PAGE_URL = 'https://www.staatsbosbeheer.nl/wat-we-doen/nieuws';
  const BASE_URL  = 'https://www.staatsbosbeheer.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Staatsbosbeheer',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/actueel/', '/bericht/']);

    for (const [url, title] of links) {
      // Filter: sla alleen berichten op die Amersfoort noemen
      const text = `${title}`.toLowerCase();
      if (!text.includes('amersfoort')) { skipped++; continue; }
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
    // Geen Amersfoort-hits op deze run? Sla dan de paginatitel met datum op als signaal.
    // (geen actie — het is normaal dat nationale bronnen soms niks opleveren)
  } catch (e) { console.error('Staatsbosbeheer fout:', e.message); errors++; }
  logResult('Staatsbosbeheer', saved, skipped, errors);
}

// ─── Restauratiefonds ─────────────────────────────────────────────────────
// Gevestigd in Amersfoort. Financeert restauratie van rijksmonumenten.
async function scrapeRestauratiefonds() {
  const PAGE_URL = 'https://www.restauratiefonds.nl/nieuws-en-evenementen/';
  const BASE_URL  = 'https://www.restauratiefonds.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Restauratiefonds',
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
    const links = extractLinks($, BASE_URL, ['/nieuws', '/evenement', '/bericht', '/artikel']);

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Restauratiefonds fout:', e.message); errors++; }
  logResult('Restauratiefonds', saved, skipped, errors);
}

// ─── Vereniging Eigen Huis ────────────────────────────────────────────────
// Gevestigd in Amersfoort. Consumentenorganisatie voor woningeigenaren.
async function scrapeEigenHuis() {
  const PAGE_URL = 'https://www.eigenhuis.nl/nieuws';
  const BASE_URL  = 'https://www.eigenhuis.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Vereniging Eigen Huis',
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
    const links = extractLinks($, BASE_URL, ['/nieuws/', '/persberichten/', '/artikel/']);

    for (const [url, title] of links) {
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Eigen Huis fout:', e.message); errors++; }
  logResult('Vereniging Eigen Huis', saved, skipped, errors);
}

// ─── Rijksdienst voor het Cultureel Erfgoed ───────────────────────────────
// Nationale overheidsinstelling; filter op Amersfoort. Next.js-site, geen RSS.
async function scrapeRCE() {
  const PAGE_URL = 'https://www.cultureelerfgoed.nl/actueel/nieuws';
  const BASE_URL  = 'https://www.cultureelerfgoed.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Rijksdienst voor het Cultureel Erfgoed',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;
  try {
    const html = await fetchHtml(PAGE_URL);
    const $ = cheerio.load(html);
    const links = extractLinks($, BASE_URL, ['/actueel/nieuws/', '/nieuws/']);

    for (const [url, title] of links) {
      if (!title.toLowerCase().includes('amersfoort')) { skipped++; continue; }
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('RCE fout:', e.message); errors++; }
  logResult('RCE', saved, skipped, errors);
}

// ─── Ministerie van Defensie ──────────────────────────────────────────────
// Garnizoen Amersfoort (Bernhardkazerne). Next.js-site, geen RSS. Filter op Amersfoort.
async function scrapeDefensie() {
  const PAGE_URL = 'https://www.defensie.nl/actueel/nieuws';
  const BASE_URL  = 'https://www.defensie.nl';

  const sourceId = await getOrCreateSource(db, {
    name: 'Ministerie van Defensie',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;
  try {
    const html = await fetchHtml(PAGE_URL);
    const $ = cheerio.load(html);
    const links = extractLinks($, BASE_URL, ['/actueel/nieuws/', '/nieuws/']);

    for (const [url, title] of links) {
      if (!title.toLowerCase().includes('amersfoort')) { skipped++; continue; }
      try {
        const r = await saveRawItem(db, { sourceId, externalUrl: url, title, content: '', summary: '' });
        if (r.saved) saved++; else skipped++;
      } catch (e) { errors++; }
    }
  } catch (e) { console.error('Defensie fout:', e.message); errors++; }
  logResult('Defensie', saved, skipped, errors);
}

async function scrape() {
  await scrapeStaatsbosbeheer();
  await scrapeRestauratiefonds();
  await scrapeEigenHuis();
  await scrapeRCE();
  await scrapeDefensie();
}

scrape().catch(console.error);
