import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SUBREDDITS = [
  { name: 'r/amersfoort', url: 'https://www.reddit.com/r/amersfoort/new.rss' },
];

const parser = new Parser();

async function scrape() {
  for (const sub of SUBREDDITS) {
    const sourceId = await getOrCreateSource(db, {
      name: `Reddit ${sub.name}`,
      url: sub.url,
      sourceType: 'api',
      reliability: 'signal',
      category: 'social',
      scrapeFrequency: 'daily',
    });

    let saved = 0, skipped = 0, errors = 0, found = 0;
    try {
      let response = await fetch(sub.url, {
        headers: { 'User-Agent': 'AmersfoortLokaal/1.0 (nieuwssite; contact@amersfoortlokaal.nl)' },
      });
      if (response.status === 429) {
        await new Promise(r => setTimeout(r, 15000));
        response = await fetch(sub.url, { headers: { 'User-Agent': 'AmersfoortLokaal/1.0 (nieuwssite; contact@amersfoortlokaal.nl)' } });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await parser.parseString(await response.text());
      found = Array.isArray(feed.items) ? feed.items.length : 0;

      if (feed.items) {
        for (const p of feed.items) {

          try {
            const result = await saveRawItem(db, {
              sourceId,
              externalUrl: p.link,
              title: p.title,
              content: p.contentSnippet || p.content || '',
              summary: p.creator ? `Door ${p.creator}` : '',
              publishedAt: p.isoDate || p.pubDate || null,
            });
            if (result.saved) saved++; else skipped++;
          } catch (err) {
            errors++;
            console.error(`Fout bij Reddit post "${p.title}":`, err.message);
          }
        }
      }
    } catch (err) {
      errors++;
      console.error(`Reddit ${sub.name}:`, err.message);
    }

    // items_found is de bereikbare feed, ook als alle items al bekend zijn.
    await logResult(db, sourceId, `Reddit ${sub.name}`, saved, skipped, errors, found);
  }
}

scrape().catch(err => { console.error(err); process.exitCode = 1; });
