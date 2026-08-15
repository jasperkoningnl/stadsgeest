// tenderned.js — TenderNed aanbestedingen gefilterd op Amersfoort
// TenderNed levert een Atom-feed (niet RSS) — handmatige fetch + regex-parsing,
// net als rechtspraak.js. rss-parser kan het atom:-namespace formaat niet parsen.
//
// Herzien 2026-08-15. De aankondigingspagina op tenderned.nl is client-rendered
// en leverde via een kale fetch één woord op ("Aankondigingen"), waardoor
// opdrachtnemer, bedrag en looptijd van elke gunning onbekend bleven — de
// directe reden dat gunningen geen tip konden worden (STATUS.md, weger-run
// 13 augustus). Er is wél een open JSON-API zonder sleutel:
//   /papi/tenderned-rs-tns/v2/publicaties/{publicatieId}        → metadata
//   /papi/tenderned-rs-tns/v2/publicaties/{publicatieId}/pdf    → de publicatie-PDF
// De metadata geeft opdrachtgever, beschrijving, procedure en publicatiedatum;
// de PDF bevat bij gunningen de contractant en de waarde. Beide worden hier
// meegenomen, en de publicatiedatum vult published_at.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const FEED_URL = 'https://www.tenderned.nl/papi/tenderned-rs-tns/rss/laatste-publicatie.rss';
const PAPI = 'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties';
const KEYWORDS = ['amersfoort', 'gemeente amersfoort', 'regio amersfoort'];
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

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

async function fetchFeed() {
  const response = await fetch(FEED_URL, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/atom+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`TenderNed HTTP ${response.status}`);
  return response.text();
}

function parseAtomEntries(xml) {
  const entries = [];
  const blocks = xml.match(/<atom:entry>([\s\S]*?)<\/atom:entry>/g) || [];

  for (const block of blocks) {
    const title = (block.match(/<atom:title>([^<]+)<\/atom:title>/) || [])[1] || '';
    const linkMatch = block.match(/<atom:link[^>]+href="([^"]+)"/);
    const link = linkMatch ? linkMatch[1] : '';
    const summaryRaw = (block.match(/<atom:summary[^>]*>([\s\S]*?)<\/atom:summary>/) || [])[1] || '';
    const summary = summaryRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const updated = (block.match(/<atom:updated>([^<]+)<\/atom:updated>/) || [])[1] || '';

    if (!title || !link) continue;
    entries.push({ title, link, summary, updated });
  }

  return entries;
}

// Metadata van de open publicatie-API. Geeft null als de API niet antwoordt;
// de scraper valt dan terug op de feedgegevens.
async function fetchPapi(publicatieId) {
  try {
    const r = await fetch(`${PAPI}/${publicatieId}`, {
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
// Best effort: de PDF-opmaak wisselt per formulier, dus alles wat we vinden is
// winst en de ruwe tekst gaat als vangnet mee in het item.
function gunningUitTekst(tekst) {
  const uit = [];
  // De PDF-tekst is tot één regel platgeslagen; het volgende "Label :" markeert
  // dus het einde van de naam. Getest op publicatie 436079 (BDUlokalemedia B.V.).
  const winnaar = tekst.match(/(?:Officiële naam|Naam van de winnaar|De winnaar)\s*:\s*(.{3,120}?)(?=\s+(?:Inschrijving|Identificatiecode|Postadres|Plaats|Postcode|NUTS|Land|E-mail|Telefoon|Website|Rol|Winnaar|Onderaanneming|De omvang)\b|$)/i);
  if (winnaar) uit.push(`Contractant volgens de publicatie: ${winnaar[1].replace(/[|:]+\s*$/, '').trim()}`);
  const waarde = tekst.match(/(?:Maximumwaarde van de raamovereenkomst|Waarde van de aanbesteding|Totale waarde(?: van de aanbesteding)?|Waarde van de resultaten|Waarde van alle contracten)\s*:?\s*([\d.,]+)\s*(?:Euro|EUR|€)/i);
  if (waarde) uit.push(`Waarde volgens de publicatie: ${waarde[1]} euro (let op: aanbesteders vullen hier soms een symbolisch bedrag in)`);
  return uit;
}

// De EF-codes van TenderNed. Alleen de types die in Amersfoortse berichten
// voorkomen; onbekende codes laten de titel ongemoeid.
const EF_SOORTEN = {
  EF29: 'Gunning',
  EF16: 'Aanbesteding',
  EFE3: 'Aanbesteding',
  EF02: 'Vooraankondiging',
  EF03: 'Gunning',
};

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'TenderNed (Amersfoort)',
    url: FEED_URL,
    sourceType: 'rss',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'daily',
  });

  let saved = 0, skipped = 0, errors = 0;

  const xml = await fetchFeed();
  const entries = parseAtomEntries(xml);

  for (const entry of entries) {
    const text = `${entry.title} ${entry.summary}`.toLowerCase();
    if (!KEYWORDS.some(kw => text.includes(kw))) continue;

    try {
      const publicatieId = (entry.link.match(/(\d{5,})\s*$/) || [])[1] || null;
      const papi = publicatieId ? await fetchPapi(publicatieId) : null;
      await new Promise(r => setTimeout(r, 1000));

      const efType = papi?.publicatieCode
        || (entry.summary.match(/Type publicatie:\s*(EF[A-Z0-9]+)/i) || [])[1] || '';
      const soort = EF_SOORTEN[efType.toUpperCase()] || '';
      const titel = soort ? `${soort}: ${entry.title}` : entry.title;

      const regels = [entry.summary];
      if (papi) {
        regels.push(
          '',
          `Opdrachtgever: ${papi.opdrachtgeverNaam || 'onbekend'}.`,
          papi.typePublicatie ? `Type publicatie: ${papi.typePublicatie} (${efType}).` : '',
          papi.procedureCode?.omschrijving ? `Procedure: ${papi.procedureCode.omschrijving}.` : '',
          papi.typeOpdrachtCode?.omschrijving ? `Soort opdracht: ${papi.typeOpdrachtCode.omschrijving}.` : '',
          papi.cpvCodes?.length ? `CPV: ${papi.cpvCodes.map(c => `${c.code} ${c.omschrijving}`).join('; ')}.` : '',
          papi.opdrachtBeschrijving ? `Beschrijving: ${papi.opdrachtBeschrijving}` : '',
        );
      }

      // Bij een gunning zit het eigenlijke nieuws — wie kreeg de opdracht, voor
      // hoeveel — alleen in de publicatie-PDF. Die halen we erbij.
      const isGunning = soort === 'Gunning' || papi?.isGegund === true;
      if (isGunning && publicatieId) {
        try {
          const p = await fetch(`${PAPI}/${publicatieId}/pdf`, {
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
        ? `\n\nToelichting Stadsgeest: publicatietype ${efType} betekent "${soort.toLowerCase()}". `
          + (soort === 'Gunning'
            ? 'Bij een gunningsaankondiging ligt de sluitingsdatum per definitie in het verleden; '
              + 'dat is geen datafout. De opdracht is gegund, en de vraag is aan wie.'
            : 'De sluitingsdatum hoort hier in de toekomst te liggen.')
        : '';

      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: entry.link,
        title: titel,
        content: (regels.filter(r => r !== '').length ? regels.join('\n') : entry.summary).substring(0, 9000) + toelichting,
        summary: entry.summary.substring(0, 500),
        publishedAt: papi?.publicatieDatum || entry.updated || null,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${entry.title}":`, err.message);
    }
  }

  await logResult(db, sourceId, 'TenderNed (Amersfoort)', saved, skipped, errors);
}

scrape().catch(console.error);
