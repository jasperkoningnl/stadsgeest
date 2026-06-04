// Omgevingsdienst regio Utrecht (ODU) — nieuws
// HTML-scraping met cheerio.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.odu.nl/nieuws/';
const BASE_URL = 'https://www.odu.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Omgevingsdienst regio Utrecht',
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

  // Artikelkaarten: article.card of .card met h3>a links
  $('article, .card').each((_, el) => {
    const link = $(el).find('a[href*="/nieuws/"]').first();
    const href = link.attr('href') || '';
    if (!href) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).find('h2, h3, h4').first().text().trim() ||
                  link.text().trim() ||
                  href.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '';
    const summary = $(el).find('p').first().text().trim() || '';
    if (url && title && !items.find(i => i.url === url)) {
      items.push({ url, title, summary });
    }
  });

  // Fallback: directe h3>a of h2>a links in nieuwssectie
  if (items.length === 0) {
    $('h2 > a[href*="/nieuws/"], h3 > a[href*="/nieuws/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
      const title = $(el).text().trim();
      if (url && title && !items.find(i => i.url === url)) {
        items.push({ url, title, summary: '' });
      }
    });
  }

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

  logResult('Omgevingsdienst regio Utrecht', saved, skipped, errors);
}

scrape().catch(console.error);
