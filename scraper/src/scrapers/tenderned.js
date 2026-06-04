// tenderned.js — TenderNed aanbestedingen gefilterd op Amersfoort
// TenderNed levert een Atom-feed (niet RSS) — handmatige fetch + regex-parsing,
// net als rechtspraak.js. rss-parser kan het atom:-namespace formaat niet parsen.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const FEED_URL = 'https://www.tenderned.nl/papi/tenderned-rs-tns/rss/laatste-publicatie.rss';
const KEYWORDS = ['amersfoort', 'gemeente amersfoort', 'regio amersfoort'];
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

async function fetchFeed() {
  const response = await fetch(FEED_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/atom+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`TenderNed HTTP ${response.status}`);
  return response.text();
}

function parseAtomEntries(xml) {
  const entries = [];
  const blocks = xml.match(/<atom:entry>([\s\S]*?)<\/atom:entry>/g) || [];

  for (const block of blocks) {
    const title = (block.match(/<atom:title>([^<]+)<\/atom:title>/) || [])[1] || '';
    const linkMatch = block.match(/<atom:link[^>]+href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : '';
    const summaryRaw = (block.match(/<atom:summary[^>]*>([\s\S]*?)<\/atom:summary>/) || [])[1] || '';
    const summary = summaryRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const updated = (block.match(/<atom:updated>([^<]+)<\/atom:updated>/) || [])[1] || '';

    if (!title || !link) continue;
    entries.push({ title, link, summary, updated });
  }

  return entries;
}

async function fetchFullContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = cheerio.load(html);
    $('nav, footer, aside, script, style, .sidebar, .navigation, .menu').remove();
    const content = $('main, .tender-detail, article, .content').first().text().trim();
    return content || $('body').text().trim().substring(0, 5000);
  } catch (err) {
    console.error(`Content fetch failed voor ${url}:`, err.message);
    return null;
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'TenderNed (Amersfoort)',
    url: FEED_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'daily',
  });

  let saved = 0, skipped = 0, errors = 0;

  const xml = await fetchFeed();
  const entries = parseAtomEntries(xml);

  for (const entry of entries) {
    const text = `${entry.title} ${entry.summary}`.toLowerCase();
    if (!KEYWORDS.some(kw => text.includes(kw))) continue;

    try {
      let fullContent = entry.summary;
      if (entry.link) {
        const fetched = await fetchFullContent(entry.link);
        if (fetched && fetched.length > entry.summary.length) {
          fullContent = fetched.substring(0, 5000);
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: entry.link,
        title: entry.title,
        content: fullContent,
        summary: entry.summary.substring(0, 500),
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${entry.title}":`, err.message);
    }
  }

  logResult('TenderNed', saved, skipped, errors);
}

scrape().catch(console.error);
