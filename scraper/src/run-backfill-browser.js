// run-backfill-browser.js — Historische backfill via Playwright
// Bron: Raadsinformatie Amersfoort (Notubiz)
// Eenmalig uitvoeren: node src/run-backfill-browser.js
//
// Vereist: Playwright + @playwright/test geïnstalleerd (npm install playwright)
// Verwacht volume: 200-400 documenten over 12 maanden

import { chromium } from 'playwright';
import { createDb, ensureSource, insertItem, log } from './lib.js';

const db = createDb();

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Voeg is_historical kolom toe als die nog niet bestaat
async function ensureHistoricalColumn() {
  try {
    await db.execute('ALTER TABLE raw_items ADD COLUMN is_historical INTEGER DEFAULT 0');
    console.log('[setup] Kolom is_historical toegevoegd');
  } catch (e) {
    if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
      console.log('[setup] Kolom is_historical bestaat al');
    } else throw e;
  }
}

// ── Raadsinformatie/Notubiz ────────────────────────────────────────────────────
// Notubiz heeft een openbare API én een web-interface.
// We proberen eerst de Notubiz API (als die beschikbaar is), anders scrapen we de HTML.

async function backfillNotubiz() {
  console.log('\n[raadsinformatie] Start backfill Notubiz — 12 maanden');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'raadsinformatie',
    url: 'https://amersfoort.notubiz.nl',
    source_type: 'browser',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'daily',
    tier: 1,
  });

  // Datum 12 maanden geleden
  const vanafDatum = new Date();
  vanafDatum.setFullYear(vanafDatum.getFullYear() - 1);
  const vanafStr = vanafDatum.toISOString().substring(0, 10); // YYYY-MM-DD

  // Probeer eerst Notubiz opendata API
  const apiGeluk = await tryNotubizApi(sid, vanafStr, stats);
  if (apiGeluk) {
    log('raadsinformatie-backfill', stats);
    return stats;
  }

  // Fallback: Playwright browser-scraping
  console.log('  [raadsinformatie] API niet beschikbaar — gebruik Playwright');
  await tryNotubizBrowser(sid, vanafStr, stats);

  log('raadsinformatie-backfill', stats);
  return stats;
}

async function tryNotubizApi(sid, vanafDatum, stats) {
  // Notubiz API (niet altijd publiek beschikbaar)
  const baseUrl = 'https://amersfoort.notubiz.nl';
  const categories = [
    { slug: 'besluitenlijst', label: 'B&W besluitenlijst' },
    { slug: 'raadsinformatiebrief', label: 'Raadsinformatiebrief' },
    { slug: 'schriftelijke-vragen', label: 'Schriftelijke vragen' },
    { slug: 'motie', label: 'Motie' },
    { slug: 'amendement', label: 'Amendement' },
  ];

  for (const cat of categories) {
    try {
      const url = `${baseUrl}/api/v1/publications?type=${cat.slug}&date_from=${vanafDatum}&per_page=100`;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Stadsgeest-Backfill/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return false; // API niet beschikbaar

      const data = await resp.json();
      const items = data?.data ?? data?.publications ?? data?.items ?? [];
      console.log(`  [raadsinformatie] API: ${cat.label} — ${items.length} items`);

      for (const item of items) {
        const title = item.title ?? item.naam ?? item.onderwerp ?? cat.label;
        const url = item.url ?? item.link ?? `${baseUrl}/vergadering/${item.id ?? ''}`;
        const date = (item.date ?? item.datum ?? item.published_at ?? '').substring(0, 10);
        const content = `${cat.label}\n\n${item.description ?? item.omschrijving ?? item.samenvatting ?? ''}`.substring(0, 10000);

        const r = await insertItem(db, {
          source_id: sid,
          title,
          content,
          summary: content.substring(0, 500),
          external_url: url,
          scraped_at: date || new Date().toISOString(),
          is_historical: 1,
        });
        if (r === true) stats.new++;
        else if (r === false) stats.skipped++;
        else stats.errors++;
      }

      await sleep(300);
    } catch (e) {
      console.log(`  [raadsinformatie] API niet beschikbaar: ${e.message.substring(0, 80)}`);
      return false;
    }
  }

  return stats.new > 0 || stats.skipped > 0;
}

