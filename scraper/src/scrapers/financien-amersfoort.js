// financien.amersfoort.nl — begrotingsdocumenten en financiële stukken
// Scrapet de pagina op nieuwe PDF-documenten. Jaarlijkse hoofdpublicaties,
// maar ook tussentijdse zomerrapportages en kadernota's.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://financien.amersfoort.nl/';
const BASE_URL = 'https://financien.amersfoort.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Financiën gemeente Amersfoort',
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

  // Verzamel synchronisch, sla op in for-loop
  const items = [];
  $('a[href$=".pdf"], a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/^\//, '')}`;
    const rawTitle = $(el).text().trim() ||
                     href.split('/').pop()?.replace(/[_-]/g, ' ').replace('.pdf', '').replace('.PDF', '') || '';
    const title = rawTitle || 'Financieel document gemeente Amersfoort';
    if (!items.find(i => i.url === url)) {
      items.push({ url, title });
    }
  });

  let saved = 0, skipped = 0, errors = 0;
  for (const { url, title } of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content: `PDF: ${url}`,
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij document "${url}":`, err.message);
    }
  }

  logResult('Financiën gemeente Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
