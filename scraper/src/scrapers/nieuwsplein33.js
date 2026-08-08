// nieuwsplein33.js — Nieuwsplein33 via de RSS-feed
//
// Was: Playwright op https://www.nieuwsplein33.nl/amersfoort, met alleen titel en
// URL en een lege content. Dat is om drie redenen vervangen door de feed op
// https://www.nieuwsplein33.nl/rss/nieuws.xml:
//
//   1. De feed geeft `pubDate`. De browserscraper had helemaal geen publicatiedatum.
//      Let op: die datum staat nu in de itemtekst, niet in een kolom — saveRawItem
//      uit utils.js kent geen scraped_at-parameter en `raw_items` heeft geen veld
//      voor de publicatiedatum. Voor de weger is de datum daarmee leesbaar, maar
//      een tijdreeks bouwen op een kolom kan nog niet. Dat is hetzelfde punt dat
//      bij de bekendmakingen speelt en het verdient een eigen blok.
//   2. De feed geeft een lead van een paar honderd tekens. Nieuwsplein33 is de
//      spiegel waartegen wordt ontdubbeld en waarmee het succescriterium van de
//      testperiode wordt gemeten. Met alleen koppen is die spiegelcheck zwak;
//      de weger noteerde bij zijn eerste run dat hij geen enkel artikel volledig
//      had kunnen lezen.
//   3. De feed dekt Amersfoort én Leusden. De oude ingang stond op /amersfoort,
//      terwijl Leusden de helft van het gebied van de redactie is.
//
// Let op: /rss-feed is een gewone HTML-pagina, niet de feed. De feed zelf staat
// op /rss/nieuws.xml; die URL staat als alternate in de broncode van die pagina.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const FEED_URL = 'https://www.nieuwsplein33.nl/rss/nieuws.xml';
const UA = 'Stadsgeest/1.0 (persbureau Amersfoort)';

function pak(blok, tag) {
  const m = blok.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  return m[1]
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function haalFeed() {
  const r = await fetch(FEED_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} op ${FEED_URL}`);
  return r.text();
}

function leesItems(xml) {
  const blokken = xml.split('<item>').slice(1);
  const items = [];
  for (const ruw of blokken) {
    const blok = ruw.split('</item>')[0];
    const titel = pak(blok, 'title');
    const link = pak(blok, 'link');
    if (!titel || !link) continue;
    items.push({
      titel,
      link,
      beschrijving: pak(blok, 'description'),
      rubriek: pak(blok, 'category'),
      gepubliceerd: pak(blok, 'pubDate'),
    });
  }
  return items;
}

function naarIso(pubDate) {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Nieuwsplein33 Amersfoort',
    // De bestaande bronrij staat op /amersfoort en wordt op url gematcht. Die URL
    // blijft dus staan, anders ontstaat er een tweede bronrij en zijn we terug bij
    // het ontdubbelen van vanochtend.
    url: 'https://www.nieuwsplein33.nl/amersfoort',
    sourceType: 'rss',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'daily',
  });

  let items = [];
  try {
    items = leesItems(await haalFeed());
  } catch (err) {
    console.error(`[NP33] feed ophalen mislukt: ${err.message}`);
    await logResult(db, sourceId, 'Nieuwsplein33 Amersfoort', 0, 0, 1, 0);
    return;
  }

  let opgeslagen = 0;
  let overgeslagen = 0;
  let fouten = 0;

  for (const item of items) {
    try {
      const regels = [
        item.beschrijving,
        '',
        item.gepubliceerd ? `Gepubliceerd: ${item.gepubliceerd}` : null,
        item.rubriek ? `Rubriek: ${item.rubriek}` : null,
        'Bron: Nieuwsplein33. Dit is een spiegelbron — wat hier staat is geen tip.',
      ].filter((r) => r !== null);

      const r = await saveRawItem(db, {
        sourceId,
        externalUrl: item.link,
        title: item.titel,
        content: regels.join('\n'),
        summary: item.beschrijving.substring(0, 500),
      });
      if (r.saved) opgeslagen++;
      else overgeslagen++;
    } catch (err) {
      fouten++;
      console.error(`[NP33] fout bij "${item.titel.substring(0, 60)}": ${err.message}`);
    }
  }

  console.log(`[NP33] ${items.length} items in de feed, ${opgeslagen} nieuw`);
  await logResult(db, sourceId, 'Nieuwsplein33 Amersfoort', opgeslagen, overgeslagen, fouten, items.length);
}

scrape().catch(console.error);
