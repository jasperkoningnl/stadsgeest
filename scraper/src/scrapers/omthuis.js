// omthuis.js — Omthuis woningcorporatie nieuwsberichten
// Bron: https://www.omthuis.nl/nieuwsberichten/ (TYPO3 + Zig CMS, client-rendered)
import { chromium } from 'playwright';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.omthuis.nl/nieuwsberichten/';
const BASE_URL = 'https://www.omthuis.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Omthuis — nieuwsberichten',
    url: SOURCE_URL,
    sourceType: 'browser',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'weekly',
  });

  let browser;
  let saved = 0, skipped = 0, errors = 0;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wacht tot Zig web components gehydrateerd zijn
    await page.waitForTimeout(4000);

    const items = await page.evaluate((base) => {
      const found = new Map();

      // Zig Design System: zds-card en zds-link componenten
      // Zoek alle <a> tags die verwijzen naar nieuwsberichten
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (!href.includes('omthuis.nl')) return;
        if (!href.includes('nieuws') && !href.includes('bericht') && !href.includes('update')) return;
        if (href === base + '/nieuwsberichten' || href === base + '/nieuwsberichten/') return;
        if (found.has(href)) return;

        // Probeer titel te vinden: loop omhoog naar parent card/container
        let el = a;
        let title = '';
        for (let i = 0; i < 6 && !title; i++) {
          const h = el.querySelector && el.querySelector('h1,h2,h3,h4,[class*="title"],[class*="heading"]');
          if (h) { title = h.textContent.trim(); break; }
          el = el.parentElement;
        }
        if (!title) title = a.textContent.trim();
        if (!title) title = a.getAttribute('aria-label') || '';
        if (title.length > 5) found.set(href, { url: href, title });
      });

      return Array.from(found.values());
    }, BASE_URL);

    for (const item of items) {
      if (!item.title || item.title.length < 5) continue;
      try {
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: item.url,
          title: item.title,
          content: item.title,
          summary: 'Omthuis nieuwsbericht',
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error('Fout bij Omthuis item:', err.message);
      }
    }
  } catch (err) {
    console.error('Omthuis fout:', err.message);
    errors++;
  } finally {
    if (browser) await browser.close();
  }

  logResult('Omthuis', saved, skipped, errors);
}

scrape().catch(console.error);
