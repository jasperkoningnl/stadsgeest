// leusder-krant.js — Leusder Krant (BDUmedia), spiegelbron voor Leusden.
// Toegevoegd 2026-10-02.
//
// Waarom: de Leusder Krant staat sinds augustus in docs/EDITORIAL-PROFILE.md
// als spiegelbron, maar had geen bronrij. Zonder deze feed kon de weger bij
// Leusdense tips niet controleren of het verhaal al was gebracht, terwijl
// "al bekend" een van de vaakst gebruikte afwijsredenen is.
//
// De RSS-feed geeft de vijftig nieuwste berichten met plaats tussen blokhaken
// vooraan de tekst ([LEUSDEN], [ACHTERVELD], soms [AMERSFOORT] of [REGIO]).
// Gemeten 2 oktober 2026: 34 Leusden, 8 Achterveld, 2 Amersfoort, 2 regio.
// Alles wordt bewaard: het is de krant van het Leusdense werkgebied.
//
// Spiegelbron: nooit dragend, alleen ontdubbeling en bevestiging (zie
// intake-run.mjs). De markering staat op de bronrij (bronrol = 'spiegel').
import Parser from 'rss-parser';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const FEED_URL = 'https://www.leusderkrant.nl/rss/feed';
const NAAM = 'Leusder Krant';
const DRY = process.env.LEUSDERKRANT_DRYRUN === '1';
const parser = new Parser({ headers: { 'User-Agent': UA }, timeout: 20000 });

async function scrape() {
  const feed = await parser.parseURL(FEED_URL);
  if (DRY) {
    for (const item of feed.items.slice(0, 10)) console.log(`  [dry] ${item.isoDate || item.pubDate} | ${item.title} | ${item.link}`);
    console.log(`leusder-krant: ${feed.items.length} items in de feed (dry-run, niets opgeslagen)`);
    return;
  }

  const sourceId = await getOrCreateSource(db, {
    name: NAAM, url: FEED_URL, sourceType: 'rss', reliability: 'secondary', category: 'local_news', scrapeFrequency: 'daily',
  });
  // Eén keer, bij de eerste run: spiegel, tier 3 (zoals De Stad Amersfoort en
  // RTV Utrecht) en werkgebied Leusden. Daarna blijft een handmatige keuze staan.
  await db.execute({
    sql: "UPDATE sources SET bronrol = 'spiegel', tier = 3, gemeente = 'Leusden' WHERE id = ? AND bronrol IS NULL",
    args: [sourceId],
  }).catch((e) => console.error('leusder-krant: bronrol niet gezet:', e.message));

  let saved = 0, skipped = 0, errors = 0;
  for (const item of feed.items) {
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title: item.title,
        content: item.contentSnippet || item.content || '',
        summary: item.contentSnippet || '',
        publishedAt: item.isoDate || item.pubDate || null,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`leusder-krant: fout bij "${item.title}":`, err.message);
    }
  }
  await logResult(db, sourceId, NAAM, saved, skipped, errors, feed.items.length);
}

scrape().then(() => process.exit(0)).catch((e) => { console.error('leusder-krant:', e.message); process.exit(1); });
