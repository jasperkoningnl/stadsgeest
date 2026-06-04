// Subsidieregister gemeente Amersfoort
// Scrapet de pagina op nieuwe PDF-versies. Jaarlijkse publicatie.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.amersfoort.nl/subsidieregister';
const BASE_URL = 'https://www.amersfoort.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Subsidieregister gemeente Amersfoort',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Verzamel PDF-items synchronisch, sla op in for-loop
  const items = [];
  $('a[href$=".pdf"], a[href*=".pdf"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).text().trim() ||
                  href.split('/').pop()?.replace(/[-_]/g, ' ').replace('.pdf', '').replace('.PDF', '') || 'PDF';
    // Prioriteit: subsidie-specifieke PDFs
    const isSubsidie = href.toLowerCase().includes('subsidie') || href.toLowerCase().includes('register');
    if (!items.find(i => i.url === url)) {
      items.push({ url, title, isSubsidie });
    }
  });

  // Filter op subsidie-PDFs; fallback naar alle PDFs als geen specifieke gevonden
  const toSave = items.some(i => i.isSubsidie)
    ? items.filter(i => i.isSubsidie)
    : items;

  let saved = 0, skipped = 0, errors = 0;
  for (const { url, title } of toSave) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title: `Subsidieregister: ${title}`,
        content: `PDF-document: ${url}`,
        summary: 'Openbaar subsidieregister gemeente Amersfoort',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij PDF "${url}":`, err.message);
    }
  }

  logResult('Subsidieregister gemeente Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
