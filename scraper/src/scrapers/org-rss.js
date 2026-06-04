// org-rss.js — RSS-feeds van Amersfoortse en regionale organisaties
// Bevat: Railcenter, Mondriaanhuis, Kunsthal KAdE, Kamp Amersfoort,
//        Natuurmonumenten, RCE, Ministerie van Defensie
// FrieslandCampina, CliniClowns, Museum Flehite, HU: geen RSS → HTML (zie andere scrapers)

import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const parser = new Parser({ headers: { 'User-Agent': UA } });

// filter: null = alles opslaan, string = alleen items die de term bevatten (case-insensitive)
const FEEDS = [
  {
    name: 'Railcenter',
    url: 'https://www.railcenter.nl',
    feedUrl: 'https://www.railcenter.nl/feed/',
    category: 'local_news',
    reliability: 'secondary',
    filter: null,
  },
  {
    name: 'Mondriaanhuis',
    url: 'https://www.mondriaanhuis.nl',
    feedUrl: 'https://www.mondriaanhuis.nl/nl/feed/',
    category: 'local_news',
    reliability: 'secondary',
    filter: null,
  },
  {
    name: 'Kunsthal KAdE',
    url: 'https://www.kunsthalkade.nl',
    feedUrl: 'https://www.kunsthalkade.nl/nl/feed/',
    category: 'local_news',
    reliability: 'secondary',
    filter: null,
  },
  {
    name: 'Kamp Amersfoort',
    url: 'https://www.kampamersfoort.nl',
    feedUrl: 'https://www.kampamersfoort.nl/feed/',
    category: 'local_news',
    reliability: 'secondary',
    filter: null,
  },
  {
    name: 'Natuurmonumenten',
    url: 'https://www.natuurmonumenten.nl',
    feedUrl: 'https://www.natuurmonumenten.nl/api/news?_format=rss',
    category: 'local_news',
    reliability: 'secondary',
    filter: null,
  },
  // RCE en Defensie: geen RSS beschikbaar (Next.js-site) → HTML in erfgoed-natuur.js
];

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  return parser.parseString(xml);
}

async function scrape() {
  for (const src of FEEDS) {
    const sourceId = await getOrCreateSource(db, {
      name: src.name,
      url: src.url,
      sourceType: 'rss',
      reliability: src.reliability,
      category: src.category,
      scrapeFrequency: 'weekly',
    });

    let saved = 0, skipped = 0, errors = 0;

    try {
      const feed = await fetchFeed(src.feedUrl);
      for (const item of feed.items) {
        // Filter voor landelijke bronnen: alleen items met 'amersfoort' in titel of tekst
        if (src.filter) {
          const text = `${item.title || ''} ${item.contentSnippet || item.content || ''}`.toLowerCase();
          if (!text.includes(src.filter)) { skipped++; continue; }
        }
        try {
          const r = await saveRawItem(db, {
            sourceId,
            externalUrl: item.link,
            title: item.title,
            content: item.contentSnippet || item.content || '',
            summary: item.contentSnippet?.slice(0, 250) || '',
          });
          if (r.saved) saved++; else skipped++;
        } catch (e) { errors++; console.error(`Item fout (${src.name}):`, e.message); }
      }
    } catch (e) {
      console.error(`${src.name} fout:`, e.message);
      errors++;
    }

    logResult(src.name, saved, skipped, errors);
  }
}

scrape().catch(console.error);
