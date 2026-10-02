// stateninformatie.js — Statenstukken van de provincie Utrecht die over
// Amersfoort of Leusden gaan. Toegevoegd 2026-10-02.
//
// Waarom: de provincie werd alleen via haar nieuwspagina gevolgd (bron 39).
// De stukken van Provinciale Staten, de Statencommissies en Praten met de
// Staten (Statenvoorstellen, Statenbrieven, inspraak, beantwoording van
// Statenvragen) stonden nergens. In zeven weken tot 2 oktober 2026 waren dat
// 227 documenten, waarvan er 9 al in de titel Amersfoort of Leusden noemden
// (onder meer de netuitbreiding Amersfoort-Noord van TenneT).
//
// Bron: www.stateninformatie.provincie-utrecht.nl, een GemeenteOplossingen-
// systeem met open JSON-API zonder sleutel. Open Stateninformatie (dezelfde
// API als de ORI-raadsinformatie) heeft dezelfde stukken met tekst, maar liep
// op 2 oktober bijna drie maanden achter (laatste vergadering 8 juli); de
// Amersfoortse ORI-index trouwens ook. Daarom rechtstreeks de bron.
//
// Werkwijze per run:
// 1. Vergaderingen van DAGEN_TERUG dagen terug tot DAGEN_VOORUIT dagen vooruit
//    (agenda's staan voor de vergadering online).
// 2. Elk nog niet beoordeeld document wordt als PDF gelezen en op lokale
//    termen getoetst (stateninformatie-lib.mjs). Alleen lokale stukken worden
//    een raw_item; het oordeel over elk document staat in
//    data/stateninformatie/beoordeeld.json, zodat een niet-lokaal stuk niet
//    elke run opnieuw wordt gedownload. Dat bestand is herstelbaar: weg
//    betekent één keer opnieuw lezen, en dubbele items vangt de unieke index
//    op (source_id, content_hash) af.
// 3. Een vergadering van langer dan HIST_DAGEN dagen geleden levert
//    achtergrond op (is_historical=1, is_processed=1), geen nieuw signaal.
//
// Grenzen: run-all.js geeft 60 seconden; MAX_PDF documenten en BUDGET_MS per
// run, de rest volgt bij de volgende run. Gemeten 2 oktober 2026: twaalf PDF's
// in twaalf seconden, dus dertig passen ruim in het budget; de achterstand van
// 230 stukken bij de eerste run is zo in een paar runs weggewerkt. Geen query per document op
// raw_items (zie docs/DATABASE-LEZEN.md); de unieke index doet het ontdubbelen.
//
// STATEN_DRYRUN=1 toont wat hij zou doen zonder database of bestand te raken.
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { getOrCreateSource, logResult, makeSummary, contentHash, naarPublicatieIso } from '../utils.js';
import { pdfTekst } from '../pdf-tekst.mjs';
import {
  BASIS, venster, documentenVanVergadering, teBeoordelen, isLokaal, itemTitel, itemKop,
  vergaderDatum, isHistorisch,
} from '../stateninformatie-lib.mjs';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const NAAM = 'Provinciale Staten Utrecht — Statenstukken';
const DAGEN_TERUG = parseInt(process.env.STATEN_DAGEN_TERUG || '30', 10);
const DAGEN_VOORUIT = parseInt(process.env.STATEN_DAGEN_VOORUIT || '21', 10);
const HIST_DAGEN = parseInt(process.env.STATEN_HIST_DAGEN || '14', 10);
const MAX_PDF = parseInt(process.env.STATEN_MAX_PDF || '30', 10);
const BUDGET_MS = parseInt(process.env.STATEN_BUDGET_MS || '45000', 10);
const DRY = process.env.STATEN_DRYRUN === '1';
const START = Date.now();
const binnenBudget = () => Date.now() - START < BUDGET_MS;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAAT_PAD = process.env.STATEN_STAAT || path.join(__dirname, '..', '..', 'data', 'stateninformatie', 'beoordeeld.json');

async function leesStaat() {
  try { return JSON.parse(await fs.readFile(STAAT_PAD, 'utf8')); } catch { return {}; }
}

async function schrijfStaat(staat) {
  await fs.mkdir(path.dirname(STAAT_PAD), { recursive: true });
  await fs.writeFile(STAAT_PAD, JSON.stringify(staat, null, 1));
}

