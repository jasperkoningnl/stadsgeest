import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';
const parser = new Parser();
const FEED_URL = 'https://rss.politie.nl/rss/ab/gemeenten/utrecht/amersfoort.xml';

async function fetchFullContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = cheerio.load(html);
    $('nav, footer, aside, script, style, .sidebar, .navigation, .menu').remove();
    const content = $('article, main, .content, .article-body, .entry-content').first().text().trim();
    return content || $('body').text().trim().substring(0, 5000);
  } catch (err) {
    console.error(`Content fetch failed voor ${url}:`, err.message);
    return null;
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Politie Amersfoort',
    url: FEED_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'emergency',
    scrapeFrequency: 'daily',
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
      const rssContent = item.contentSnippet || item.content || '';

      let fullContent = rssContent;
      if (item.link) {
        const fetched = await fetchFullContent(item.link);
        if (fetched && fetched.length > rssContent.length) {
          fullContent = fetched.substring(0, 5000);
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title: item.title,
        content: fullContent,
        summary: rssContent.substring(0, 500),
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${item.title}":`, err.message);
    }
  }

  logResult('Politie Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
