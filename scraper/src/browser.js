// Gedeelde Playwright-helper voor browser-scrapers.
// Gebruik: import { withBrowser } from '../browser.js';
//
// withBrowser(async (page) => {
//   await page.goto('https://...');
//   return await page.$$eval('...');
// });

import { chromium } from 'playwright';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function withBrowser(fn, { timeout = 30000 } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    locale: 'nl-NL',
    extraHTTPHeaders: {
      'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}
