// UWV ArbeidsmarktInZicht — Amersfoort
// Scrapet de Amersfoort-pagina op nieuwe publicaties/updates.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://arbeidsmarktinzicht.nl/amersfoort';
const BASE_URL = 'https://arbeidsmarktinzicht.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'UWV ArbeidsmarktInZicht Amersfoort',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'data',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  let saved = 0, skipped = 0, errors = 0;
  const items = [];

  // Zoek publicatie-links
  $('a[href*="/amersfoort/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href === PAGE_URL || href === '/amersfoort' || href === '/amersfoort/') return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = $(el).text().trim() || href.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '';
    if (url && title.length > 3 && !items.find(i => i.url === url)) {
      items.push({ url, title });
    }
  });

  // Fallback: externe links op de pagina die arbeidsmarktdata zijn
  if (items.length === 0) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const url = href.startsWith('http') ? href : (href.startsWith('/') ? `${BASE_URL}${href}` : '');
      const title = $(el).text().trim();
      if (url.includes('arbeidsmarkt') && title.length > 5 && !items.find(i => i.url === url)) {
        items.push({ url, title });
      }
    });
  }

  // Als echt niets gevonden: sla de pagina zelf op als monitoring-punt
  if (items.length === 0) {
    const pageTitle = $('h1, h2').first().text().trim() || 'ArbeidsmarktInZicht Amersfoort update';
    const date = new Date().toISOString().split('T')[0];
    items.push({ url: `${PAGE_URL}#${date}`, title: `${pageTitle} — ${date}` });
  }

  for (const { url, title } of items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content: '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${title}":`, err.message);
    }
  }

  logResult('UWV ArbeidsmarktInZicht Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
