// Archief Eemland — nieuws en publicaties
// HTML-scraping met cheerio.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.archiefeemland.nl/over-ons/nieuws';
const BASE_URL = 'https://www.archiefeemland.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Archief Eemland',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'registry',
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

  // Article cards: article.gallery-view
  $('article').each((_, el) => {
    const link = $(el).find('a[href*="/over-ons/nieuws/"], a[itemprop="url"]').first();
    const href = link.attr('href') || '';
    if (!href) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).find('h2, h3, [itemprop="name"]').first().text().trim() ||
                  link.text().trim() || '';
    const summary = $(el).find('p, [itemprop="description"]').first().text().trim() || '';
    if (url && title && !items.find(i => i.url === url)) {
      items.push({ url, title, summary });
    }
  });

  for (const { url, title, summary } of items) {
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

  logResult('Archief Eemland', saved, skipped, errors);
}

scrape().catch(console.error);
