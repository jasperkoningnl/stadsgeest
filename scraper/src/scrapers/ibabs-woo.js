// ibabs-woo.js — Bestuurlijke informatie gemeente Amersfoort (iBabs publieksportaal)
// Scrapet het dashboard voor recente items: Woo-verzoeken, klachten, convenanten,
// ruimtelijke procedures en adviezen. Dashboard rendert server-side, geen Playwright nodig.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://amersfoort.bestuurlijkeinformatie.nl/';
const BASE_URL = 'https://amersfoort.bestuurlijkeinformatie.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Bestuurlijke informatie gemeente Amersfoort (iBabs)',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Dashboard toont "Actuele overzicht items" tabel: Titel | Soort | Datum wijziging
  const items = [];
  $('table tr').each((_, tr) => {
    const $tr = $(tr);
    const $link = $tr.find('td a').first();
    const href = $link.attr('href') || '';
    const title = $link.text().trim();
    const soort = $tr.find('td').eq(1).text().trim();
    const datum = $tr.find('td').eq(2).text().trim();

    if (!href || !title) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const content = soort ? `${soort}${datum ? ' — ' + datum : ''}` : '';

    if (!items.find(i => i.url === url)) {
      items.push({ url, title, content });
    }
  });

  let saved = 0, skipped = 0, errors = 0;
  for (const { url, title, content } of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content,
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${url}":`, err.message);
    }
  }

  logResult('Bestuurlijke informatie Amersfoort (iBabs)', saved, skipped, errors);
}

scrape().catch(console.error);