async function vergaderingen() {
  const { van, tot } = venster(new Date(), DAGEN_TERUG, DAGEN_VOORUIT);
  const r = await fetch(`${BASIS}/api/v1/meetings?date_from=${van}&date_to=${tot}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`Stateninformatie HTTP ${r.status}`);
  const lijst = await r.json();
  if (!Array.isArray(lijst)) throw new Error('Stateninformatie: onverwacht antwoord (geen lijst)');
  return lijst.filter((m) => m && !m.confidential);
}

async function scrape() {
  const sourceId = DRY ? -1 : await getOrCreateSource(db, {
    name: NAAM, url: BASIS, sourceType: 'api', reliability: 'primary', category: 'government', scrapeFrequency: 'daily',
  });
  if (!DRY) {
    // Officiële bestuursstukken dragen (tier 1); het werkgebied is de regio.
    // Alleen zetten zolang niemand het met de hand heeft ingevuld.
    await db.execute({ sql: "UPDATE sources SET tier = 1, gemeente = COALESCE(gemeente, 'regio') WHERE id = ? AND (tier IS NULL OR tier = 2)", args: [sourceId] })
      .catch((e) => console.error('stateninformatie: tier/gemeente niet gezet:', e.message));
  }

  const lijst = await vergaderingen();
  const staat = await leesStaat();
  const wacht = teBeoordelen(lijst, staat);
  const totaalDocs = lijst.reduce((n, m) => n + documentenVanVergadering(m).length, 0);

  let gelezen = 0, nieuw = 0, bekend = 0, nietLokaal = 0, fouten = 0, uitgesteld = 0;
  const statussen = {};
  const nu = new Date();
  for (const { meeting, doc, pogingen } of wacht) {
    if (!binnenBudget() || gelezen >= MAX_PDF) { uitgesteld++; continue; }
    gelezen++;
    const titel = itemTitel(meeting, doc);
    const kop = itemKop(meeting, doc);
    const pdf = doc.pdf ? await pdfTekst(doc.url, { ua: UA }) : { status: 'geen_pdf', tekst: null };
    statussen[pdf.status] = (statussen[pdf.status] || 0) + 1;
    const oordeel = isLokaal({ titel: `${doc.titel} ${doc.agendapunt || ''}`, tekst: pdf.tekst });

    // Een leesfout zonder titeltreffer wordt later opnieuw geprobeerd.
    if (!oordeel.lokaal && (pdf.status === 'fout' || pdf.status.startsWith('http_'))) {
      fouten++;
      staat[String(doc.id)] = { besluit: 'fout', pogingen: pogingen + 1, status: pdf.status, datum: nu.toISOString() };
      console.error(`stateninformatie: document ${doc.id} (${pdf.status}${pdf.fout ? `: ${pdf.fout}` : ''})`);
      continue;
    }
    if (!oordeel.lokaal) {
      nietLokaal++;
      staat[String(doc.id)] = { besluit: 'niet-lokaal', reden: oordeel.reden, datum: nu.toISOString() };
      continue;
    }

    const datum = vergaderDatum(meeting);
    const historisch = isHistorisch(datum, nu, HIST_DAGEN);
    staat[String(doc.id)] = { besluit: 'lokaal', reden: oordeel.reden, datum: nu.toISOString() };
    if (DRY) {
      console.log(`  [dry] ${historisch ? 'hist ' : 'nieuw'} ${titel.slice(0, 110)} | ${pdf.status} ${pdf.tekst ? pdf.tekst.length : 0} | ${oordeel.reden}`);
      nieuw++;
      continue;
    }
    const tekst = pdf.tekst || '';
    try {
      await db.execute({
        sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary, content_hash, published_at,
                full_text, fulltext_fetched_at, is_processed, is_historical)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [sourceId, doc.url, titel, `${kop}\n\n${tekst}`.trim().substring(0, 25000),
          (makeSummary(tekst) || kop).substring(0, 500), contentHash(`${titel}${doc.url}`),
          naarPublicatieIso(doc.gewijzigd || datum), tekst ? `${kop}\n\n${tekst}`.substring(0, 200000) : null,
          tekst ? nu.toISOString() : null, historisch ? 1 : 0, historisch ? 1 : 0],
      });
      nieuw++;
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) bekend++;
      else { fouten++; console.error(`stateninformatie: ${doc.id}: ${e.message}`); }
    }
  }

  console.log(`stateninformatie: ${lijst.length} vergaderingen, ${totaalDocs} documenten, ${wacht.length} te beoordelen, ` +
    `${gelezen} gelezen, ${nieuw} nieuw, ${bekend} al bekend, ${nietLokaal} niet lokaal, ${uitgesteld} uitgesteld, ` +
    `${fouten} fouten, pdf ${JSON.stringify(statussen)}`);
  if (DRY) return;
  await schrijfStaat(staat);
  // items_found = wat deze run is beoordeeld; de bronnenwacht ziet zo een
  // onbereikbare API (fout) apart van een rustige maand (leeg).
  await logResult(db, sourceId, NAAM, nieuw, bekend + nietLokaal, fouten, gelezen);
}

if (process.argv[1] && process.argv[1].endsWith('stateninformatie.js')) {
  scrape().then(() => process.exit(0)).catch((e) => { console.error('stateninformatie:', e.message); process.exit(1); });
}
