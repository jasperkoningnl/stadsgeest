import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const PAGE_URL = 'https://amersfoort.nieuws.nl/';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'amersfoort.nieuws.nl',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'daily',
  });

  const response = await fetch(PAGE_URL);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Links naar nieuwsartikelen via de categorie-paden /nieuws/, /gemeente/, /112/
  const seen = new Set();
  const items = [];
  $('a[href*="amersfoort.nieuws.nl/nieuws/"], a[href*="amersfoort.nieuws.nl/gemeente/"], a[href*="amersfoort.nieuws.nl/112/"]').each(function () {
    const title = $(this).text().trim();
    const link = $(this).attr('href');
    if (!title || title.length < 15 || !link) return;
    if (seen.has(link)) return;
    seen.add(link);
    items.push({ title, link });
  });

  let saved = 0, skipped = 0, errors = 0;

  for (const item of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title: item.title,
        content: '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${item.title}":`, err.message);
    }
  }

  logResult('amersfoort.nieuws.nl', saved, skipped, errors);
}

scrape().catch(console.error);
