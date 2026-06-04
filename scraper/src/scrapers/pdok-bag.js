// PDOK BAG — Basisregistratie Adressen en Gebouwen, gemeente Amersfoort
// Gebruikt het WFS-endpoint op service.pdok.nl.
// Bbox Amersfoort (RD-New): 155000,457000,168000,470000
// Haalt recente panden op met bouwjaar/status als signaal voor nieuwbouw/sloop.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const WFS_URL = 'https://service.pdok.nl/lv/bag/wfs/v2_0';
// Amersfoort gemeentecode 0307, bbox in RD-New (EPSG:28992)
const AMERSFOORT_BBOX = '155000,457000,168000,470000';
const SOURCE_URL = 'https://service.pdok.nl/lv/bag/wfs/v2_0';

async function fetchPanden(count = 50) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: 'bag:pand',
    count: String(count),
    outputFormat: 'application/json',
    bbox: AMERSFOORT_BBOX,
  });

  const url = `${WFS_URL}?${params}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; StadsgeestScraper/1.0)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`WFS HTTP ${response.status}`);
  }

  return response.json();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'PDOK BAG Amersfoort',
    url: SOURCE_URL,
    sourceType: 'api',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0;

  try {
    const data = await fetchPanden(50);
    const features = data?.features || [];

    for (const feature of features) {
      const props = feature.properties || {};
      const id = props.identificatie || feature.id || '';
      const status = props.status || '';
      const bouwjaar = props.bouwjaar || '';
      const gebruiksdoel = props.gebruiksdoel || '';
      const url = props.rdf_seealso || `https://bagviewer.kadaster.nl/lvbag/bag-viewer/index.html#?pandidentificatie=${id}`;

      const title = `Pand ${id}${bouwjaar ? ` (${bouwjaar})` : ''}${status ? ` — ${status}` : ''}`;
      const content = `Identificatie: ${id} | Status: ${status} | Bouwjaar: ${bouwjaar} | Gebruiksdoel: ${gebruiksdoel}`;

      try {
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: url,
          title,
          content,
          summary: `${status}${gebruiksdoel ? ' | ' + gebruiksdoel : ''}`,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Fout bij pand "${id}":`, err.message);
      }
    }
  } catch (err) {
    errors++;
    console.error('Fout bij ophalen PDOK BAG:', err.message);
  }

  logResult('PDOK BAG Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
