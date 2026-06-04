import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const parser = new Parser();
const FEED_URL = 'https://feeds.rijksoverheid.nl/nieuws.rss';
const KEYWORDS = ['amersfoort', 'eemland', 'regio utrecht', 'provincie utrecht'];

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Rijksoverheid (gefilterd)',
    url: FEED_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'daily',
  });

  const feed = await parser.parseURL(FEED_URL);
  let saved = 0, skipped = 0, errors = 0;

  for (const item of feed.items) {
    const text = `${item.title} ${item.contentSnippet || ''}`.toLowerCase();
    if (!KEYWORDS.some(kw => text.includes(kw))) continue;

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

  logResult('Rijksoverheid', saved, skipped, errors);
}

scrape().catch(console.error);