async function tryNotubizBrowser(sid, vanafDatum, stats) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: 'Stadsgeest-Backfill/1.0 (lokale nieuwssite Amersfoort)' });
    const page = await ctx.newPage();

    // ── Navigeer naar Notubiz ──
    await page.goto('https://amersfoort.notubiz.nl', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    console.log(`  [raadsinformatie] Pagina geladen: ${page.url()}`);

    // Probeer zoekfunctie of categorie-overzicht
    const categorieUrls = [
      { url: 'https://amersfoort.notubiz.nl/vergadering?type=Besluitenlijst', label: 'B&W besluitenlijst' },
      { url: 'https://amersfoort.notubiz.nl/vergadering?type=Raadsinformatiebrief', label: 'Raadsinformatiebrief' },
      { url: 'https://amersfoort.notubiz.nl/vergadering?type=Schriftelijke+vragen', label: 'Schriftelijke vragen' },
      // Vergaderingen van gemeenteraad en commissies
      { url: 'https://amersfoort.notubiz.nl/vergadering?type=Gemeenteraad', label: 'Gemeenteraad' },
      { url: 'https://amersfoort.notubiz.nl/vergadering?type=Commissie', label: 'Commissies' },
    ];

    for (const cat of categorieUrls) {
      try {
        console.log(`  [raadsinformatie] Scraping: ${cat.label}`);
        await page.goto(cat.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);

        let paginaNr = 0;
        const maxPaginas = 15; // max 15 pagina's per categorie (~300 items)

        while (paginaNr < maxPaginas) {
          // Zoek items op de pagina
          const items = await page.$$eval('article, .meeting-item, .publication-item, li.item, .result-item', els =>
            els.map(el => ({
              title: el.querySelector('h2, h3, .title, [class*="title"]')?.textContent?.trim() ?? '',
              href: el.querySelector('a')?.href ?? '',
              date: el.querySelector('time, .date, [class*="date"]')?.textContent?.trim() ?? '',
              summary: el.querySelector('p, .description, .summary')?.textContent?.trim() ?? '',
            })).filter(i => i.title || i.href)
          );

          console.log(`    Pagina ${paginaNr + 1}: ${items.length} items gevonden`);

          for (const item of items) {
            // Skip als ouder dan vanafDatum
            if (item.date) {
              const dateClean = item.date.replace(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/, '$3-$2-$1');
              if (dateClean < vanafDatum) continue;
            }

            const content = `${cat.label}\n\n${item.summary}`.substring(0, 10000);
            const r = await insertItem(db, {
              source_id: sid,
              title: item.title || cat.label,
              content,
              summary: item.summary.substring(0, 500),
              external_url: item.href,
              scraped_at: item.date || new Date().toISOString(),
              is_historical: 1,
            });
            if (r === true) stats.new++;
            else if (r === false) stats.skipped++;
            else stats.errors++;
          }

          // Volgende pagina
          const nextBtn = await page.$('a[rel="next"], .next, [aria-label="Volgende"], button.next');
          if (!nextBtn) break;
          await nextBtn.click();
          await sleep(2000);
          paginaNr++;
        }

        console.log(`  [raadsinformatie] ${cat.label}: ${stats.new} nieuw, ${stats.skipped} overgeslagen`);
        await sleep(1000);

      } catch (e) {
        console.error(`  [raadsinformatie] Fout bij ${cat.label}: ${e.message.substring(0, 100)}`);
        stats.errors++;
      }
    }

    // ── B&W Besluitenlijsten via directe URL-patronen ──
    // Notubiz publiceert besluitenlijsten op vaste URL's
    console.log('  [raadsinformatie] Probeer B&W-besluitenlijsten via weeklinks...');
    const nu = new Date();
    for (let w = 0; w < 52; w++) {
      const datum = new Date(nu);
      datum.setDate(datum.getDate() - (w * 7));
      const dateStr = datum.toISOString().substring(0, 10);
      if (dateStr < vanafDatum) break;

      // Notubiz gebruikt soms week-gebaseerde URLs
      // Sla een placeholder op voor de intake om later op te halen
      // (de exacte URL-structuur verschilt per installatie)
    }

  } catch (e) {
    console.error(`  [raadsinformatie] Browser fout: ${e.message}`);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }
}

// ── Hoofdprogramma ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Stadsgeest Browser Backfill — Raadsinformatie ===');
  console.log(`Gestart: ${new Date().toISOString()}`);

  await ensureHistoricalColumn();

  const stats = await backfillNotubiz();

  console.log('\n── Verificatie ──');
  try {
    const count = await db.execute(
      "SELECT COUNT(*) as n FROM raw_items r JOIN sources s ON r.source_id = s.id WHERE r.is_historical = 1 AND s.name = 'raadsinformatie'"
    );
    console.log(`Raadsinformatie historische items: ${count.rows[0].n}`);
  } catch (e) {
    console.error(`Verificatie mislukt: ${e.message}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
