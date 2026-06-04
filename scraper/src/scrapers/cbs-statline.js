import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

// RegioS-code voor Amersfoort is 'GM0307' (geen trailing spaties in de TypedDataSet)
const API_URL = "https://opendata.cbs.nl/ODataApi/odata/70072ned/TypedDataSet?$filter=RegioS eq 'GM0307'&$top=10&$orderby=Perioden desc&$format=json";

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'CBS StatLine — Amersfoort',
    url: 'https://opendata.cbs.nl/ODataApi/odata/70072ned/',
    sourceType: 'api',
    reliability: 'primary',
    category: 'data',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(API_URL);
  if (!response.ok) {
    console.error(`CBS API fout: ${response.status} ${response.statusText}`);
    return;
  }

  const data = await response.json();
  let saved = 0, skipped = 0, errors = 0;

  if (data.value && data.value.length > 0) {
    for (const row of data.value) {
      try {
        const title = `CBS Kerncijfers Amersfoort — ${row.Perioden?.trim()}`;
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: 'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/70072ned/table',
          title,
          content: JSON.stringify(row),
          summary: `Periode: ${row.Perioden?.trim()}, Bevolking: ${row.TotaleBevolking_1 ?? 'n.b.'}`,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error('Fout bij CBS-rij:', err.message);
      }
    }
  } else {
    console.warn('CBS: geen data ontvangen (controleer RegioS-filter)');
  }

  logResult('CBS StatLine', saved, skipped, errors);
}

scrape().catch(console.error);
