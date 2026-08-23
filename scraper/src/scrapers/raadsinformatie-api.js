// raadsinformatie-api.js — Amersfoort raadsinformatie per documenttype via Notubiz
//
// Herschreven 2026-08-23: twee fixes voor de 0-items sinds juli.
//
// 1. Cloudflare Turnstile blokkeert headless browsers op amersfoort.notubiz.nl.
//    Oplossing: headless: false (zichtbare browser). Vereist dat Jasper is
//    ingelogd op Windows. PM2 draait de job 1x per dag; het Chromium-venster
//    opent en sluit automatisch.
//
// 2. De modulepagina filtert standaard op de huidige maand. In maanden zonder
//    activiteit (zomerreces) levert dat 0 resultaten. Oplossing: ?month=all
//    in de URL, zodat alle items van het lopende jaar zichtbaar zijn.
//
// De ORI-scraper (raadsinformatie-ori.js in run-all.js) blijft als complementaire
// bron draaien — die levert documenttekst, deze levert titels en detectie.
// Deduplicatie loopt via insertItem (titel + source_id).
//
// Module-IDs (gevonden 2026-06-04, bevestigd 2026-08-23):
//   1 = ingekomen_stukken     4 = schriftelijke_vragen
//   5 = raadsinformatiebrieven   6 = moties_en_toezeggingen

import { withBrowser } from '../browser.js';
import { createDb, ensureSource, insertItem, log, makeSummary } from '../lib.js';

const db = createDb();
const BASE = 'https://amersfoort.notubiz.nl';

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
  // month=all toont alle items van het jaar, niet alleen de huidige maand.
  // Zonder dit filter levert de pagina 0 resultaten in maanden zonder activiteit.
  const pageUrl = `${BASE}/modules/${mod.moduleId}/${mod.slug}/view?month=all`;

  try {
    const items = await withBrowser(async (page) => {
      // Notubiz zit achter Cloudflare Turnstile. De challenge wordt automatisch
      // opgelost in een zichtbare browser (headless: false). Wacht tot de
      // challenge klaar is door te kijken of de echte pagina-inhoud verschijnt.
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });

      // Wacht tot Cloudflare-challenge is afgerond: óf de tabel verschijnt,
      // óf de pagina-body bevat 'overview_list' (teken dat de SPA geladen is).
      // Maximaal 30 seconden voor de challenge + SPA-render.
      try {
        await page.waitForSelector('table.overview_list', { timeout: 30000 });
      } catch {
        // Mogelijk geen tabel (lege maand) of challenge mislukt — doorgaan
        // en kijken wat er is.
      }

      // Extra wacht voor AJAX-data die na pageload wordt opgehaald
      await page.waitForTimeout(2000);

      // Wacht op daadwerkelijke rijen als de tabel er is
      try {
        await page.waitForSelector('table.overview_list tbody tr td', { timeout: 10000 });
      } catch {
        // Geen rijen — kan legitiem leeg zijn
      }

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

            // Probeer ook de omschrijving/samenvatting uit de rij te halen
            const cells = Array.from(row.querySelectorAll('td'));
            const descParts = cells.map(c => c.textContent?.trim()).filter(Boolean);
            const description = descParts.join(' — ').substring(0, 500);

            results.push({
              title: title.substring(0, 300),
              url: href,
              date: dateMatch?.[1] || '',
              description,
            });
          }
          return results;
        },
      );
    }, {
      timeout: 120000,    // 2 min browser-timeout (Cloudflare + SPA-laden)
      headless: false,     // Nodig tegen Cloudflare Turnstile
    });

    const stats = { new: 0, skipped: 0, errors: 0 };
    for (const item of items || []) {
      try {
        const content = item.description || mod.name;
        const saved = await insertItem(db, {
          source_id: sourceId,
          title: item.title.substring(0, 500),
          content: content.substring(0, 25000),
          summary: makeSummary(content) || '',
          external_url: item.url,
          scraped_at: item.date
            ? new Date(item.date.split('-').reverse().join('-')).toISOString()
            : new Date().toISOString(),
          published_at: item.date
            ? item.date.split('-').reverse().join('-')
            : null,
        });
        if (saved === true) stats.new++;
        else if (saved === false) stats.skipped++;
        else stats.errors++;
      } catch (err) {
        stats.errors++;
      }
    }

    await log(db, sourceId, mod.name, stats);
    return stats;
  } catch (err) {
    console.error(`[RAAD-API] Browser-fout bij ${mod.key}: ${err.message.substring(0, 120)}`);
    await log(db, sourceId, mod.name, { new: 0, skipped: 0, errors: 1 });
    return { new: 0, skipped: 0, errors: 1 };
  }
}

async function scrape() {
  console.log(`\n[RAAD-API] gestart: ${new Date().toISOString()}`);
  const sourceMap = await registerSources();
  for (const mod of MODULES) {
    await scrapeModule(mod, sourceMap[mod.key]);
    // Pauze tussen modules — niet te snel achter elkaar naar Notubiz
    await new Promise(r => setTimeout(r, 3000));
  }
}

scrape().catch(console.error);
