import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const PAGE_URL = 'https://www.vallei-veluwe.nl/actueel/nieuws/?woonplaats=Amersfoort';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Waterschap Vallei en Veluwe',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Links naar nieuwsartikelen; minimaal 10 tekens om navigatielinks te filteren
  const seen = new Set();
  const items = [];
  $('a[href*="/actueel/nieuws/"]').each(function () {
    const title = $(this).text().trim();
    const link = $(this).attr('href');
    if (!title || !link || title.length < 10) return;
    const fullUrl = link.startsWith('http') ? link : `https://www.vallei-veluwe.nl${link}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    items.push({ title, link: fullUrl });
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

  logResult('Waterschap Vallei en Veluwe', saved, skipped, errors);
}

scrape().catch(console.error);
