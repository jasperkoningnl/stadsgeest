// Officiële Bekendmakingen — gemeente Amersfoort
// Gebruikt de KOOP SRU-interface (POST) voor Gemeenteblad bekendmakingen.
// SRU endpoint: https://repository.overheid.nl/sru/Search
// Documentatie: https://data.overheid.nl/dataset/officiele-bekendmakingen
//
// LET OP: de SRU dienst heeft regelmatig onderhoud (503). Het script
// rapporteert dan 0 items — dit is normaal gedrag.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SRU_URL = 'https://repository.overheid.nl/sru/Search';
const SOURCE_URL = 'https://zoek.officielebekendmakingen.nl';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

async function fetchSRU(maxRecords = 25) {
  const body = new URLSearchParams({
    operation: 'searchRetrieve',
    'x-connection': 'ob',
    query: 'dt.creator any "Amersfoort" AND col = "Gemeenteblad"',
    maximumRecords: String(maxRecords),
    startRecord: '1',
    sortKeys: 'publicatiedatum,,0',
  });

  const response = await fetch(SRU_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; StadsgeestScraper/1.0)',
      Accept: 'application/xml, text/xml, */*',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`SRU HTTP ${response.status}`);
  }

  const text = await response.text();

  if (
    text.includes('tijdelijk niet beschikbaar') ||
    text.includes('tijdelijk niet bereikbaar') ||
    !text.includes('searchRetrieveResponse')
  ) {
    throw new Error('SRU dienst tijdelijk niet beschikbaar');
  }

  return text;
}

function parseRecords(xml) {
  const records = [];
  const recordBlocks = xml.match(/<sru:record[\s\S]*?<\/sru:record>/g) || [];

  for (const block of recordBlocks) {
    const idMatch = block.match(/<dcterms:identifier[^>]*>([^<]+)<\/dcterms:identifier>/) ||
                    block.match(/<identifier[^>]*>([^<]+)<\/identifier>/);
    const identifier = idMatch ? idMatch[1].trim() : '';
    if (!identifier) continue;

    const titleMatch = block.match(/<dcterms:title[^>]*>([^<]+)<\/dcterms:title>/) ||
                       block.match(/<title[^>]*>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : identifier;

    const dateMatch = block.match(/<dcterms:date[^>]*>([^<]+)<\/dcterms:date>/) ||
                      block.match(/<date[^>]*>([^<]+)<\/date>/);
    const date = dateMatch ? dateMatch[1].trim() : '';

    const typeMatch = block.match(/<dcterms:type[^>]*>([^<]+)<\/dcterms:type>/) ||
                      block.match(/<type[^>]*>([^<]+)<\/type>/);
    const type = typeMatch ? typeMatch[1].trim() : '';

    const url = `https://zoek.officielebekendmakingen.nl/${identifier}.html`;
    records.push({ identifier, title, date, type, url });
  }

  return records;
}

async function fetchFullContent(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url;
    if (contentType.includes('pdf') || finalUrl.endsWith('.pdf')) {
      return `[PDF] ${finalUrl}`;
    }

    const html = await response.text();
    if (html.trim().startsWith('%PDF')) {
      return `[PDF] ${finalUrl}`;
    }

    const $ = cheerio.load(html);
    $('nav, footer, aside, script, style, .sidebar, .navigation, .menu').remove();
    const content = $('article, .documentbody, main, .content').first().text().trim();
    return content || $('body').text().trim().substring(0, 5000);
  } catch (err) {
    console.error(`Content fetch failed voor ${url}:`, err.message);
    return null;
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Officiële Bekendmakingen Amersfoort',
    url: SOURCE_URL,
    sourceType: 'api',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'daily',
  });

  let saved = 0, skipped = 0, errors = 0;

  try {
    const xml = await fetchSRU(25);
    const records = parseRecords(xml);

    if (records.length === 0) {
      console.warn('[OB] Geen records geparsed — SRU misschien down of XML-structuur gewijzigd');
    }

    for (const rec of records) {
      try {
        const fullContent = await fetchFullContent(rec.url);
        await new Promise(r => setTimeout(r, 1000));

        const baseContent = [rec.type, rec.date].filter(Boolean).join(' | ');
        const content = fullContent || baseContent;

        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: rec.url,
          title: rec.title,
          content: content.substring(0, 5000),
          summary: rec.type || '',
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Fout bij bekendmaking "${rec.identifier}":`, err.message);
      }
    }
  } catch (err) {
    console.warn(`[OB] Niet beschikbaar: ${err.message}`);
  }

  logResult('Officiële Bekendmakingen Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
