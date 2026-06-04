// igj-nvwa.js — IGJ en NVWA inspectieresultaten gefilterd op Amersfoort
// IGJ: https://www.igj.nl/zoeken?q=amersfoort (Next.js)
// NVWA: https://www.nvwa.nl/zoeken?trefwoord=amersfoort (Next.js)
import { chromium } from 'playwright';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCES = [
  {
    name: 'IGJ — inspectieresultaten Amersfoort',
    url: 'https://www.igj.nl/actueel/nieuws',
    searchUrl: 'https://www.igj.nl/zoeken?q=amersfoort',
    base: 'https://www.igj.nl',
    category: 'registry',
    reliability: 'primary',
    scrapeFrequency: 'weekly',
  },
  {
    name: 'NVWA — inspectieresultaten Amersfoort',
    url: 'https://www.nvwa.nl/actueel/nieuws',
    searchUrl: 'https://www.nvwa.nl/zoeken?trefwoord=amersfoort',
    base: 'https://www.nvwa.nl',
    category: 'registry',
    reliability: 'primary',
    scrapeFrequency: 'weekly',
  },
];

async function fetchDetailContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      const pdfLinks = Array.from(document.querySelectorAll('a[href$=".pdf"], a[href*=".pdf?"]'))
        .map(a => a.href);

      ['nav', 'footer', 'aside', '.sidebar', '.navigation', '.menu', 'header'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });

      const contentEl = document.querySelector(
        'article, main, .content, .article-body, .intro, [class*="summary"], [class*="description"]'
      );
      const text = (contentEl?.innerText || document.body?.innerText || '').trim();

      return { content: text.substring(0, 5000), pdfUrls: pdfLinks };
    });
  } catch (err) {
    return { content: '', pdfUrls: [] };
  }
}

async function scrapeSource(page, db, source) {
  const sourceId = await getOrCreateSource(db, {
    name: source.name,
    url: source.url,
    sourceType: 'browser',
    reliability: source.reliability,
    category: source.category,
    scrapeFrequency: source.scrapeFrequency,
  });

  let saved = 0, skipped = 0, errors = 0;

  await page.goto(source.searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const items = await page.evaluate((base) => {
    const found = new Map();
    const selectors = [
      'a[href*="/actueel/"]',
      'a[href*="/nieuws/"]',
      'a[href*="/publicaties/"]',
      'a[href*="/inspectie"]',
      'article a',
      '[class*="result"] a',
      '[class*="search-result"] a',
      'li a[href]',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(a => {
        const href = a.href;
        if (!href || href.includes('zoeken') || found.has(href)) return;
        const title = (a.textContent || a.getAttribute('aria-label') || '').trim();
        if (title.length > 10) {
          found.set(href, { url: href, title });
        }
      });
    }
    return Array.from(found.values()).slice(0, 20);
  }, source.base);

  for (const item of items) {
    if (!item.title || item.title.length < 10) continue;
    try {
      const detail = await fetchDetailContent(page, item.url);
      await page.waitForTimeout(1000);

      const parts = [];
      if (detail.content) parts.push(detail.content);
      if (detail.pdfUrls?.length) {
        parts.push('PDF: ' + detail.pdfUrls.join(', '));
      }
      const content = parts.join('\n\n') || item.title;

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content: content.substring(0, 5000),
        summary: detail.content ? detail.content.substring(0, 300) : source.name,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult(source.name.split(' ')[0], saved, skipped, errors);
}

async function scrape() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    for (const source of SOURCES) {
      try {
        await scrapeSource(page, db, source);
      } catch (err) {
        console.error(`Fout bij ${source.name}:`, err.message);
      }
    }
  } finally {
    if (browser) await browser.close();
  }
}

scrape().catch(console.error);
