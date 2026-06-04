// raadsinformatie-api.js — Amersfoort raadsinformatie per documenttype via Notubiz
//
// Aanpak (2026-06-04):
//   - amersfoort.notubiz.nl/modules/{id}/{slug}/view via Playwright + networkidle
//   - Items worden geladen via get_data_for_overview_js (zelfde patroon als bw-besluiten.js)
//   - Extractie uit table.overview_list tbody tr
//
// Module-IDs (gevonden 2026-06-04):
//   1 = ingekomen_stukken     4 = schriftelijke_vragen
//   5 = raadsinformatiebrieven   6 = moties_en_toezeggingen

import { withBrowser } from '../browser.js';
import { createDb, ensureSource, insertItem, log } from '../lib.js';

const db = createDb();
const BASE = 'https://amersfoort.notubiz.nl';
const UA_NOTUBIZ = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MODULES = [
  {
    key: 'raad-schriftelijke-vragen',
    name: 'Raad Amersfoort — Schriftelijke vragen',
    tier: 1,
    frequency: 'daily',
    moduleId: 4,
    slug: 'schriftelijke_vragen',
  },
  {
    key: 'raad-moties',
    name: 'Raad Amersfoort — Moties',
    tier: 1,
    frequency: 'daily',
    moduleId: 6,
    slug: 'moties_en_toezeggingen',
  },
  {
    key: 'raad-informatiebrieven',
    name: 'Raad Amersfoort — Raadsinformatiebrieven',
    tier: 1,
    frequency: 'daily',
    moduleId: 5,
    slug: 'raadsinformatiebrieven',
  },
  {
    key: 'raad-ingekomen-stukken',
    name: 'Raad Amersfoort — Ingekomen stukken',
    tier: 1,
    frequency: 'weekly',
    moduleId: 1,
    slug: 'ingekomen_stukken',
  },
];

async function registerSources() {
  const map = {};
  for (const m of MODULES) {
    map[m.key] = await ensureSource(db, {
      name: m.name,
      url: `${BASE}/modules/${m.moduleId}/${m.slug}/view`,
      source_type: 'browser',
      reliability: 'primary',
      category: 'government',
      scrape_frequency: m.frequency,
      tier: m.tier,
    });
  }
  return map;
}

async function scrapeModule(mod, sourceId) {
  const pageUrl = `${BASE}/modules/${mod.moduleId}/${mod.slug}/view`;

  try {
    const items = await withBrowser(async (page) => {
      // De overview-data wordt via get_data_for_overview_js lazily geladen na pageload.
      // Aanpak: lees ALLE response-bodies (zoals de table-test die werkte), waardoor
      // Playwright de pagina langer "actief" houdt en networkidle langer duurt.
      page.on('response', async (resp) => {
        try { await resp.text(); } catch { /* ignore */ }
      });

      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 50000 })
        .catch(() => {}); // timeout normaal — doorgaan

      // Wacht tot de tabel daadwerkelijk gevuld is
      await page.waitForSelector('table.overview_list tbody tr td', { timeout: 20000 })
        .catch(() => {});

      await page.waitForTimeout(500);

      return await page.$$eval(
        'table.overview_list tbody tr',
        (rows) => {
          const results = [];
          const seen = new Set();
          for (const row of rows) {
            // Document-link heeft de beste titel als linktekst
            const docLink = row.querySelector('a[href*="/document/"]');
            const viewLink = row.querySelector('a[href*="/modules/"]');
            const link = docLink || viewLink;
            if (!link) continue;
            const href = link.href;
            if (!href || seen.has(href)) continue;
            seen.add(href);
            const title = (docLink?.textContent?.trim() ||
                          row.textContent?.replace(/\s+/g,' ').trim().substring(0,120) || '');
            if (!title || title.length < 3) continue;
            const dateMatch = row.textContent.match(/(\d{2}-\d{2}-\d{4})/);
            results.push({ title: title.substring(0,300), url: href, date: dateMatch?.[1] || '' });
          }
          return results;
        },
      );
    }, { timeout: 90000 }); // 90s browser-timeout (network-idle kan lang duren)

    const stats = { new: 0, skipped: 0, errors: 0 };
    for (const item of items || []) {
      try {
        const saved = await insertItem(db, {
          source_id: sourceId,
          title: item.title.substring(0, 500),
          content: mod.name,
          summary: '',
          external_url: item.url,
          scraped_at: item.date
            ? new Date(item.date.split('-').reverse().join('-')).toISOString()
            : new Date().toISOString(),
        });
        if (saved === true) stats.new++;
        else if (saved === false) stats.skipped++;
        else stats.errors++;
      } catch (err) {
        stats.errors++;
      }
    }

    log(mod.name, stats);
    return stats;
  } catch (err) {
    console.error(`[RAAD-API] Browser-fout bij ${mod.key}: ${err.message.substring(0, 80)}`);
    log(mod.name, { new: 0, skipped: 0, errors: 1 });
    return { new: 0, skipped: 0, errors: 1 };
  }
}

async function scrape() {
  console.log(`\n[RAAD-API] gestart: ${new Date().toISOString()}`);
  const sourceMap = await registerSources();
  for (const mod of MODULES) {
    await scrapeModule(mod, sourceMap[mod.key]);
    await new Promise(r => setTimeout(r, 2000));
  }
}

scrape().catch(console.error);
