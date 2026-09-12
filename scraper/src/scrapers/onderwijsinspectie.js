// onderwijsinspectie.js — toezichtresultaten Amersfoort en Leusden
//
// Herbouwd op 9 augustus 2026. Wat hier stond was sinds 28 mei een lege huls: het
// logde 0/0/0 zonder één verzoek te doen, met als reden dat
// toezichtresultaten.onderwijsinspectie.nl een Angular-SPA is zonder klikbare
// links naar detailpagina's. Dat klopt voor de HTML, maar de SPA praat met een
// gewone JSON-API die zonder sleutel en zonder browser bereikbaar is:
//
//   /api/zoek/elementen?search=Amersfoort&page=N&sector=&oordeel=&oordeelGemeente=&predicaat=
//       gepagineerd (5 per pagina), instellingen in Amersfoort en Leusden: scholen,
//       besturen, mbo, hbo, samenwerkingsverbanden en de gemeente zelf
//   /api/ws/vigerend-oordeel/{elementId}?expanded=false
//       het geldende oordeel plus de onderzoeken waar rapporten bij horen
//   /api/detail/rapporten-bij-onderzoeken/{onderzoekId}
//       de rapporten: nummer, soort onderzoek en vaststellingsdatum
//
// Er is geen feed van "recent gepubliceerd", dus de bron wordt uitgeput door alle
// instellingen langs te lopen. Dat zijn enkele honderden verzoeken per run; met 250 ms
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
import { pathToFileURL } from 'node:url';

