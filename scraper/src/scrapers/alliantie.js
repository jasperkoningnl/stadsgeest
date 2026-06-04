// De Alliantie — nieuwsberichten (woningcorporatie actief in Amersfoort)
// HTML-scraping van de nieuwspagina.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.de-alliantie.nl/over-de-alliantie/nieuws-en-publicaties/nieuws/';
const BASE_URL = 'https://www.de-alliantie.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'De Alliantie',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
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

  // Artikellinks: /over-de-alliantie/meer-weten/nieuws/<slug>/
  const seen = new Set();
  $('a[href*="/nieuws/"]').each(async (_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.includes('/meer-weten/nieuws/') && !href.includes('/nieuws-en-publicaties/nieuws/')) return;
    if (seen.has(href)) return;
    seen.add(href);
  });

  // Bouw links samen en sla op
  const links = [];
  $('a[href*="/meer-weten/nieuws/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href === PAGE_URL) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).text().trim() || href.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '';
    if (title && url && !links.find(l => l.url === url)) {
      links.push({ url, title });
    }
  });

  for (const { url, title } of links) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content: '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${title}":`, err.message);
    }
  }

  logResult('De Alliantie', saved, skipped, errors);
}

scrape().catch(console.error);
