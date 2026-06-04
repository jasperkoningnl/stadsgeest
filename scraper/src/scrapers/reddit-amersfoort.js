import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SUBREDDITS = [
  { name: 'r/amersfoort', url: 'https://www.reddit.com/r/amersfoort/new/.json?limit=25', filterKeywords: false },
  { name: 'r/Utrecht', url: 'https://www.reddit.com/r/Utrecht/new/.json?limit=25', filterKeywords: true },
];

const KEYWORDS = ['amersfoort', 'eemland', 'vathorst', 'hoogland'];

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

    let response;
    try {
      response = await fetch(sub.url, {
        headers: { 'User-Agent': 'AmersfoortLokaal/1.0 (nieuwssite; contact@amersfoortlokaal.nl)' },
      });
    } catch (err) {
      console.error(`Reddit ${sub.name}: netwerkfout —`, err.message);
      continue;
    }

    if (!response.ok) {
      console.error(`Reddit ${sub.name}: HTTP ${response.status}`);
      continue;
    }

    const data = await response.json();
    let saved = 0, skipped = 0, errors = 0;

    if (data.data?.children) {
      for (const post of data.data.children) {
        const p = post.data;

        if (sub.filterKeywords) {
          const text = `${p.title} ${p.selftext || ''}`.toLowerCase();
          if (!KEYWORDS.some(kw => text.includes(kw))) continue;
        }

        try {
          const result = await saveRawItem(db, {
            sourceId,
            externalUrl: `https://www.reddit.com${p.permalink}`,
            title: p.title,
            content: p.selftext || '',
            summary: `Score: ${p.score}, Comments: ${p.num_comments}`,
          });
          if (result.saved) saved++; else skipped++;
        } catch (err) {
          errors++;
          console.error(`Fout bij Reddit post "${p.title}":`, err.message);
        }
      }
    }

    logResult(`Reddit ${sub.name}`, saved, skipped, errors);

    // Rate limit: wacht 2 seconden tussen subreddits
    await new Promise(r => setTimeout(r, 2000));
  }
}

scrape().catch(console.error);