const BASIS = 'https://toezichtresultaten.onderwijsinspectie.nl';
const SOURCE_NAME = 'Onderwijsinspectie — toezichtresultaten Amersfoort en Leusden';
// LET OP: deze URL is de sleutel waarop getOrCreateSource de bestaande bronrij
// terugvindt. Niet wijzigen zonder de rij in `sources` mee te verhuizen — een
// andere url maakt een tweede bronrij aan.
const SOURCE_URL = `${BASIS}/zoek?sector=PO&q=Amersfoort`;
const LOCAL_PLACES = ['Amersfoort', 'Leusden'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VENSTER_DAGEN = 730;
const PAUZE_MS = 250;

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(pad, fetchImpl = fetch) {
  const resp = await fetchImpl(BASIS + pad, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} op ${pad}`);
  const tekst = await resp.text();
  return tekst ? JSON.parse(tekst) : null;
}

// "23-04-2026" → Date
export function parseDatum(nl) {
  const m = (nl ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null;
}

export async function haalInstellingen(fetchImpl = fetch, pauseMs = PAUZE_MS) {
  const uniek = new Map();
  const perPlaats = {};
  for (const plaats of LOCAL_PLACES) {
    const lokaleIds = new Set();
    for (let p = 0; p < 40; p++) {
      const pagina = await json(`/api/zoek/elementen?search=${encodeURIComponent(plaats)}&page=${p}&sector=&oordeel=&oordeelGemeente=&predicaat=`, fetchImpl);
      if (!pagina || !Array.isArray(pagina.content)) break;
      for (const element of pagina.content) {
        if (element.town !== plaats || element.vervallen) continue;
        const id = Number(element.id);
        uniek.set(id, element);
        lokaleIds.add(id);
      }
      if (pagina.last) break;
      await pauze(pauseMs);
    }
    perPlaats[plaats] = lokaleIds.size;
  }
  return { instellingen: [...uniek.values()], perPlaats };
}

function detailUrl(el) {
  return `${BASIS}/detail?id=${el.id}&pseudocode=${encodeURIComponent(el.pseudocode ?? '')}`;
}

export function beschrijfOordeel(oordeel, indicatoren) {
  const delen = [];
  if (oordeel?.effectieveWaardeomschrijving) {
    delen.push(`Geldend oordeel: ${oordeel.effectieveWaardeomschrijving}${oordeel.dimensieomschrijving ? ` (${oordeel.dimensieomschrijving})` : ''}.`);
  }
  for (const ind of Object.values(indicatoren ?? {})) {
    if (ind?.indicatoromschrijving && ind?.indicatorscoreomschrijving) {
      delen.push(`${ind.indicatoromschrijving}: ${ind.indicatorscoreomschrijving}.`);
    }
  }
  if (oordeel?.helptekst) delen.push(oordeel.helptekst.trim());
  return delen.join(' ');
}

export function selecteerRapporten(rapporten) {
  const uniek = new Map();
  for (const rapport of rapporten ?? []) {
    if (!rapport?.rapportnummer) continue;
    uniek.set(String(rapport.rapportnummer), rapport);
  }
  const perDatum = new Map();
  for (const rapport of uniek.values()) {
    const datum = String(rapport.vaststellingsdatum || 'onbekend');
    if (!perDatum.has(datum)) perDatum.set(datum, []);
    perDatum.get(datum).push(rapport);
  }
  const geselecteerd = [];
  for (const groep of perDatum.values()) {
    const inhoudelijk = groep.filter(rapport =>
      !String(rapport.publicatienaam || '').toLowerCase().includes('samenvattend rapport voor ouders'));
    geselecteerd.push(...(inhoudelijk.length > 0 ? inhoudelijk : groep));
  }
  return geselecteerd.sort((a, b) =>
    String(a.vaststellingsdatum || '').localeCompare(String(b.vaststellingsdatum || '')) ||
    Number(a.rapportnummer) - Number(b.rapportnummer));
}

export async function scrape({ database = db, fetchImpl = fetch, dryRun = false, pauseMs = PAUZE_MS } = {}) {
  let sourceId = null;
  if (!dryRun) {
    sourceId = await getOrCreateSource(database, {
      name: SOURCE_NAME,
      url: SOURCE_URL,
      sourceType: 'scrape',
      reliability: 'primary',
      category: 'registry',
      scrapeFrequency: 'weekly',
    });
    await database.execute({
      sql: `UPDATE sources
            SET name=?, category='registry', reliability='primary', is_active=1
            WHERE id=?`,
      args: [SOURCE_NAME, sourceId],
    });
  }

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;
  const grens = new Date(Date.now() - VENSTER_DAGEN * 86400000);
  const gezien = new Set();
  let perPlaats = {};

  try {
    const opgehaald = await haalInstellingen(fetchImpl, pauseMs);
    const instellingen = opgehaald.instellingen;
    perPlaats = opgehaald.perPlaats;
    for (const plaats of LOCAL_PLACES) {
      if (!perPlaats[plaats]) throw new Error(`Zoek-API gaf nul actuele instellingen in ${plaats} — opbouw gewijzigd?`);
    }
    console.log(`Onderwijsinspectie: ${instellingen.length} instellingen (${LOCAL_PLACES.map(plaats => `${plaats} ${perPlaats[plaats]}`).join(', ')})`);

    for (const el of instellingen) {
      let oordeelData;
      try {
        oordeelData = await json(`/api/ws/vigerend-oordeel/${el.id}?expanded=false`, fetchImpl);
      } catch (err) {
        errors++;
        console.error(`Oordeel ${el.naam}: ${err.message}`);
        continue;
      }
      await pauze(pauseMs);
      if (!oordeelData) continue;

      const oordeelTekst = beschrijfOordeel(oordeelData.oordeel, oordeelData.indicatoren);
      const adres = [el.street, el.houseNo, el.houseNoAddition, el.postalcode, el.town].filter(Boolean).join(' ');
      const bestuur = el.bevoegdGezag?.naam || null;

      for (const onderzoekId of oordeelData.onderzoekenVoorRapporten ?? []) {
        let rapporten;
        try {
          rapporten = await json(`/api/detail/rapporten-bij-onderzoeken/${onderzoekId}`, fetchImpl);
        } catch (err) {
          errors++;
          console.error(`Rapporten ${el.naam}: ${err.message}`);
          continue;
        }
        await pauze(pauseMs);

        for (const rap of selecteerRapporten(rapporten)) {
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

          if (dryRun) {
            skipped++;
            continue;
          }
          try {
            const externalUrl = `${detailUrl(el)}#rapport-${rap.rapportnummer}`;
            const bestaand = await database.execute({
              sql: 'SELECT id FROM raw_items WHERE source_id=? AND external_url=? LIMIT 1',
              args: [sourceId, externalUrl],
            });
            if (bestaand.rows.length > 0) {
              skipped++;
              continue;
            }
            const result = await saveRawItem(database, {
              sourceId,
              externalUrl,
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

  const result = { found: gevonden, saved, skipped, errors, institutions: perPlaats };
  if (!dryRun) await logResult(database, sourceId, SOURCE_NAME, saved, skipped, errors, gevonden);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  scrape({ dryRun: process.argv.includes('--dry-run') })
    .then(result => console.log(`[Onderwijsinspectie] Resultaat: ${JSON.stringify(result)}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
