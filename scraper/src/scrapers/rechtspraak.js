// Rechtspraak.nl — uitspraken met Amersfoort als zoekterm
// Gebruikt de Open Data Atom-feed: https://data.rechtspraak.nl/uitspraken/zoeken
// Volledige tekst via: https://data.rechtspraak.nl/uitspraken/content?id=[ECLI]
// Documentatie: https://www.rechtspraak.nl/Uitspraken/Paginas/Open-Data.aspx

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult, makeSummary } from '../utils.js';

// Strategie: drie feeds combineren
// 1. Rechtbank Midden-Nederland (RBMNE) — alle uitspraken. Dit is de bevoegde
//    rechtbank voor Amersfoort. Wordt ongefilterd opgeslagen: woonplaatsen zijn
//    geanonimiseerd, dus een tekstfilter op "Amersfoort" mist elke zaak tussen
//    particulieren uit Amersfoort.
// 2. Gerechtshof Arnhem-Leeuwarden (GHARL) — hoger beroep. Sinds 2026-08-17
//    NIET meer ongefilterd: het ressort beslaat naast Midden-Nederland ook
//    Gelderland, Overijssel, Friesland, Groningen en Drenthe. Van 213 opgeslagen
//    uitspraken bevatte er slechts één "Amersfoort" of "Leusden". GHARL-
//    uitspraken die Amersfoort of Leusden noemen komen alsnog binnen via de
//    q=Amersfoort-feed of via het relevantiefilter.
// 3. Vrije zoekterm "Amersfoort" — vangt colleges buiten RBMNE op die
//    Amersfoort in de tekst noemen.
const FEEDS = [
  'https://data.rechtspraak.nl/uitspraken/zoeken?creator=RBMNE&max=20&sort=desc',
  'https://data.rechtspraak.nl/uitspraken/zoeken?creator=GHARL&max=10&sort=desc',
  'https://data.rechtspraak.nl/uitspraken/zoeken?q=Amersfoort&max=20&sort=desc',
];
const SOURCE_URL = 'https://data.rechtspraak.nl/uitspraken/zoeken';
const CONTENT_URL = 'https://data.rechtspraak.nl/uitspraken/content';

// Alleen RBMNE wordt ongefilterd opgeslagen. GHARL is bewust verwijderd
// (zie toelichting hierboven).
const LOCAL_COURTS = new Set(['RBMNE']);

// Extraheer de rechtbankcode uit een ECLI (bijv. ECLI:NL:RBMNE:2026:716 → RBMNE)
function extractCourt(ecli) {
  const parts = (ecli || '').split(':');
  return parts.length >= 4 ? parts[2] : null;
}

// Controleer of de uitspraak voldoende betrekking heeft op Amersfoort of Leusden
function isAmersfoortRelevant(ecli, content) {
  const court = extractCourt(ecli);
  // Lokale rechtbank (RBMNE): altijd relevant — woonplaatsen zijn geanonimiseerd,
  // dus een tekstfilter mist per definitie elke zaak tussen particulieren.
  if (LOCAL_COURTS.has(court)) return true;
  // Andere rechtbanken (incl. GHARL): "Amersfoort" of "Leusden" moet minimaal
  // 1x voorkomen in de tekst. Drempel verlaagd van 2 naar 1 omdat woonplaatsen
  // geanonimiseerd zijn — als een van beide namen überhaupt voorkomt, is dat
  // vrijwel altijd een instelling, straat of gemeente en geen toeval.
  const matches = (content || '').match(/\b(?:amersfoort|leusden)\b/gi);
  return matches && matches.length >= 1;
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
              fullContent = ecliText.substring(0, 25000);
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
            summary: makeSummary(fullContent),
            publishedAt: entry.updated || null,
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

  await logResult(db, sourceId, `Rechtspraak — Amersfoort (gefilterd: ${filtered})`, saved, skipped, errors);
}

scrape().catch(console.error);
