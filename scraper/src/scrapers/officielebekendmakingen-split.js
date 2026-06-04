// officielebekendmakingen-split.js — OB opsplitst per publicatietype
//
// Gebruikt GET-endpoint: zoek.officielebekendmakingen.nl/sru/Search
//
// Testresultaten 2026-06-04:
//   Omgevingsvergunning: 33 resultaten  ✓
//   Verkeersbesluit:     25 resultaten  ✓
//   Gemeenteblad overig: via brede spatial-query (1101 totaal, exclusief OV + VB)
//   Gem.regelingen / Prov.blad / Waterschapsblad: 0 via dcterms.type filter (typenaam onduidelijk)
//
// NOTE: de bestaande officielebekendmakingen.js gebruikt POST naar repository.overheid.nl
// met 'col = "Gemeenteblad"' — die col-index is UNSUPPORTED in SRU 2.0 en geeft 0 items.
// Die scraper is feitelijk broken. Dit bestand vervangt de brede dekking.

import * as cheerio from 'cheerio';
import { createDb, ensureSource, insertItem, log } from '../lib.js';

const db = createDb();
const GET_URL = 'https://zoek.officielebekendmakingen.nl/sru/Search';
const OB_BASE = 'https://zoek.officielebekendmakingen.nl';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';
const MAX_RECORDS = 25;

// Subtypen met directe dcterms.type-filter (bevestigd werkend)
const TYPED_SOURCES = [
  {
    sourceId: 'ob-omgevingsvergunningen',
    name: 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort',
    tier: 1,
    frequency: 'daily',
    query: `dcterms.spatial any "Amersfoort" AND dcterms.type="Omgevingsvergunning"`,
  },
  {
    sourceId: 'ob-verkeersbesluiten',
    name: 'Officiële Bekendmakingen — Verkeersbesluiten Amersfoort',
    tier: 1,
    frequency: 'daily',
    query: `dcterms.spatial any "Amersfoort" AND dcterms.type="Verkeersbesluit"`,
  },
];

// Wekelijkse subtypen — momenteel 0 resultaten via dcterms.type (type-waarden onduidelijk)
// Worden geregistreerd als bron; worden actief zodra de juiste type-waarden bekend zijn.
const WEEKLY_SOURCES = [
  {
    sourceId: 'ob-gemeenschappelijke-regelingen',
    name: 'Officiële Bekendmakingen — Gemeenschappelijke regelingen',
    tier: 1,
    frequency: 'weekly',
    query: `dcterms.spatial any "Amersfoort" AND dcterms.type="Blad gemeenschappelijke regeling"`,
  },
  {
    sourceId: 'ob-provinciaal-blad',
    name: 'Officiële Bekendmakingen — Provinciaal blad',
    tier: 2,
    frequency: 'weekly',
    query: `dcterms.spatial any "Amersfoort" AND dcterms.type="Provinciaal blad"`,
  },
  {
    sourceId: 'ob-waterschapsblad',
    name: 'Officiële Bekendmakingen — Waterschapsblad',
    tier: 1,
    frequency: 'weekly',
    query: `dcterms.spatial any "Amersfoort" AND dcterms.type="Waterschapsblad"`,
  },
];

// Brede catch-all: alles wat niet Omgevingsvergunning of Verkeersbesluit is
const OVERIG_SOURCE = {
  sourceId: 'ob-gemeenteblad-overig',
  name: 'Officiële Bekendmakingen — Gemeenteblad overig Amersfoort',
  tier: 1,
  frequency: 'daily',
  query: `dcterms.spatial any "Amersfoort"`,
  // Filter in code: sla items over die al door typed sources zijn gedekt
  excludeTypes: ['Omgevingsvergunning', 'omgevingsvergunning', 'Verkeersbesluit', 'verkeersbesluit'],
};

async function fetchOB(query, maxRecords = MAX_RECORDS) {
  const url = `${GET_URL}?operation=searchRetrieve&version=1.2&maximumRecords=${maxRecords}&recordSchema=oeb&query=${encodeURIComponent(query)}&sortKeys=dcterms.modified,,0`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function parseOBRecords(xml) {
  const records = [];
  const blocks = xml.match(/<record[\s\S]*?<\/record>/g) || [];
  for (const block of blocks) {
    const idMatch = block.match(/<dcterms:identifier[^>]*>([^<]+)<\/dcterms:identifier>/) ||
                    block.match(/<identifier[^>]*>([^<]+)<\/identifier>/);
    if (!idMatch) continue;
    const identifier = idMatch[1].trim();

    const titleMatch = block.match(/<dcterms:title[^>]*>([^<]+)<\/dcterms:title>/) ||
                       block.match(/<title[^>]*>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : identifier;

    const dateMatch = block.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/) ||
                      block.match(/<dcterms:date[^>]*>([^<]+)<\/dcterms:date>/) ||
                      block.match(/<date[^>]*>([^<]+)<\/date>/);
    const date = dateMatch ? dateMatch[1].trim() : '';

    const typeMatch = block.match(/<dcterms:type[^>]*>([^<]+)<\/dcterms:type>/) ||
                      block.match(/<type[^>]*>([^<]+)<\/type>/);
    const docType = typeMatch ? typeMatch[1].trim() : '';

    const descMatch = block.match(/<dcterms:description[^>]*>([\s\S]*?)<\/dcterms:description>/);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // HTML-URL
    const url = identifier.startsWith('http')
      ? identifier
      : `${OB_BASE}/${identifier}.html`;

    records.push({ identifier, title, date, docType, description, url });
  }
  return records;
}

async function fetchFullContent(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const contentType = r.headers.get('content-type') || '';
    if (contentType.includes('pdf') || r.url.endsWith('.pdf')) return `[PDF] ${r.url}`;
    const html = await r.text();
    if (html.trim().startsWith('%PDF')) return `[PDF] ${r.url}`;
    const $ = cheerio.load(html);
    $('nav, footer, aside, script, style, .sidebar, .navigation, .menu').remove();
    const content = $('article, .documentbody, main, .content').first().text().trim();
    return (content || $('body').text().trim()).substring(0, 5000);
  } catch {
    return null;
  }
}

