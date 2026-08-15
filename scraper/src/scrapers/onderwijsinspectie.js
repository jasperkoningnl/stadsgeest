// onderwijsinspectie.js — toezichtresultaten Amersfoort
//
// Herbouwd op 9 augustus 2026. Wat hier stond was sinds 28 mei een lege huls: het
// logde 0/0/0 zonder één verzoek te doen, met als reden dat
// toezichtresultaten.onderwijsinspectie.nl een Angular-SPA is zonder klikbare
// links naar detailpagina's. Dat klopt voor de HTML, maar de SPA praat met een
// gewone JSON-API die zonder sleutel en zonder browser bereikbaar is:
//
//   /api/zoek/elementen?search=Amersfoort&page=N&sector=&oordeel=&oordeelGemeente=&predicaat=
//       gepagineerd (5 per pagina), 95 instellingen in Amersfoort: scholen,
//       besturen, mbo, hbo, samenwerkingsverbanden en de gemeente zelf
//   /api/ws/vigerend-oordeel/{elementId}?expanded=false
//       het geldende oordeel plus de onderzoeken waar rapporten bij horen
//   /api/detail/rapporten-bij-onderzoeken/{onderzoekId}
//       de rapporten: nummer, soort onderzoek en vaststellingsdatum
//
// Er is geen feed van "recent gepubliceerd", dus de bron wordt uitgeput door alle
// instellingen langs te lopen. Dat zijn ongeveer 150 verzoeken per run; met 250 ms
// ertussen blijft dat ruim binnen de drie minuten die run-browser.js toestaat.
//
// VENSTER. Gemeten op 9 augustus 2026 hangen er 51 rapporten aan Amersfoortse
// instellingen, waarvan 7 uit het afgelopen jaar en 16 uit de afgelopen twee jaar.
// Alles ineens wegschrijven is een backfill van 51 items en dat is precies de
// uitschieter waar START-HIER.md voor waarschuwt. Daarom een venster van twee jaar:
// eenmalig 16 items, daarna ongeveer zeven per jaar.
//
// Deze scraper heeft geen Playwright nodig. Hij blijft in run-browser.js staan
// omdat scrapers niet uit runnerlijsten worden gehaald; hij is daar alleen sneller
// klaar dan de rest.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BASIS = 'https://toezichtresultaten.onderwijsinspectie.nl';
// LET OP: deze URL is de sleutel waarop getOrCreateSource de bestaande bronrij
// terugvindt. Niet wijzigen zonder de rij in `sources` mee te verhuizen — een
// andere url maakt een tweede bronrij aan.
const SOURCE_URL = `${BASIS}/zoek?sector=PO&q=Amersfoort`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VENSTER_DAGEN = 730;
const PAUZE_MS = 250;

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(pad) {
  const resp = await fetch(BASIS + pad, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} op ${pad}`);
  const tekst = await resp.text();
  return tekst ? JSON.parse(tekst) : null;
}

// "23-04-2026" → Date
function parseDatum(nl) {
  const m = (nl ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null;
}

async function haalInstellingen() {
  const uit = [];
  for (let p = 0; p < 40; p++) {
    const pagina = await json(`/api/zoek/elementen?search=Amersfoort&page=${p}&sector=&oordeel=&oordeelGemeente=&predicaat=`);
    if (!pagina || !Array.isArray(pagina.content)) break;
    uit.push(...pagina.content);
    if (pagina.last) break;
    await pauze(PAUZE_MS);
  }
  // De zoekterm matcht ook op bestuursnaam; alleen wat echt in Amersfoort staat.
  return uit.filter((e) => e.town === 'Amersfoort' && !e.vervallen);
}

function detailUrl(el) {
  return `${BASIS}/detail?id=${el.id}&pseudocode=${encodeURIComponent(el.pseudocode ?? '')}`;
}

function beschrijfOordeel(oordeel, indicatoren) {
  const delen = [];
  if (oordeel?.effectieveWaardeomschrijving) {
    delen.push(`Geldend oordeel: ${oordeel.effectieveWaardeomschrijving}${oordeel.dimensieomschrijving ? ` (${oordeel.dimensieomschrijving})` : ''}.`);
  }
  for (const ind of Object.values(indicatoren ?? {})) {
    if (ind?.indicatoromschrijving && ind?.indicatorscoreomschrijving) {
      delen.push(`${ind.indicatoromschrijving}: ${ind.indicatorscoreomschrijving}.`);
    }
  }
  return delen.join(' ');
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Onderwijsinspectie — toezichtresultaten Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'community',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;
  const grens = new Date(Date.now() - VENSTER_DAGEN * 86400000);
  const gezien = new Set();

  try {
    const instellingen = await haalInstellingen();
    if (instellingen.length === 0) throw new Error('Zoek-API gaf nul Amersfoortse instellingen — opbouw gewijzigd?');
    console.log(`Onderwijsinspectie: ${instellingen.length} instellingen in Amersfoort`);

    for (const el of instellingen) {
      let oordeelData;
      try {
        oordeelData = await json(`/api/ws/vigerend-oordeel/${el.id}?expanded=false`);
      } catch (err) {
        errors++;
        console.error(`Oordeel ${el.naam}: ${err.message}`);
        continue;
      }
      await pauze(PAUZE_MS);
      if (!oordeelData) continue;

      const oordeelTekst = beschrijfOordeel(oordeelData.oordeel, oordeelData.indicatoren);
      const adres = [el.street, el.houseNo, el.postalcode, el.town].filter(Boolean).join(' ');
      const bestuur = oordeelData.bestuur ? null : el.bevoegdGezag?.naam;

      for (const onderzoekId of oordeelData.onderzoekenVoorRapporten ?? []) {
        let rapporten;
        try {
          rapporten = await json(`/api/detail/rapporten-bij-onderzoeken/${onderzoekId}`);
        } catch (err) {
          errors++;
          continue;
        }
        await pauze(PAUZE_MS);

        for (const rap of rapporten ?? []) {
          const datum = parseDatum(rap.vaststellingsdatum);
          if (!datum || datum < grens) continue;
          const sleutel = `${el.id}|${rap.rapportnummer}`;
          if (gezien.has(sleutel)) continue;
          gezien.add(sleutel);
          gevonden++;

          const titel = `Onderwijsinspectie — ${rap.publicatienaam}: ${el.naam} (${rap.vaststellingsdatum})`;
          const inhoud = [
            `${rap.publicatienaam} bij ${el.naam}${el.sectoromschrijving ? `, ${el.sectoromschrijving.toLowerCase()}` : ''}, ${adres}.`,
            `Rapport vastgesteld op ${rap.vaststellingsdatum}, rapportnummer ${rap.rapportnummer}.`,
            bestuur ? `Bevoegd gezag: ${bestuur}.` : '',
            oordeelTekst,
            'Bron: Inspectie van het Onderwijs, toezichtresultaten.',
          ].filter(Boolean).join(' ');

          try {
            const result = await saveRawItem(db, {
              sourceId,
              externalUrl: `${detailUrl(el)}#rapport-${rap.rapportnummer}`,
              title: titel.substring(0, 500),
              content: inhoud,
              summary: `${rap.publicatienaam} — ${el.naam}, vastgesteld ${rap.vaststellingsdatum}`,
              publishedAt: datum,
            });
            if (result.saved) saved++; else skipped++;
          } catch (err) {
            errors++;
            console.error(`Opslaan ${el.naam}: ${err.message}`);
          }
        }
      }
    }
  } catch (err) {
    errors++;
    console.error(`[Onderwijsinspectie] ${err.message}`);
  }

  await logResult(db, sourceId, 'Onderwijsinspectie — toezichtresultaten Amersfoort', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
