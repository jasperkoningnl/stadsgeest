// UWV ArbeidsmarktInZicht — Amersfoort
//
// Herschreven op 9 augustus 2026. Wat hier stond scrapete
// https://arbeidsmarktinzicht.nl/amersfoort op links naar publicaties. Dat kon
// niet werken: /amersfoort is geen editie van die site. De edities zijn Nederland,
// negen provincies en twaalf arbeidsmarktregio's — Amersfoort zit daar niet bij.
// Elke onbekende URL levert de generieke Nederland-pagina op, zonder één link naar
// Amersfoort. De scraper viel daardoor elke dag in zijn eigen noodgreep en schreef
// de pagina zelf weg met een datum-anker: 96 items, alle 96 met lege content.
// Die noodgreep is hier verwijderd.
//
// De gemeentecijfers bestaan wel, op een ander adres:
//   https://arbeidsmarktinzicht.nl/content/data/bycity?community=263   (263 = Amersfoort)
// Die pagina toont één grafiek, "Lopende WW-uitkeringen", met UWV als bron. De
// grafiek zelf is een iframe (/charts/get/2279) dat zijn data ophaalt met een POST
// naar /charts/csvcached. Dat endpoint geeft kale CSV terug en is zonder browser
// te bereiken: haal de HTML van het iframe op, lees het attribuut data-query, en
// stuur dat als `json=` naar csvcached.
//
// Eén valkuil daarin, uitgezocht door het browserverkeer te vergelijken met een
// kale fetch: in de HTML staat de beroepsdimensie voorgevuld als `51519~Totaal›`,
// en met die waarde geeft csvcached alleen een kopregel terug. De werkende waarde
// is `51519~Beroepsklasse›`. Daarom wordt het filter hieronder expliciet gezet in
// plaats van overgenomen.
//
// LET OP: de bron-URL blijft https://arbeidsmarktinzicht.nl/amersfoort, ook al is
// dat niet de pagina die we uitlezen. getOrCreateSource matcht op url, niet op
// naam; een andere url hier maakt een tweede bronrij aan naast rij 27. Dat is
// precies hoe rij 128 (Raad van State) is ontstaan.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://arbeidsmarktinzicht.nl/amersfoort';   // alleen bronsleutel, zie boven
const COMMUNITY_ID = 263;                                        // Amersfoort in de gemeenteselectie
const GEMEENTE_PAGINA = `https://arbeidsmarktinzicht.nl/content/data/bycity?community=${COMMUNITY_ID}`;
const CHART_ID = 2279;                                           // Lopende WW-uitkeringen
const CHART_URL = `https://arbeidsmarktinzicht.nl/charts/get/${CHART_ID}`
  + `?style=HideFilters&title=False&showDataSource=False&region=4&community=${COMMUNITY_ID}`;
const CSV_URL = 'https://arbeidsmarktinzicht.nl/charts/csvcached';
const FILTER = 'f51520=51519~Beroepsklasse›51520~Totaal›'
  + '&f51521=51521~Lopend›'
  + '&f51518=51517~Gemeente›51518~Amersfoort›';

// Hoeveel maanden per run worden aangeboden. UWV publiceert maandelijks, dus na de
// eerste run is er hooguit één nieuwe maand. Drie is de marge voor gemiste runs;
// de rest wordt door de dedup in saveRawItem als duplicaat afgevangen.
const MAANDEN_PER_RUN = 3;

const MAAND_NR = {
  januari: '01', februari: '02', maart: '03', april: '04', mei: '05', juni: '06',
  juli: '07', augustus: '08', september: '09', oktober: '10', november: '11', december: '12',
};

