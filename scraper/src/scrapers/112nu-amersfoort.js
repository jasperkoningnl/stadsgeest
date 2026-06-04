import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['description', 'description'],
    ],
  },
});
const FEED_URL = 'https://112-nu.nl/regio/gemeente-amersfoort/alles/0/rss';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: '112-nu Amersfoort',
    url: FEED_URL,
    sourceType: 'rss',
    reliability: 'signal',
    category: 'emergency',
    scrapeFrequency: 'daily',
  });

  const response = await fetch(FEED_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const xml = await response.text();
  const feed = await parser.parseString(xml);
  let saved = 0, skipped = 0, errors = 0;

  // Categorievertaling P2000 → leesbaar Nederlands
  const CATEGORY_LABELS = {
    AMB: 'Ambulance', POL: 'Politie', BRAND: 'Brandweer',
    GRIP: 'Grootschalig incident', VRU: 'Veiligheidsregio',
  };

  // Ambulance-meldingen (AMB) zijn te frequent en te weinig nieuwswaardig
  // om individueel als signaal op te slaan — sla ze over tenzij er een
  // bijzondere omschrijving in de titel zit (bijv. "reanimatie", "brand", "letsel")
  const AMB_KEYWORDS = /reanimat|brand|letsel|meerdere|kinderen?|school|instort|crash/i;

  for (const item of feed.items) {
    try {
      const cat = (item.categories?.[0] || item.category || '').toUpperCase().trim();

      // Filter standaard ambulance-runs zonder nieuwswaarde
      if (cat === 'AMB' && !AMB_KEYWORDS.test(item.title || '')) {
        skipped++;
        continue;
      }

      // Bouw een leesbare titel: "Politie — Aanrijding met letsel, Amersfoort"
      // De P2000-titel bevat de meldingstekst; description bevat prioriteit + locatie
      const catLabel = CATEGORY_LABELS[cat] || cat || 'Hulpdienst';
      const rawTitle = (item.title || '').trim();
      // Verwijder herhaalde urgentiewoorden aan het einde ("Met Grote Spoed" herhaling)
      const cleanedTitle = rawTitle.replace(/\s+(Met\s+(Grote\s+)?Spoed)\s*$/i, '').trim();
      const description = (item.description || item.contentSnippet || '').trim();

      // Gebruik cleaned title als die betekenisvol is, anders bouw uit category + description
      const title = cleanedTitle && cleanedTitle.length > 10
        ? `${catLabel} — ${cleanedTitle}`
        : description
          ? `${catLabel} — ${description}`
          : catLabel;

      const content = [cleanedTitle, description].filter(Boolean).join(' | ');

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title,
        content,
        summary: content.substring(0, 300),
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${item.title}":`, err.message);
    }
  }

  logResult('112-nu Amersfoort', saved, skipped, errors);
}

scrape().catch(console.error);
