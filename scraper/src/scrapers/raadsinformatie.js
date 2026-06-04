// raadsinformatie.js — Amersfoort raadsinformatie (Notubiz)
// Vue SPA op https://amersfoort.raadsinformatie.nl/
// Scrapet recente vergaderingen en agenda-items, inclusief beschrijvingen.

import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://amersfoort.raadsinformatie.nl/';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Raadsinformatie gemeente Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'daily',
  });

  let items = [];
  try {
    items = await withBrowser(async (page) => {
      await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 45000 });

      await Promise.race([
        page.waitForSelector('a[href*="/vergadering/"]', { timeout: 20000 }),
        page.waitForSelector('[class*="meeting"]', { timeout: 20000 }),
        page.waitForSelector('[class*="event"]', { timeout: 20000 }),
        page.waitForSelector('.o-meeting-preview', { timeout: 20000 }),
      ]).catch(() => {});

      return await page.$$eval(
        'a[href*="/vergadering/"], a[href*="/document/"], a[href*="/agendapunt/"]',
        (els) => {
          const seen = new Set();
          return els
            .filter(el => {
              const href = el.href || '';
              if (!href || seen.has(href)) return false;
              seen.add(href);
              return true;
            })
            .map(el => {
              const card = el.closest('[class*="meeting"], [class*="event"], [class*="item"], article, li') || el;
              const heading = card.querySelector('h1,h2,h3,h4,h5,[class*="title"]');
              const title = (heading?.textContent || el.textContent || '').trim();

              // Beschrijving: zoek in de kaart naar een korte tekst
              const descEl = card.querySelector('[class*="desc"], [class*="summary"], [class*="intro"], p');
              const description = (descEl?.textContent || '').trim();

              // Bijlage-links
              const attachments = Array.from(card.querySelectorAll('a[href*="/document/"]'))
                .map(a => a.href)
                .filter(h => h !== el.href);

              return { url: el.href, title, description, attachments };
            })
            .filter(i => i.title && i.title.length > 2);
        },
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`Browser-fout Raadsinformatie: ${err.message}`);
  }

  let saved = 0, skipped = 0, errors = 0;
  for (const item of items) {
    try {
      const parts = [];
      if (item.description) parts.push(item.description);
      if (item.attachments?.length) {
        parts.push('Bijlagen: ' + item.attachments.join(', '));
      }
      const content = parts.join('\n\n').substring(0, 5000);

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content,
        summary: item.description ? item.description.substring(0, 300) : '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult('Raadsinformatie gemeente Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
