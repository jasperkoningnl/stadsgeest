// notubiz-leusden.js — vergaderstukken van de gemeenteraad Leusden via de
// openbare Notubiz-API. Toegevoegd 2026-09-24.
//
// Waarom: Leusden is na de zomer van gemeentebestuur.leusden.nl naar Notubiz
// (leusden.raadsinformatie.nl, organisatie 2090) gegaan. De ORI-index voor
// Leusden (bron 129) stopt bij de raad van 9 juli 2026 en staat daarom op
// 'dood'. api.notubiz.nl geeft zonder sleutel de vergaderingen, agendapunten en
// documenten; api.notubiz.nl/document/{id}/{versie} levert de PDF.
//
// Werkwijze per run:
// 1. Vergaderingen van DAGEN_TERUG dagen terug tot DAGEN_VOORUIT dagen vooruit.
//    Een 'assembly' (beeld- en oordeelsvormende avond) bestaat uit meerdere
//    vergaderingen; die worden elk opgehaald.
// 2. Elk document dat nog niet in raw_items staat (op Notubiz-document-id, in
//    welke bron dan ook) wordt een raw_item met de PDF-tekst.
// 3. Vergaderingen die langer dan 7 dagen geleden waren, leveren achtergrond op
//    (is_historical=1, is_processed=1) en geen nieuwe signalen.
//
// Moties vreemd aan de agenda staan niet altijd als document in de vergadering;
// die komen via raadkijker-moties.js (Leusden-pass), met de indienende partij.
//
// Grenzen: run-all.js geeft 60 seconden. Tijdsbudget en maximum aantal PDF's per
// run; de rest volgt bij de volgende run (drie keer per dag).
import db from '../db.js';
import { getOrCreateSource, logResult, makeSummary, contentHash, naarPublicatieIso } from '../utils.js';
import { attribuut, startdatum, verzamelDocumenten, itemTitel, isHistorisch } from '../notubiz-lib.js';

const API = 'https://api.notubiz.nl';
const ORGANISATIE = 2090;
const V = 'format=json&version=1.10.8';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';
const DAGEN_TERUG = parseInt(process.env.NOTUBIZ_DAGEN_TERUG || '45', 10);
const DAGEN_VOORUIT = parseInt(process.env.NOTUBIZ_DAGEN_VOORUIT || '30', 10);
const MAX_PDF = parseInt(process.env.NOTUBIZ_MAX_PDF || '20', 10);
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const BUDGET_MS = parseInt(process.env.NOTUBIZ_BUDGET_MS || '48000', 10);
const DRY = process.env.NOTUBIZ_DRYRUN === '1';
const START = Date.now();
const binnenBudget = () => Date.now() - START < BUDGET_MS;

async function json(pad) {
  const r = await fetch(`${API}${pad}${pad.includes('?') ? '&' : '?'}${V}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Notubiz HTTP ${r.status} op ${pad}`);
  return r.json();
}

let pdfjs = null;
async function pdfTekst(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) return { status: `http_${r.status}`, tekst: null };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PDF_BYTES) return { status: 'te_groot', tekst: null };
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 'geen_pdf', tekst: null };
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const delen = [];
  for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
    const inhoud = await (await doc.getPage(p)).getTextContent();
    delen.push(inhoud.items.map((i) => i.str).join(' '));
  }
  await doc.destroy();
  const tekst = delen.join('\n').replace(/[ \t]+/g, ' ').trim();
  return tekst.length >= 100 ? { status: 'ok', tekst } : { status: 'geen_tekst', tekst: null };
}

function datumPlus(dagen) {
  return new Date(Date.now() + dagen * 864e5).toISOString().slice(0, 10);
}

