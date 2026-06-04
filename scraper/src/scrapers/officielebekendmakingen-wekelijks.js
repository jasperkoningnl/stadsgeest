// officielebekendmakingen-wekelijks.js — wekelijkse OB-subtypen
//
// Momenteel geven alle drie typen 0 resultaten via dcterms.type filter.
// Scraper draait wekelijks en rapporteert — zodra types beschikbaar zijn,
// worden ze automatisch opgepikt.

import { createDb, ensureSource, insertItem, log } from '../lib.js';

const db = createDb();
const GET_URL = 'https://zoek.officielebekendmakingen.nl/sru/Search';
const OB_BASE = 'https://zoek.officielebekendmakingen.nl';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

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

function parseRecords(xml) {
  const records = [];
  const blocks = xml.match(/<record[\s\S]*?<\/record>/g) || [];
  for (const block of blocks) {
    const idMatch = block.match(/<dcterms:identifier[^>]*>([^<]+)<\/dcterms:identifier>/);
    if (!idMatch) continue;
    const identifier = idMatch[1].trim();
    const titleMatch = block.match(/<dcterms:title[^>]*>([^<]+)<\/dcterms:title>/);
    const title = titleMatch ? titleMatch[1].trim() : identifier;
    const dateMatch = block.match(/<dcterms:modified[^>]*>([^<]+)<\/dcterms:modified>/) ||
                      block.match(/<dcterms:date[^>]*>([^<]+)<\/dcterms:date>/);
    const date = dateMatch ? dateMatch[1].trim() : '';
    const typeMatch = block.match(/<dcterms:type[^>]*>([^<]+)<\/dcterms:type>/);
    const docType = typeMatch ? typeMatch[1].trim() : '';
    const url = identifier.startsWith('http') ? identifier : `${OB_BASE}/${identifier}.html`;
    records.push({ identifier, title, date, docType, url });
  }
  return records;
}

async function scrape() {
  for (const s of WEEKLY_SOURCES) {
    const sourceId = await ensureSource(db, {
      name: s.name,
      url: `${GET_URL}?type=${s.sourceId}`,
      source_type: 'api',
      reliability: 'primary',
      category: 'government',
      scrape_frequency: s.frequency,
      tier: s.tier,
    });

    const stats = { new: 0, skipped: 0, errors: 0 };

    try {
      const url = `${GET_URL}?operation=searchRetrieve&version=1.2&maximumRecords=20&recordSchema=oeb&query=${encodeURIComponent(s.query)}&sortKeys=dcterms.modified,,0`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      const records = parseRecords(xml);

      for (const rec of records) {
        const saved = await insertItem(db, {
          source_id: sourceId,
          title: rec.title,
          content: [rec.docType, rec.date].filter(Boolean).join(' | '),
          summary: [rec.docType, rec.date].filter(Boolean).join(' | ').substring(0, 300),
          external_url: rec.url,
          scraped_at: new Date().toISOString(),
        });
        if (saved === true) stats.new++;
        else if (saved === false) stats.skipped++;
        else stats.errors++;
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.warn(`[OB-WEKELIJKS] ${s.sourceId}: ${err.message}`);
    }

    log(s.name, stats);
  }
}

scrape().catch(console.error);