async function runTypedSource(sourceDef) {
  const sourceId = await ensureSource(db, {
    name: sourceDef.name,
    url: `${GET_URL}?type=${sourceDef.sourceId}`,
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: sourceDef.frequency,
    tier: sourceDef.tier,
  });

  const stats = { new: 0, skipped: 0, errors: 0 };

  try {
    const xml = await fetchOB(sourceDef.query);
    const records = parseOBRecords(xml);

    if (records.length === 0) {
      console.log(`[OB-SPLIT] ${sourceDef.sourceId}: 0 records geparsed (query werkte niet of geen items)`);
    }

    for (const rec of records) {
      try {
        const fullContent = await fetchFullContent(rec.url);
        await new Promise(r => setTimeout(r, 800));

        const content = fullContent || [rec.docType, rec.date, rec.description].filter(Boolean).join(' | ');
        const summary = [rec.docType, rec.date].filter(Boolean).join(' | ');

        const saved = await insertItem(db, {
          source_id: sourceId,
          title: rec.title,
          content: content.substring(0, 5000),
          summary: summary.substring(0, 300),
          external_url: rec.url,
          scraped_at: new Date().toISOString(),
        });
        if (saved === true) stats.new++;
        else if (saved === false) stats.skipped++;
        else stats.errors++;
      } catch (err) {
        stats.errors++;
        console.error(`[OB-SPLIT] Fout bij ${rec.identifier}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[OB-SPLIT] ${sourceDef.sourceId} niet beschikbaar: ${err.message}`);
  }

  log(sourceDef.name, stats);
  return stats;
}

async function runOverig() {
  const sourceDef = OVERIG_SOURCE;
  const sourceId = await ensureSource(db, {
    name: sourceDef.name,
    url: `${GET_URL}?type=${sourceDef.sourceId}`,
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: sourceDef.frequency,
    tier: sourceDef.tier,
  });

  const stats = { new: 0, skipped: 0, errors: 0 };

  try {
    const xml = await fetchOB(sourceDef.query, 30);
    const records = parseOBRecords(xml);

    for (const rec of records) {
      // Sla over als dit type al door een typed source gedekt wordt
      if (sourceDef.excludeTypes.some(t => rec.docType.toLowerCase() === t.toLowerCase())) {
        stats.skipped++;
        continue;
      }

      try {
        const fullContent = await fetchFullContent(rec.url);
        await new Promise(r => setTimeout(r, 800));

        const content = fullContent || [rec.docType, rec.date, rec.description].filter(Boolean).join(' | ');
        const saved = await insertItem(db, {
          source_id: sourceId,
          title: rec.title,
          content: content.substring(0, 5000),
          summary: [rec.docType, rec.date].filter(Boolean).join(' | ').substring(0, 300),
          external_url: rec.url,
          scraped_at: new Date().toISOString(),
        });
        if (saved === true) stats.new++;
        else if (saved === false) stats.skipped++;
        else stats.errors++;
      } catch (err) {
        stats.errors++;
        console.error(`[OB-OVERIG] Fout bij ${rec.identifier}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[OB-OVERIG] niet beschikbaar: ${err.message}`);
  }

  log(sourceDef.name, stats);
  return stats;
}

async function scrape() {
  console.log(`\n[OB-SPLIT] gestart: ${new Date().toISOString()}`);

  // Dagelijks: typed sources (omgevingsvergunningen + verkeersbesluiten)
  for (const s of TYPED_SOURCES) {
    await runTypedSource(s);
  }

  // Dagelijks: brede overig-catch-all
  await runOverig();

  // Wekelijkse sources registreren (sources in DB, queries draaien los via run-weekly.js)
  for (const s of WEEKLY_SOURCES) {
    await ensureSource(db, {
      name: s.name,
      url: `${GET_URL}?type=${s.sourceId}`,
      source_type: 'api',
      reliability: 'primary',
      category: 'government',
      scrape_frequency: s.frequency,
      tier: s.tier,
    });
    console.log(`[OB-SPLIT] ${s.sourceId}: bron geregistreerd (draait via run-weekly.js)`);
  }
}

scrape().catch(console.error);