async function scrape() {
  const sourceId = DRY ? -1 : await getOrCreateSource(db, {
    name: 'Raad Leusden — vergaderstukken (Notubiz)', url: 'https://leusden.raadsinformatie.nl',
    sourceType: 'api', reliability: 'primary', category: 'government', scrapeFrequency: 'daily',
  });
  if (!DRY) {
    // Zelfde keuze als voor de ORI-Leusdenbron: officiële raadsstukken dragen (tier 1).
    await db.execute({ sql: "UPDATE sources SET tier = 1, gemeente = 'Leusden' WHERE id = ?", args: [sourceId] })
      .catch((e) => console.error('notubiz-leusden: tier/gemeente niet gezet:', e.message));
  }

  const lijst = await json(`/events?organisation_id=${ORGANISATIE}&date_from=${datumPlus(-DAGEN_TERUG)}%2000:00:00&date_to=${datumPlus(DAGEN_VOORUIT)}%2023:59:59`);
  const events = (lijst.events || []).filter((e) => !e.canceled && !e.inactive && e.permission_group === 'public');
  const vergaderingen = [];
  for (const e of events) {
    if (e.type === 'meeting') vergaderingen.push({ id: e.id, naam: attribuut(e, 1), datum: startdatum(e) });
    else if (e.type === 'assembly' && binnenBudget()) {
      const a = (await json(`/events/assemblies/${e.id}`)).assembly || {};
      for (const m of a.meetings || []) vergaderingen.push({ id: m.id, naam: attribuut(a, 1), datum: startdatum(m) || startdatum(a) });
    }
  }

  let gevonden = 0, nieuw = 0, bekend = 0, fouten = 0, pdfs = 0, uitgesteld = 0;
  const statussen = {};
  for (const v of vergaderingen) {
    if (!binnenBudget()) { uitgesteld++; continue; }
    let meeting;
    try { meeting = (await json(`/events/meetings/${v.id}`)).meeting || {}; } catch (e) { fouten++; console.error(`notubiz-leusden: vergadering ${v.id}: ${e.message}`); continue; }
    const naam = attribuut(meeting, 1) || v.naam || 'Vergadering';
    const deelnaam = v.naam && v.naam !== naam ? `${v.naam}, ${naam}` : naam;
    const datum = startdatum(meeting) || v.datum;
    const docs = verzamelDocumenten(meeting);
    gevonden += docs.length;
    for (const d of docs) {
      const bestaat = await db.execute({ sql: 'SELECT id FROM raw_items WHERE external_url LIKE ? LIMIT 1', args: [`%notubiz.nl/document/${d.id}/%`] });
      if (bestaat.rows.length) { bekend++; continue; }
      if (!binnenBudget() || pdfs >= MAX_PDF) { uitgesteld++; continue; }
      pdfs++;
      let pdf = { status: 'overgeslagen', tekst: null };
      try { if (d.pdf) pdf = await pdfTekst(d.url); } catch (e) { pdf = { status: 'fout', tekst: null }; console.error(`notubiz-leusden: pdf ${d.id}: ${e.message}`); }
      statussen[pdf.status] = (statussen[pdf.status] || 0) + 1;
      const titel = itemTitel(deelnaam, datum, d);
      const kop = [`Gemeenteraad Leusden — ${deelnaam}`, datum ? `Vergaderdatum: ${datum}` : null,
        d.agendapunt ? `Agendapunt: ${d.agendapunt}` : null, d.soort ? `Soort document: ${d.soort}` : null].filter(Boolean).join('\n');
      const historisch = isHistorisch(datum);
      if (DRY) { console.log(`  [dry] ${historisch ? 'hist ' : 'nieuw'} ${titel.slice(0, 110)} | ${pdf.status} ${pdf.tekst ? pdf.tekst.length : 0}`); nieuw++; continue; }
      try {
        await db.execute({
          sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary, content_hash, published_at,
                  full_text, fulltext_fetched_at, is_processed, is_historical)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [sourceId, d.url, titel, `${kop}\n\n${pdf.tekst || ''}`.trim().substring(0, 25000),
            (makeSummary(pdf.tekst || '') || kop).substring(0, 500), contentHash(`${titel}${d.url}`),
            naarPublicatieIso(d.publicatiedatum || datum), pdf.tekst ? `${kop}\n\n${pdf.tekst}`.substring(0, 200000) : null,
            pdf.tekst ? new Date().toISOString() : null, historisch ? 1 : 0, historisch ? 1 : 0],
        });
        nieuw++;
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) bekend++; else { fouten++; console.error(`notubiz-leusden: ${d.id}: ${e.message}`); }
      }
    }
  }
  console.log(`notubiz-leusden: ${events.length} evenementen, ${vergaderingen.length} vergaderingen, ${gevonden} documenten, ` +
    `${nieuw} nieuw, ${bekend} al bekend, ${uitgesteld} uitgesteld, ${fouten} fouten, pdf ${JSON.stringify(statussen)}`);
  if (!DRY) await logResult(db, sourceId, 'Raad Leusden — vergaderstukken (Notubiz)', nieuw, bekend, fouten, gevonden);
}

if (process.argv[1] && process.argv[1].endsWith('notubiz-leusden.js')) {
  scrape().then(() => process.exit(0)).catch((e) => { console.error('notubiz-leusden:', e.message); process.exit(1); });
}
