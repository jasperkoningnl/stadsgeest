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

// De EF-codes van TenderNed. Alleen de types die in Amersfoortse berichten
// voorkomen; onbekende codes laten de titel ongemoeid.
const EF_SOORTEN = {
  EF29: 'Gunning',
  EF16: 'Aanbesteding',
  EFE3: 'Aanbesteding',
  EF02: 'Vooraankondiging',
  EF03: 'Gunning',
};

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

      // EF-type in de titel en een toelichting in de tekst. Zonder dat leest een
      // gunningsaankondiging (EF29) als een openstaande aanbesteding met een
      // sluitingsdatum in het verleden, en dat werd door de analist telkens als
      // datafout aangemerkt in plaats van gebruikt. Een gunning is juist het
      // interessantste bericht: dan is bekend wie de opdracht heeft gekregen.
      const efType = (fullContent.match(/Type publicatie:\s*(EF[A-Z0-9]+)/i) || [])[1] || '';
      const soort = EF_SOORTEN[efType.toUpperCase()] || '';
      const titel = soort ? `${soort}: ${entry.title}` : entry.title;
      const toelichting = soort
        ? `\n\nToelichting Stadsgeest: publicatietype ${efType} betekent "${soort.toLowerCase()}". `
          + (efType.toUpperCase() === 'EF29'
            ? 'Bij een gunningsaankondiging ligt de sluitingsdatum per definitie in het verleden; '
              + 'dat is geen datafout. De opdracht is gegund, en de vraag is aan wie.'
            : 'De sluitingsdatum hoort hier in de toekomst te liggen.')
        : '';

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: entry.link,
        title: titel,
        content: (fullContent + toelichting).substring(0, 5200),
        summary: entry.summary.substring(0, 500),
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${entry.title}":`, err.message);
    }
  }

  await logResult(db, sourceId, 'TenderNed', saved, skipped, errors);
}

scrape().catch(console.error);
