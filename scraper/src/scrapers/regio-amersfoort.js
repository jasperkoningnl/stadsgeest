// Bureau Regio Amersfoort — nieuws
// WordPress RSS feed.

import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const parser = new Parser();
const FEED_URL = 'https://www.regioamersfoort.nl/feed/';
const SOURCE_URL = 'https://www.regioamersfoort.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Bureau Regio Amersfoort',
    url: SOURCE_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'government',
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
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title: item.title,
        content: item.contentSnippet || item.content || '',
        summary: item.contentSnippet || '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${item.title}":`, err.message);
    }
  }

  logResult('Bureau Regio Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
