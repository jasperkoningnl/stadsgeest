// nextdoor.js — Nextdoor Amersfoort buurtberichten
// Login met 'Claude Stadsgeest' account (koningjasper@proton.me).
// Sessie wordt opgeslagen in scraper/.nextdoor-session.json.
// Scrapet de nieuwsfeed en haalt posts op via scroll.
// Post-ID uit data-attribute als stabiele URL voor deduplicatie.

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '..', '..', '.nextdoor-session.json');

const EMAIL = 'koningjasper@proton.me';
const PASSWORD = process.env.NEXTDOOR_PASSWORD;
const FEED_URL = 'https://nextdoor.nl/news_feed/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function dismissCookieBanner(page) {
  for (const sel of ['#didomi-notice-agree-button', 'button[id*="agree"]', 'button[id*="accept"]']) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click({ force: true, timeout: 2000 }); return; }
    } catch {}
  }
  // JS fallback
  await page.evaluate(() => {
    document.getElementById('didomi-host')?.remove();
    document.querySelector('.didomi-host')?.remove();
  }).catch(() => {});
}

async function login(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto('https://nextdoor.nl/login/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await dismissCookieBanner(page);
    await page.waitForTimeout(500);

    const emailField = await page.$('input[type="email"], input[name="email"]');
    if (!emailField) throw new Error('Geen email-input gevonden op loginpagina');
    await emailField.click({ force: true });
    await emailField.fill(EMAIL);
    await page.waitForTimeout(300);

    const passwordField = await page.$('input[type="password"]');
    if (passwordField) {
      await passwordField.click({ force: true });
      await passwordField.fill(PASSWORD);
      await page.waitForTimeout(300);
    }

    try {
      await page.click('button[type="submit"]', { force: true, timeout: 5000 });
    } catch {
      await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
    }

    await page.waitForTimeout(5000);
    const url = page.url();
    if (url.includes('/login')) throw new Error(`Login mislukt, nog op: ${url}`);

    // Sessie opslaan
    const state = await ctx.storageState();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
    return true;
  } finally {
    await page.close();
  }
}

async function scrapeWithContext(ctx) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto(FEED_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await dismissCookieBanner(page);

    // Controleer of we ingelogd zijn
    const url = page.url();
    if (url.includes('/login')) return null; // sessie verlopen

    // Wacht op feed-items
    await page.waitForSelector('[data-testid="feed-item-card"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Scroll 4× naar beneden om meer posts te laden
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 2500));
      await page.waitForTimeout(1500);
    }

    // Extraheer alle feed-items
    const items = await page.$$eval('[data-testid="feed-item-card"]', (cards) => {
      const results = [];
      for (const card of cards) {
        // Post-ID uit id-attribuut: "s_17592246858511" → "17592246858511"
        const rawId = card.id || '';
        const postId = rawId.replace(/^s_/, '');
        if (!postId) continue;

        // Post-tekst
        const bodyEl = card.querySelector('[data-testid="post-body"]');
        const content = (bodyEl?.innerText || '').replace(/\s+/g, ' ').trim();
        if (!content || content.length < 10) continue;

        // Buurt
        const neighborhoodLink = card.querySelector('a[href*="/neighborhood/"]');
        const neighborhood = neighborhoodLink?.textContent?.trim() || '';

        // Auteur
        const authorEl = card.querySelector('[data-testid="author-children-test"]');
        const author = authorEl?.textContent?.trim() || '';

        // Tijdstip
        const timeEl = card.querySelector('[data-testid="post-timestamp"]');
        const timestamp = timeEl?.textContent?.trim() || '';

        // Titel: buurt + begin van de post-tekst
        const snippet = content.slice(0, 100) + (content.length > 100 ? '…' : '');
        const title = neighborhood ? `[${neighborhood}] ${snippet}` : snippet;

        // URL: stabiele identifier op basis van post-ID
        const url = `https://nextdoor.nl/posts/${postId}`;

        results.push({ url, title, content, postId, neighborhood, author, timestamp });
      }
      return results;
    });

    return items;
  } finally {
    await page.close();
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Nextdoor — Amersfoort buurtberichten',
    url: FEED_URL,
    sourceType: 'scrape',
    reliability: 'signal',
    category: 'social',
    scrapeFrequency: 'daily',
  });

  let items = [];
  const browser = await chromium.launch({ headless: true });

  try {
    // Probeer opgeslagen sessie
    let ctx;
    if (fs.existsSync(SESSION_FILE)) {
      const storageState = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      ctx = await browser.newContext({ userAgent: UA, locale: 'nl-NL', storageState, viewport: { width: 1280, height: 900 } });
      items = await scrapeWithContext(ctx);
      if (items === null) {
        // Sessie verlopen — opnieuw inloggen
        console.log('Sessie verlopen, opnieuw inloggen...');
        await ctx.close();
        ctx = await browser.newContext({ userAgent: UA, locale: 'nl-NL', viewport: { width: 1280, height: 900 } });
        await login(ctx);
        items = await scrapeWithContext(ctx) || [];
      }
    } else {
      // Eerste keer — inloggen
      ctx = await browser.newContext({ userAgent: UA, locale: 'nl-NL', viewport: { width: 1280, height: 900 } });
      await login(ctx);
      items = await scrapeWithContext(ctx) || [];
    }
    await ctx.close();
  } catch (err) {
    console.error(`Fout Nextdoor: ${err.message}`);
  } finally {
    await browser.close();
  }

  let saved = 0, skipped = 0, errors = 0;
  for (const item of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content: item.content,
        summary: item.neighborhood ? `${item.neighborhood}${item.author ? ' — ' + item.author : ''}` : '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult('Nextdoor — Amersfoort buurtberichten', saved, skipped, errors);
}

scrape().catch(console.error);
