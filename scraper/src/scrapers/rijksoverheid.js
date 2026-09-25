import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const parser = new Parser();
// Sinds juni 2026 genereert het nieuwe Rijksoverheid-platform RSS via /api/rss.
// Meteen op Amersfoort zoeken voorkomt het ophalen van de volledige landelijke feed.
const FEED_QUERY = JSON.stringify({ filters: [], resultSearchTerm: 'Amersfoort', pageTitle: 'Nieuws' });
const FEED_URL = `https://www.rijksoverheid.nl/api/rss?query=${encodeURIComponent(FEED_QUERY)}`;
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

  let saved = 0, skipped = 0, errors = 0;
  try {
    const feed = await parser.parseURL(FEED_URL);
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
  } catch (err) {
    errors++;
    console.error('Rijksoverheid feedfout:', err.message);
  }

  await logResult(db, sourceId, 'Rijksoverheid', saved, skipped, errors);
}

scrape().catch(err => { console.error(err); process.exitCode = 1; });
