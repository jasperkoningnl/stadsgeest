// Amersfoort in Cijfers — nieuwe publicaties en datasets
// RSS feed van het CBS-achtige Amersfoort-statistiekenportaal.

import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const parser = new Parser();
const FEED_URL = 'https://amersfoortincijfers.nl/feed.ashx';
const SOURCE_URL = 'https://amersfoortincijfers.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Amersfoort in Cijfers',
    url: SOURCE_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'data',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(FEED_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  const feed = await parser.parseString(xml);

  let saved = 0, skipped = 0, errors = 0;

  for (const item of feed.items) {
    // De feed.ashx heeft geen <link> in items — gebruik de hoofdpagina als URL
    // maar dedupliceer op titel + datum
    const datum = item.pubDate ? new Date(item.pubDate).toISOString().split('T')[0] : '';
    const url = item.link || `${SOURCE_URL}#${encodeURIComponent(item.title || '')}-${datum}`;

    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title: item.title || '(onbekend)',
        content: item.contentSnippet || item.content || datum,
        summary: datum ? `Gepubliceerd: ${datum}` : '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${item.title}":`, err.message);
    }
  }

  logResult('Amersfoort in Cijfers', saved, skipped, errors);
}

scrape().catch(console.error);
