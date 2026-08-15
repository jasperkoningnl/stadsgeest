// ibabs-woo.js — Bestuurlijke informatie gemeente Amersfoort (iBabs publieksportaal)
// Woo-verzoeken, klachten, convenanten, ruimtelijke procedures en adviezen.
//
// Gerepareerd op 9 augustus 2026. De bron stond op `empty` met negen runs deze week
// en nul items ooit. De oorzaak was één selector. Het dashboard rendert prima
// server-side en de tabel staat er gewoon, maar de titelcel is geen `<td>`:
//
//     <tr data-nav-url="/Reports/Item/8a0c…">
//       <th scope="row"><a href="/Reports/Item/8a0c…">alle voertuigen met kenteken…</a></th>
//       <td>Woo-verzoeken</td>
//       <td>06-08-2026</td>
//     </tr>
//
// De oude code zocht `td a` voor de titel en las soort en datum uit `td` 1 en 2.
// Met de titel in een `<th scope="row">` vond `td a` niets, viel elke rij af, en
// bleef `items` leeg — vandaar netjes gelogde nulruns zonder foutmelding. Nu wordt
// de link uit de rij zelf gehaald (`th a`, met `data-nav-url` als terugval) en
// staan soort en datum op `td` 0 en 1.
//
// Tweede wijziging: de detailpagina wordt opgehaald. De oude opzet zou als content
// alleen "Woo-verzoeken — 06-08-2026" hebben opgeslagen, en een item zonder inhoud
// is voor de intake net zo waardeloos als geen item. De detailpagina geeft
// zaaknummer, onderwerp, datum ontvangen en datum besluit.
//
// Het dashboard toont de tien meest gewijzigde items. Dat is genoeg voor een bron
// die dagelijks langskomt; de categorieoverzichten onder /Reports/Details vragen
// filterparameters en leveren zonder die parameters geen rijen.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BASE_URL = 'https://amersfoort.bestuurlijkeinformatie.nl';
const PAGE_URL = `${BASE_URL}/`;
const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const PAUZE_MS = 500;

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

async function haal(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} op ${url}`);
  return resp.text();
}

function leesDashboard(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('table tr').each((_, tr) => {
    const $tr = $(tr);
    const href = $tr.find('th a, td a').first().attr('href') || $tr.attr('data-nav-url') || '';
    const titel = $tr.find('th a, td a').first().text().replace(/\s+/g, ' ').trim();
    const cellen = $tr.find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (!href || !titel) return;
    const url = href.startsWith('http') ? href : BASE_URL + href;
    if (items.some((i) => i.url === url)) return;
    items.push({ url, titel, soort: cellen[0] ?? '', datum: cellen[1] ?? '' });
  });
  return items;
}

function leesDetail(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();
  const bron = $('main').first().length ? $('main').first() : $('body');
  return bron.text().replace(/\s+/g, ' ').replace(/^\s*Vorige pagina\s*/i, '').trim();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Bestuurlijke informatie gemeente Amersfoort (iBabs)',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;

  try {
    const items = leesDashboard(await haal(PAGE_URL));
    if (items.length === 0) {
      throw new Error('Geen rijen in de dashboardtabel — opbouw gewijzigd, controleer de selector (zie kop van dit bestand)');
    }
    gevonden = items.length;

    for (const item of items) {
      try {
        await pauze(PAUZE_MS);
        let detail = '';
        try {
          detail = leesDetail(await haal(item.url));
        } catch (err) {
          console.error(`Detailpagina ${item.url}: ${err.message}`);
        }
        const kop = [item.soort, item.datum ? `laatst gewijzigd ${item.datum}` : ''].filter(Boolean).join(', ');
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: item.url,
          title: `${item.soort ? `${item.soort}: ` : ''}${item.titel}`.substring(0, 500),
          content: (detail || kop).substring(0, 8000),
          summary: kop.substring(0, 500),
          publishedAt: item.datum || null,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Fout bij "${item.url}": ${err.message}`);
      }
    }
  } catch (err) {
    errors++;
    console.error(`[iBabs] ${err.message}`);
  }

  await logResult(db, sourceId, 'Bestuurlijke informatie Amersfoort (iBabs)', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