async function haalCsv() {
  const resp = await fetch(CHART_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} op ${CHART_URL}`);
  const $ = cheerio.load(await resp.text());
  const query = $('[data-query]').attr('data-query');
  if (!query) throw new Error('Geen data-query in de grafiek-HTML — opbouw van de pagina is gewijzigd');

  const config = JSON.parse(query);
  config.filter = FILTER;

  const csvResp = await fetch(CSV_URL, {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: CHART_URL,
    },
    body: 'json=' + encodeURIComponent(JSON.stringify(config)),
    signal: AbortSignal.timeout(20000),
  });
  if (!csvResp.ok) throw new Error(`HTTP ${csvResp.status} op csvcached`);
  return csvResp.text();
}

// "2026 Juni;1924.00" → { periode: '2026 Juni', jaar: 2026, maand: '06', aantal: 1924 }
function parseCsv(csv) {
  const regels = csv.trim().split(/\r?\n/);
  if (regels.length < 2) {
    throw new Error('csvcached gaf alleen een kopregel terug — filter of chart-id klopt niet meer');
  }
  const rijen = [];
  for (const regel of regels.slice(1)) {
    const [periode, waarde] = regel.split(';');
    const m = (periode ?? '').trim().match(/^(\d{4})\s+(\w+)$/);
    const aantal = Number.parseFloat(waarde);
    if (!m || !Number.isFinite(aantal)) continue;
    const maand = MAAND_NR[m[2].toLowerCase()];
    if (!maand) continue;
    // "2026 Juni" leest als "juni 2026"; de CSV zet het jaar voorop.
    rijen.push({
      periode: `${m[2].toLowerCase()} ${m[1]}`,
      jaar: Number(m[1]),
      maand,
      aantal: Math.round(aantal),
    });
  }
  if (rijen.length === 0) throw new Error('csvcached gaf rijen die niet te lezen zijn');
  return rijen;
}

function beschrijf(rijen, i) {
  const nu = rijen[i];
  const vorige = i > 0 ? rijen[i - 1] : null;
  const jaarEerder = i >= 12 ? rijen[i - 12] : null;
  const getal = (n) => n.toLocaleString('nl-NL');
  const verschil = (oud) => {
    const d = nu.aantal - oud.aantal;
    const pct = oud.aantal ? (d / oud.aantal) * 100 : 0;
    const teken = d > 0 ? '+' : '';
    return `${teken}${getal(d)} (${teken}${pct.toFixed(1).replace('.', ',')}%)`;
  };

  const delen = [
    `In ${nu.periode} liepen er in de gemeente Amersfoort ${getal(nu.aantal)} WW-uitkeringen.`,
  ];
  if (vorige) delen.push(`Ten opzichte van ${vorige.periode}: ${verschil(vorige)}.`);
  if (jaarEerder) delen.push(`Ten opzichte van ${jaarEerder.periode}: ${verschil(jaarEerder)}.`);
  delen.push('Bron: UWV, via ArbeidsmarktInZicht (Data per gemeente). Alle beroepsklassen, lopende uitkeringen.');
  return delen.join(' ');
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'UWV ArbeidsmarktInZicht Amersfoort',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'data',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;

  try {
    const rijen = parseCsv(await haalCsv());
    const vanaf = Math.max(0, rijen.length - MAANDEN_PER_RUN);

    for (let i = vanaf; i < rijen.length; i++) {
      const rij = rijen[i];
      gevonden++;
      try {
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: `${GEMEENTE_PAGINA}#ww-${rij.jaar}-${rij.maand}`,
          title: `WW-uitkeringen Amersfoort — ${rij.periode.toLowerCase()}: ${rij.aantal.toLocaleString('nl-NL')} lopend`,
          content: beschrijf(rijen, i),
          summary: `${rij.jaar}-${rij.maand}: ${rij.aantal} lopende WW-uitkeringen in Amersfoort (UWV)`,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Fout bij ${rij.periode}:`, err.message);
      }
    }
  } catch (err) {
    errors++;
    console.error(`[UWV ArbeidsmarktInZicht] ${err.message}`);
  }

  await logResult(db, sourceId, 'UWV ArbeidsmarktInZicht Amersfoort', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
