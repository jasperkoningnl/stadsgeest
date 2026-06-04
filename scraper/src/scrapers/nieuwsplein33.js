// nieuwsplein33.js — Nieuwsplein33 nieuws Amersfoort
// Client-rendered (React). Scrapet https://www.nieuwsplein33.nl/amersfoort
// voor lokale nieuwsartikelen.

import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.nieuwsplein33.nl/amersfoort';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Nieuwsplein33 Amersfoort',
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

      // Wacht tot artikelen laden (meerdere mogelijke selectors)
      await Promise.race([
        page.waitForSelector('article a', { timeout: 15000 }),
        page.waitForSelector('.item a', { timeout: 15000 }),
        page.waitForSelector('h2 a', { timeout: 15000 }),
        page.waitForSelector('[class*="article"] a', { timeout: 15000 }),
      ]).catch(() => {});

      return await page.$$eval(
        'article a[href], .item a[href], .card a[href], [class*="news"] a[href]',
        (els) => {
          const seen = new Set();
          return els
            .filter(el => {
              const href = el.href || '';
              const text = el.textContent?.trim() || '';
              if (!href || !text || text.length < 5) return false;
              if (seen.has(href)) return false;
              seen.add(href);
              return true;
            })
            .map(el => ({
              url: el.href,
              title: el.textContent.trim(),
            }));
        },
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`Browser-fout Nieuwsplein33: ${err.message}`);
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

  logResult('Nieuwsplein33 Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
