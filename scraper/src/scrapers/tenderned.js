// tenderned.js — TenderNed aanbestedingen gefilterd op Amersfoort
// Herzien 2026-08-23. De RSS-feed (/rss/laatste-publicatie.rss) bevat slechts
// ~31 landelijke items en roteert Amersfoort-publicaties er binnen uren af.
// Overgestapt op de paginated JSON API met datumfiltering: alle publicaties van
// de laatste 3 dagen worden opgehaald en client-side gefilterd op Amersfoort-
// gerelateerde trefwoorden.
//
// De open JSON-API (geen sleutel nodig):
//   /papi/tenderned-rs-tns/v2/publicaties?page=0&size=100&publicatieDatumVanaf=...
//   /papi/tenderned-rs-tns/v2/publicaties/{publicatieId}        → metadata
//   /papi/tenderned-rs-tns/v2/publicaties/{publicatieId}/pdf    → de publicatie-PDF
// De metadata geeft opdrachtgever, beschrijving, procedure en publicatiedatum;
// de PDF bevat bij gunningen de contractant en de waarde.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const API_BASE = 'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';
const PAGE_SIZE = 100;
const DAGEN_TERUG = 3; // vangt weekenden op

// Trefwoorden waarmee we publicaties filteren. Alles lowercase.
// 'amersfoort' vangt ook 'gemeente amersfoort' en 'regio amersfoort' op.
const KEYWORDS = [
  'amersfoort',       // gemeente, regio, stad
  'eemland',          // Archief Eemland, Bibliotheek Eemland, regionaal
  'meander medisch',  // Meander Medisch Centrum
];

// pdfjs alleen laden als er echt een gunnings-PDF langskomt (zelfde patroon
// als fetch-fulltext.js: legacy build, dynamische import want ESM).
let pdfjsCache = null;
async function getPdfjs() {
  if (!pdfjsCache) pdfjsCache = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsCache;
}

async function pdfNaarTekst(buffer, maxPaginas = 20) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const delen = [];
  const tot = Math.min(doc.numPages, maxPaginas);
  for (let p = 1; p <= tot; p++) {
    const page = await doc.getPage(p);
    const inhoud = await page.getTextContent();
    delen.push(inhoud.items.map(i => i.str).join(' '));
  }
  await doc.destroy();
  return delen.join('\n').replace(/\s+/g, ' ').trim();
}

