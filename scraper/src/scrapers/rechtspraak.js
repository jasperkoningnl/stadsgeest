// Rechtspraak.nl — uitspraken met Amersfoort als zoekterm
// Gebruikt de Open Data Atom-feed: https://data.rechtspraak.nl/uitspraken/zoeken
// Volledige tekst via: https://data.rechtspraak.nl/uitspraken/content?id=[ECLI]
// Documentatie: https://www.rechtspraak.nl/Uitspraken/Paginas/Open-Data.aspx

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

// Strategie: twee feeds combineren
// 1. Rechtbank Midden-Nederland (RBMNE) — alle uitspraken, ongeacht zoekterm.
//    Dit is de bevoegde rechtbank voor Amersfoort.
// 2. Gerechtshof Arnhem-Leeuwarden (GHARL) — hoger beroep voor de regio.
// Aanvullend: uitspraken van andere rechtscolleges worden alleen opgeslagen
// als "Amersfoort" substantieel aanwezig is (meerdere keren in de tekst).
const FEEDS = [
  'https://data.rechtspraak.nl/uitspraken/zoeken?creator=RBMNE&max=20&sort=desc',
  'https://data.rechtspraak.nl/uitspraken/zoeken?creator=GHARL&max=10&sort=desc',
  'https://data.rechtspraak.nl/uitspraken/zoeken?q=Amersfoort&max=20&sort=desc',
];
const SOURCE_URL = 'https://data.rechtspraak.nl/uitspraken/zoeken';
const CONTENT_URL = 'https://data.rechtspraak.nl/uitspraken/content';

// Lokale rechtbanken — uitspraken worden altijd opgeslagen
const LOCAL_COURTS = new Set(['RBMNE', 'GHARL']);

// Extraheer de rechtbankcode uit een ECLI (bijv. ECLI:NL:RBMNE:2026:716 → RBMNE)
function extractCourt(ecli) {
  const parts = (ecli || '').split(':');
  return parts.length >= 4 ? parts[2] : null;
}

// Controleer of de uitspraak voldoende betrekking heeft op Amersfoort
function isAmersfoortRelevant(ecli, content) {
  const court = extractCourt(ecli);
  // Lokale rechtbank: altijd relevant
  if (LOCAL_COURTS.has(court)) return true;
  // Andere rechtbanken: "Amersfoort" moet minimaal 2x voorkomen in de tekst
  // (1x kan een toevallige vermelding zijn; 2x duidt op een partij of locatie)
  const matches = (content || '').match(/\bamersfoort\b/gi);
  return matches && matches.length >= 2;
}


function parseAtomEntries(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const id = (entryXml.match(/<id>([^<]+)<\/id>/) || [])[1] || '';
    const title = (entryXml.match(/<title[^>]*>([^<]+)<\/title>/) || [])[1] || id;
    const updated = (entryXml.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
    const linkMatch = entryXml.match(/href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : `https://uitspraken.rechtspraak.nl/inziendocument?id=${encodeURIComponent(id)}`;
    const summary = (entryXml.match(/<summary[^>]*>([^<]*)<\/summary>/) || [])[1] || '';

    entries.push({ id, title, updated, link, summary });
  }

  return entries;
}

async function fetchEcliContent(ecliId) {
  if (!ecliId || !ecliId.startsWith('ECLI:')) return null;

  try {
    const url = `${CONTENT_URL}?id=${encodeURIComponent(ecliId)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StadsgeestScraper/1.0)',
        Accept: 'text/xml, application/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const xml = await response.text();
    const textContent = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    return textContent || null;
  } catch (err) {
    console.error(`ECLI content fetch failed voor ${ecliId}:`, err.message);
    return null;
  }
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Rechtspraak — Amersfoort',
    url: SOURCE_URL,
    sourceType: 'api',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, filtered = 0;
  const seenEcli = new Set(); // voorkom dubbelen tussen feeds

  for (const feedUrl of FEEDS) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StadsgeestScraper/1.0)',
          Accept: 'application/xml, text/xml, application/atom+xml, */*',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        console.error(`Rechtspraak feed ${feedUrl}: HTTP ${response.status}`);
        continue;
      }
      const xml = await response.text();
      const entries = parseAtomEntries(xml);

      for (const entry of entries) {
        if (seenEcli.has(entry.id)) { skipped++; continue; }
        seenEcli.add(entry.id);

        try {
          let fullContent = entry.summary || '';
          const ecliLink = `${CONTENT_URL}?id=${encodeURIComponent(entry.id)}`;

          if (entry.id.startsWith('ECLI:')) {
            const ecliText = await fetchEcliContent(entry.id);
            if (ecliText && ecliText.length > fullContent.length) {
              fullContent = ecliText.substring(0, 5000);
            }
            await new Promise(r => setTimeout(r, 800));
          }

          // Relevantiefilter: sla alleen Amersfoort-relevante uitspraken op
          if (!isAmersfoortRelevant(entry.id, fullContent)) {
            filtered++;
            continue;
          }

          const result = await saveRawItem(db, {
            sourceId,
            externalUrl: entry.id.startsWith('ECLI:') ? ecliLink : entry.link,
            title: entry.title,
            content: fullContent,
            summary: entry.updated ? `Gepubliceerd: ${entry.updated}` : '',
          });
          if (result.saved) saved++; else skipped++;
        } catch (err) {
          errors++;
          console.error(`Fout bij uitspraak "${entry.id}":`, err.message);
        }
      }
    } catch (err) {
      errors++;
      console.error(`Fout bij feed ${feedUrl}:`, err.message);
    }
  }

  logResult(`Rechtspraak — Amersfoort (gefilterd: ${filtered})`, saved, skipped, errors);
}

scrape().catch(console.error);
