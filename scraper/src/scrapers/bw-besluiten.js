// bw-besluiten.js — B&W besluitenlijsten gemeente Amersfoort (Notubiz)
// URL: https://amersfoort.notubiz.nl/modules/12/besluitenlijsten_en_agenda%27s_b%26w/view
// Data zit in table.overview_list tbody tr — kolommen: (icon) | datum | tijd | titel | acties
// Let op: de originele URL /besluitenlijsten_b_en_w/ werkte niet (leeg), /view wél.

import * as cheerio from 'cheerio';
import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = "https://amersfoort.notubiz.nl/modules/12/besluitenlijsten_en_agenda%27s_b%26w/view";
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

async function fetchFullContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url;
    if (contentType.includes('pdf') || finalUrl.endsWith('.pdf')) {
      return `[PDF] ${finalUrl}`;
    }

    const html = await response.text();
    if (html.trim().startsWith('%PDF')) {
      return `[PDF] ${finalUrl}`;
    }

    const $ = cheerio.load(html);
    $('nav, footer, aside, script, style, .sidebar, .navigation, .menu').remove();
    const content = $('article, main, table, .content, .documentbody').first().text().trim();
    return content || $('body').text().trim().substring(0, 5000);
  } catch (err) {
    console.error(`Content fetch failed voor ${url}:`, err.message);
    return null;
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'B&W besluitenlijsten gemeente Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let items = [];
  try {
    items = await withBrowser(async (page) => {
      await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForSelector('table.overview_list tbody tr', { timeout: 20000 }).catch(() => {});

      return await page.$$eval(
        'table.overview_list tbody tr',
        (rows) => {
          const seen = new Set();
          const results = [];
          for (const row of rows) {
            const link = row.querySelector('a[href*="besluitenlijst"], a[href*="notubiz"]');
            if (!link) continue;
            const url = link.href;
            if (!url || seen.has(url)) continue;
            seen.add(url);

            const cells = row.querySelectorAll('td');
            const titleCell = cells[3];
            const dateCell = cells[1];
            const title = (titleCell?.textContent || link.textContent || '').trim();
            const date = (dateCell?.textContent || '').trim();

            if (!title || title.length < 3) continue;
            results.push({ url, title: date ? `${title} — ${date}` : title });
          }
          return results;
        },
      );
    }, { timeout: 60000 });
  } catch (err) {
    console.error(`Browser-fout B&W besluiten: ${err.message}`);
  }

  let saved = 0, skipped = 0, errors = 0;
  for (const item of items) {
    try {
      const fullContent = await fetchFullContent(item.url);
      await new Promise(r => setTimeout(r, 1000));

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.url,
        title: item.title,
        content: fullContent ? fullContent.substring(0, 5000) : '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
    }
  }

  logResult('B&W besluitenlijsten gemeente Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
