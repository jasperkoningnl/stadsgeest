// rtvutrecht.js — RTV Utrecht nieuws over Amersfoort
// Scrapet /tag/amersfoort — gefilterde tagpagina met directe Amersfoort-artikelen.
// Let op: /nieuws/ gaf 404; /tag/amersfoort werkt wel.

import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.rtvutrecht.nl/tag/amersfoort';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'RTV Utrecht — Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'daily',
  });

  let items = [];
  try {
    items = await withBrowser(async (page) => {
      await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForSelector('a[href*="/nieuws/"]', { timeout: 15000 }).catch(() => {});

      return await page.$$eval(
        'a[href*="/nieuws/"]',
        (els) => {
          const seen = new Set();
          const results = [];
          for (const el of els) {
            const url = el.href;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            const title = (el.textContent || '').trim();
            if (!title || title.length < 5) continue;

            // Zoek lead-tekst in het omringende artikel-kaart-element
            const card = el.closest('article, [class*="card"], [class*="item"], li') || el.parentElement;
            const leadEl = card?.querySelector('p, [class*="lead"], [class*="intro"], [class*="desc"], [class*="summary"]');
            const lead = (leadEl?.textContent || '').trim();

            results.push({ url, title, lead });
          }
          return results;
        },
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`Browser-fout RTV Utrecht: ${err.message}`);
  }

  let saved = 0, skipped = 0, errors = 0;
  for (const item of items) {
    try {
      const content = item.lead || '';
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content,
        summary: content.substring(0, 300),
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult('RTV Utrecht — Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
