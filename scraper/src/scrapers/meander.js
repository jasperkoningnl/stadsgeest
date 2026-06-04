// meander.js — Meander Medisch Centrum nieuws
// https://www.meandermc.nl/over-meander/nieuws
// IBM WCM CMS: nieuwskaarten zijn zelf <a class="card" href="?urile=wcm:path%3A...">
// De .card IS de anker — dus selector is a.card[href], niet .card a[href].

import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.meandermc.nl/over-meander/nieuws';
const BASE_URL = 'https://www.meandermc.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Meander Medisch Centrum nieuws',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'community',
    scrapeFrequency: 'weekly',
  });

  let items = [];
  try {
    items = await withBrowser(async (page) => {
      await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 45000 });

      // De nieuwskaarten zijn zelf <a class="card">
      await page.waitForSelector('a.card[href]', { timeout: 15000 }).catch(() => {});

      return await page.$$eval(
        'a.card[href]',
        (els, baseUrl) => {
          const seen = new Set();
          const results = [];
          for (const el of els) {
            const href = el.href || '';
            if (!href || seen.has(href)) continue;
            // Filter navigatie- en anchor-links
            if (href.includes('#') && !href.includes('urile')) continue;
            seen.add(href);

            const heading = el.querySelector('[class*="card-title"], [class*="title"], h1, h2, h3, h4, [class*="card-body"]');
            const title = (heading?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ');
            if (!title || title.length < 5) continue;

            // href is relatief (?urile=...) — maak absoluut
            const url = href.startsWith('http') ? href : `${baseUrl}/over-meander/nieuws/${href}`;
            results.push({ url, title });
          }
          return results;
        },
        BASE_URL,
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`Browser-fout Meander: ${err.message}`);
  }

  let saved = 0, skipped = 0, errors = 0;
  for (const item of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content: '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult('Meander Medisch Centrum nieuws', saved, skipped, errors);
}

scrape().catch(console.error);
