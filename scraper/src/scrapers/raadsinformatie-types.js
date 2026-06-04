// raadsinformatie-types.js — Amersfoort raadsinformatie opsplitst per documenttype
//
// Context 2026-06-04:
//   - Open Raadsinformatie API (api.openraadsinformatie.nl): volledig offline, alle endpoints 404
//   - Notubiz atom/RSS feeds: geblokkeerd door Cloudflare (403)
//   - api.notubiz.nl: 404
//
// Aanpak: verbeterde browser-scraper die items classificeert op basis van
// titel-patronen en URL-fragmenten. Elk type krijgt een eigen source_id.
//
// Subtypen:
//   raad-schriftelijke-vragen  — schriftelijke vragen van fracties
//   raad-moties                — moties
//   raad-amendementen          — amendementen
//   raad-informatiebrieven     — raadsinformatiebrieven (RIB)
//   raad-ingekomen-stukken     — ingekomen stukken
//   raad-vergaderingen         — vergaderingen en overige documenten (catch-all)

import { withBrowser } from '../browser.js';
import { createDb, ensureSource, insertItem, log } from '../lib.js';

const db = createDb();
const BASE_URL = 'https://amersfoort.raadsinformatie.nl';

// Type-definities met patronen voor automatische classificatie
const TYPES = [
  {
    key: 'raad-schriftelijke-vragen',
    name: 'Raad Amersfoort — Schriftelijke vragen',
    tier: 1,
    frequency: 'daily',
    patterns: ['schriftelijke vraag', 'schriftelijke vragen'],
  },
  {
    key: 'raad-moties',
    name: 'Raad Amersfoort — Moties',
    tier: 1,
    frequency: 'daily',
    patterns: ['motie ', 'moties ', ' motie', 'gewijzigde motie'],
  },
  {
    key: 'raad-amendementen',
    name: 'Raad Amersfoort — Amendementen',
    tier: 1,
    frequency: 'daily',
    patterns: ['amendement'],
  },
  {
    key: 'raad-informatiebrieven',
    name: 'Raad Amersfoort — Raadsinformatiebrieven',
    tier: 1,
    frequency: 'daily',
    patterns: ['raadsinformatiebrief', 'informatiebrief', ' rib ', '(rib)', 'rib nr'],
  },
  {
    key: 'raad-ingekomen-stukken',
    name: 'Raad Amersfoort — Ingekomen stukken',
    tier: 1,
    frequency: 'weekly',
    patterns: ['ingekomen stuk', 'ingekomen brief', 'lijst ingekomen'],
  },
];

// Catch-all voor vergaderingen, agenda-items en niet-geclassificeerde documenten
const CATCH_ALL = {
  key: 'raad-vergaderingen',
  name: 'Raad Amersfoort — Vergaderingen en overig',
  tier: 1,
  frequency: 'daily',
};

// Detecteer subtype op basis van titel-patronen
function detectType(title) {
  const t = (title || '').toLowerCase();
  for (const type of TYPES) {
    if (type.patterns.some(p => t.includes(p))) return type.key;
  }
  return CATCH_ALL.key;
}

// Zorg dat alle bronnen bestaan in de DB, retourneer map key→sourceId
async function registerSources() {
  const map = {};
  for (const t of [...TYPES, CATCH_ALL]) {
    map[t.key] = await ensureSource(db, {
      name: t.name,
      url: `${BASE_URL}/#/${t.key}`,
      source_type: 'scrape',
      reliability: 'primary',
      category: 'government',
      scrape_frequency: t.frequency,
      tier: t.tier,
    });
  }
  return map;
}

// Scrape de hoofdpagina van raadsinformatie
async function scrapeItems() {
  let items = [];
  try {
    items = await withBrowser(async (page) => {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });

      await Promise.race([
        page.waitForSelector('a[href*="/vergadering/"]', { timeout: 20000 }),
        page.waitForSelector('a[href*="/document/"]', { timeout: 20000 }),
        page.waitForSelector('[class*="meeting"]', { timeout: 20000 }),
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
              const card = el.closest(
                '[class*="meeting"], [class*="event"], [class*="item"], article, li'
              ) || el;
              const heading = card.querySelector('h1,h2,h3,h4,h5,[class*="title"]');
              const title = (heading?.textContent || el.textContent || '').trim();
              const descEl = card.querySelector(
                '[class*="desc"], [class*="summary"], [class*="intro"], p'
              );
              const description = (descEl?.textContent || '').trim();
              return { url: el.href, title, description };
            })
            .filter(i => i.title && i.title.length > 2);
        }
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`[RAAD-TYPES] Browser-fout: ${err.message}`);
  }
  return items;
}

async function scrape() {
  console.log(`\n[RAAD-TYPES] gestart: ${new Date().toISOString()}`);

  const sourceMap = await registerSources();
  const items = await scrapeItems();

  console.log(`[RAAD-TYPES] ${items.length} items gevonden op hoofdpagina`);

  // Per-type statistieken
  const stats = {};
  for (const key of Object.keys(sourceMap)) {
    stats[key] = { new: 0, skipped: 0, errors: 0 };
  }

  for (const item of items) {
    const typeKey = detectType(item.title);
    const sourceId = sourceMap[typeKey];

    try {
      const content = [item.description].filter(Boolean).join('\n').substring(0, 5000);
      const saved = await insertItem(db, {
        source_id: sourceId,
        title: item.title,
        content,
        summary: item.description?.substring(0, 300) || '',
        external_url: item.url,
        scraped_at: new Date().toISOString(),
      });
      if (saved === true) stats[typeKey].new++;
      else if (saved === false) stats[typeKey].skipped++;
      else stats[typeKey].errors++;
    } catch (err) {
      stats[typeKey].errors++;
      console.error(`[RAAD-TYPES] Fout bij "${item.title}": ${err.message}`);
    }
  }

  // Log per type
  for (const t of [...TYPES, CATCH_ALL]) {
    log(t.name, stats[t.key]);
  }
}

scrape().catch(console.error);