// Datumstring YYYY-MM-DD voor n dagen geleden
function datumMinDagen(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// Haal alle publicaties op van de laatste DAGEN_TERUG dagen via de paginated API.
// Retourneert een array van publicatie-objecten.
async function fetchAllePublicaties() {
  const vanaf = datumMinDagen(DAGEN_TERUG);
  const tot = new Date().toISOString().split('T')[0];
  const alle = [];
  let page = 0;
  let laatstePagina = false;

  while (!laatstePagina) {
    const url = `${API_BASE}?page=${page}&size=${PAGE_SIZE}`
      + `&publicatieDatumVanaf=${vanaf}&publicatieDatumTot=${tot}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`TenderNed API HTTP ${response.status} (pagina ${page})`);
    }

    const data = await response.json();
    const items = data.content || [];
    alle.push(...items);

    laatstePagina = data.last === true || items.length < PAGE_SIZE;
    page++;

    // Veiligheidsklep: nooit meer dan 30 pagina's (3000 items)
    if (page >= 30) {
      console.warn('TenderNed: veiligheidsklep na 30 pagina\'s');
      break;
    }

    // Kort wachten tussen pagina's om de API niet te overbelasten
    if (!laatstePagina) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`TenderNed: ${alle.length} publicaties opgehaald (${vanaf} t/m ${tot}, ${page} pagina's)`);
  return alle;
}

// Filter publicaties op Amersfoort-gerelateerde trefwoorden.
// Controleert opdrachtgeverNaam, aanbestedingNaam en opdrachtBeschrijving.
function filterOpAmersfoort(publicaties) {
  return publicaties.filter(p => {
    const tekst = [
      p.opdrachtgeverNaam || '',
      p.aanbestedingNaam || '',
      p.opdrachtBeschrijving || '',
    ].join(' ').toLowerCase();

    return KEYWORDS.some(kw => tekst.includes(kw));
  });
}

// Metadata van de individuele publicatie-API. Geeft null als de API niet
// antwoordt; de scraper valt dan terug op de lijstgegevens.
async function fetchPapi(publicatieId) {
  try {
    const r = await fetch(`${API_BASE}/${publicatieId}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Contractant en waarde uit de tekst van een gunnings-PDF (eForms-opmaak).
function gunningUitTekst(tekst) {
  const uit = [];
  const winnaar = tekst.match(/(?:Officiële naam|Naam van de winnaar|De winnaar)\s*:\s*(.{3,120}?)(?=\s+(?:Inschrijving|Identificatiecode|Postadres|Plaats|Postcode|NUTS|Land|E-mail|Telefoon|Website|Rol|Winnaar|Onderaanneming|De omvang)\b|$)/i);
  if (winnaar) uit.push(`Contractant volgens de publicatie: ${winnaar[1].replace(/[|:]+\s*$/, '').trim()}`);
  const waarde = tekst.match(/(?:Maximumwaarde van de raamovereenkomst|Waarde van de aanbesteding|Totale waarde(?: van de aanbesteding)?|Waarde van de resultaten|Waarde van alle contracten)\s*:?\s*([\d.,]+)\s*(?:Euro|EUR|€)/i);
  if (waarde) uit.push(`Waarde volgens de publicatie: ${waarde[1]} euro (let op: aanbesteders vullen hier soms een symbolisch bedrag in)`);
  return uit;
}

// De EF-codes van TenderNed.
const EF_SOORTEN = {
  EF29: 'Gunning',
  EF16: 'Aanbesteding',
  EFE3: 'Aanbesteding',
  EF02: 'Vooraankondiging',
  EF03: 'Gunning',
  EF04: 'Marktconsultatie',
  EF25: 'Rectificatie',
};

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'TenderNed (Amersfoort)',
    url: API_BASE,
    sourceType: 'api',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'daily',
  });

  let saved = 0, skipped = 0, errors = 0;

  const allePublicaties = await fetchAllePublicaties();
  const matches = filterOpAmersfoort(allePublicaties);

  console.log(`TenderNed: ${matches.length} Amersfoort-gerelateerde publicaties gevonden`);

  for (const pub of matches) {
    try {
      const publicatieId = pub.publicatieId || pub.kenmerk;
      const papi = publicatieId ? await fetchPapi(publicatieId) : null;
      await new Promise(r => setTimeout(r, 1000));

      const efCode = pub.publicatiecode?.code
        || papi?.publicatieCode
        || '';
      const soort = EF_SOORTEN[efCode.toUpperCase()] || pub.typePublicatie?.omschrijving || '';
      const titel = soort ? `${soort}: ${pub.aanbestedingNaam}` : pub.aanbestedingNaam;

      const externalUrl = pub.link?.href
        || `https://www.tenderned.nl/aankondigingen/overzicht/${publicatieId}`;

      const regels = [pub.opdrachtBeschrijving || ''];
      if (papi) {
        regels.push(
          '',
          `Opdrachtgever: ${papi.opdrachtgeverNaam || pub.opdrachtgeverNaam || 'onbekend'}.`,
          papi.typePublicatie ? `Type publicatie: ${papi.typePublicatie} (${efCode}).` : '',
          papi.procedureCode?.omschrijving ? `Procedure: ${papi.procedureCode.omschrijving}.` : '',
          papi.typeOpdrachtCode?.omschrijving ? `Soort opdracht: ${papi.typeOpdrachtCode.omschrijving}.` : '',
          papi.cpvCodes?.length ? `CPV: ${papi.cpvCodes.map(c => `${c.code} ${c.omschrijving}`).join('; ')}.` : '',
          papi.opdrachtBeschrijving ? `Beschrijving: ${papi.opdrachtBeschrijving}` : '',
        );
      } else {
        // Fallback: gebruik de gegevens uit de lijstrespons
        regels.push(
          '',
          `Opdrachtgever: ${pub.opdrachtgeverNaam || 'onbekend'}.`,
          pub.typePublicatie?.omschrijving ? `Type publicatie: ${pub.typePublicatie.omschrijving}.` : '',
          pub.procedure?.omschrijving ? `Procedure: ${pub.procedure.omschrijving}.` : '',
          pub.typeOpdracht?.omschrijving ? `Soort opdracht: ${pub.typeOpdracht.omschrijving}.` : '',
        );
      }

      // Bij een gunning: PDF ophalen voor contractant en waarde
      const isGunning = soort === 'Gunning' || papi?.isGegund === true;
      if (isGunning && publicatieId) {
        try {
          const p = await fetch(`${API_BASE}/${publicatieId}/pdf`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(25000),
          });
          if (p.ok) {
            const pdfTekst = await pdfNaarTekst(Buffer.from(await p.arrayBuffer()));
            const details = gunningUitTekst(pdfTekst);
            if (details.length) regels.push('', ...details);
            regels.push('', `Uit de publicatie-PDF: ${pdfTekst.substring(0, 2500)}`);
          }
        } catch (e) {
          console.error(`PDF van publicatie ${publicatieId}: ${e.message}`);
        }
      }

      const toelichting = soort
        ? `\n\nToelichting Stadsgeest: publicatietype ${efCode} betekent "${soort.toLowerCase()}". `
          + (soort === 'Gunning'
            ? 'Bij een gunningsaankondiging ligt de sluitingsdatum per definitie in het verleden; '
              + 'dat is geen datafout. De opdracht is gegund, en de vraag is aan wie.'
            : 'De sluitingsdatum hoort hier in de toekomst te liggen.')
        : '';

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl,
        title: titel,
        content: (regels.filter(r => r !== '').length ? regels.join('\n') : pub.opdrachtBeschrijving || '').substring(0, 9000) + toelichting,
        summary: (pub.opdrachtBeschrijving || '').substring(0, 500),
        publishedAt: papi?.publicatieDatum || pub.publicatieDatum || null,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${pub.aanbestedingNaam}":`, err.message);
    }
  }

  await logResult(db, sourceId, 'TenderNed (Amersfoort)', saved, skipped, errors, matches.length);
}

scrape().catch(console.error);
