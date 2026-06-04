// ProRail — nieuws gefilterd op Amersfoort
// HTML-scraping van de nieuwspagina.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.prorail.nl/nieuws';
const BASE_URL = 'https://www.prorail.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'ProRail nieuws',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'data',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  let saved = 0, skipped = 0, errors = 0;
  const items = [];

  $('a[href*="/nieuws/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.match(/\/nieuws\/[a-z]/)) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).text().trim() ||
                  href.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '';
    if (url && title && title.length > 5 && !items.find(i => i.url === url)) {
      const parent = $(el).closest('article, .card, li, div');
      const summary = parent.find('p').first().text().trim() || '';
      items.push({ url, title, summary });
    }
  });

  for (const { url, title, summary } of items) {
    // Filter: alleen items die Amersfoort vermelden
    const text = `${title} ${summary}`.toLowerCase();
    if (!text.includes('amersfoort')) { skipped++; continue; }

    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content: summary,
        summary,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${title}":`, err.message);
    }
  }

  logResult('ProRail nieuws', saved, skipped, errors);
}

scrape().catch(console.error);
