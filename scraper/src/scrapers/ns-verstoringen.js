// ns-verstoringen.js — NS verstoringen en werkzaamheden voor Amersfoort stations
// API: https://gateway.apiportal.ns.nl/reisinformatie-api/api/v3/disruptions/station/{code}
// Stations: AMF (Amersfoort Centraal), AMR (Amersfoort Vathorst)
import 'dotenv/config';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const KEY = process.env.NS_API_KEY;
const BASE = 'https://gateway.apiportal.ns.nl';
const SOURCE_URL = 'https://www.ns.nl/reisinformatie/storingen';

// Amersfoort station codes
const STATIONS = ['AMF', 'AMFS', 'AVAT']; // AMF = Centraal, AMFS = Schothorst, AVAT = Vathorst

async function fetchDisruptions(stationCode) {
  const url = `${BASE}/reisinformatie-api/api/v3/disruptions/station/${stationCode}`;
  const r = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    console.error(`NS API station/${stationCode} → HTTP ${r.status}`);
    return [];
  }
  return r.json();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'NS Verstoringen Amersfoort',
    url: SOURCE_URL,
    sourceType: 'api',
    reliability: 'primary',
    category: 'local_news',
    scrapeFrequency: 'hourly',
  });

  // Haal verstoringen op voor alle Amersfoort stations, dedup op id
  const seen = new Set();
  const disruptions = [];

  for (const code of STATIONS) {
    const items = await fetchDisruptions(code);
    for (const item of items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        disruptions.push(item);
      }
    }
  }

  let saved = 0, skipped = 0, errors = 0;

  for (const d of disruptions) {
    try {
      const typeLabel = d.type === 'MAINTENANCE' ? 'Werkzaamheden' : 'Verstoring';
      const situation = d.timespans?.[0]?.situation?.label || '';
      const cause = d.timespans?.[0]?.cause?.label || '';
      const extraTime = d.summaryAdditionalTravelTime?.label || '';
      const altTransport = d.timespans?.[0]?.alternativeTransport?.shortLabel || '';

      const title = `[NS] ${d.title}`;
      const content = [
        situation,
        d.period,
        extraTime,
        altTransport,
      ].filter(Boolean).join('\n\n');
      const summary = `${typeLabel}${cause ? ` (${cause})` : ''} — ${d.period || ''}`.trim();
      const externalUrl = `${SOURCE_URL}/${d.id}`;

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl,
        title,
        content,
        summary,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij NS verstoring ${d.id}:`, err.message);
    }
  }

  logResult('NS Verstoringen', saved, skipped, errors);
}

scrape().catch(console.error);
