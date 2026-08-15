// subsidieregister-records.js — pakt het openbare subsidieregister uit naar losse records
//
// Waarom (24-07-2026): de oude subsidieregister.js sloeg alleen een link naar de PDF op
// als één raw_item van 205 tekens. Daarmee was de vraag "welke organisatie kreeg geld van
// de gemeente, en zit daar een bestuurder in die hier zelf over gaat?" niet te stellen.
// Deze scraper leest de PDF-tabel uit en schrijft elke subsidie als eigen record.
//
// Privacy: het register anonimiseert particulieren al als "Burger". Die records worden
// wel geteld (voor totalen) maar krijgen geen organisatiekoppeling.
//
// Tabelindeling PDF (x-posities, vastgesteld 24-07-2026 op register 2025):
//   <108 jaar | 108-122 programmanr | 122-320 deelprogramma | 320-515 instelling
//   | 515-735 omschrijving | >=735 bedrag

import * as cheerio from 'cheerio';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDb, ensureSource } from '../lib.js';

const db = createDb();
const PAGE_URL = 'https://www.amersfoort.nl/subsidieregister';
const BASE = 'https://www.amersfoort.nl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Kolomgrenzen worden PER PDF afgeleid uit de kopregel — de registers van
// verschillende jaren gebruiken niet dezelfde x-posities. Hardcoded grenzen
// plakten in het register 2024 de ontvanger en de omschrijving aan elkaar.
const FALLBACK_COLS = [
  { key: 'jaar', max: 108 },
  { key: 'deelprogramma', max: 320 },
  { key: 'instelling', max: 515 },
  { key: 'omschrijving', max: 735 },
  { key: 'bedrag', max: Infinity },
];

function detectColumns(items) {
  const find = (re) => {
    const hit = items.find(it => re.test(it.str.trim()));
    return hit ? hit.transform[4] : null;
  };
  // De kopteksten verschillen per jaargang: 2025 heeft "Deelprogramma" en "Naam" /
  // "Instelling" als losse tokens, 2024 heeft "Programma" en "Naam Instelling" als één token.
  const xDeel = find(/^(deel)?programma\b/i);
  const xNaam = find(/^naam\b/i) ?? find(/^instelling\b/i);
  const xOms = find(/^omschrijving\b/i);
  const xBed = find(/^bedrag\b/i);
  if (![xDeel, xNaam, xOms, xBed].every(v => typeof v === 'number')) return null;
  return [
    { key: 'jaar', max: xDeel - 10 },
    { key: 'deelprogramma', max: xNaam - 10 },
    { key: 'instelling', max: xOms - 10 },
    { key: 'omschrijving', max: xBed - 10 },
    { key: 'bedrag', max: Infinity },
  ];
}

// "1.1 Energietransitie" → programmanr + naam
function splitDeelprogramma(s) {
  const m = (s || '').match(/^\s*(\d+(?:\.\d+)*)\s+(.*)$/);
  return m ? { programmanr: m[1], deelprogramma: m[2].trim() } : { programmanr: '', deelprogramma: (s || '').trim() };
}

async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS subsidies (
    id INTEGER PRIMARY KEY,
    jaar INTEGER,
    programmanr TEXT,
    deelprogramma TEXT,
    ontvanger TEXT NOT NULL,
    ontvanger_normalized TEXT NOT NULL,
    is_particulier INTEGER DEFAULT 0,
    omschrijving TEXT,
    bedrag REAL,
    bron_url TEXT,
    organization_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_subsidies_ontvanger ON subsidies(ontvanger_normalized)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_subsidies_jaar ON subsidies(jaar)`);
  // BEWUST GEEN unieke index op (jaar, ontvanger, omschrijving, bedrag): het register
  // bevat legitiem identieke regels (bijv. tientallen keer "Burger | Woningisolatie |
  // 1.000,00"). Idempotentie loopt via bron_url: bij een herparse worden de records
  // van dat document eerst verwijderd.
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(stichting|ver\.|vereniging|cooperatie|coöperatie|st\.|b\.?v\.?|n\.?v\.?)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBedrag(s) {
  const m = (s || '').replace(/\s/g, '').match(/-?[\d.]+,\d{2}/);
  if (!m) return null;
  return parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
}

function rowsFromPage(items, cols) {
  const byY = {};
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str });
  }
  return Object.keys(byY).map(Number).sort((a, b) => b - a).map(y => {
    const cells = Object.fromEntries(cols.map(c => [c.key, []]));
    for (const o of byY[y].sort((a, b) => a.x - b.x)) {
      const col = cols.find(c => o.x < c.max);
      cells[col.key].push(o.s.trim());
    }
    return Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.join(' ').replace(/\s+/g, ' ').trim()]));
  });
}

async function findPdfs() {
  const r = await fetch(PAGE_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  const $ = cheerio.load(await r.text());
  const out = [];
  $('a[href*=".pdf"]').each((_, e) => {
    const href = $(e).attr('href') || '';
    if (!/subsidieregister/i.test(href)) return;
    const url = href.startsWith('http') ? href : BASE + href;
    const jaar = (href.match(/(20\d{2})/g) || []).map(Number).pop();
    if (!out.find(o => o.url === url)) out.push({ url, jaar });
  });
  return out;
}

async function parsePdf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const doc = await getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;

  const records = [];
  let vorige = null;
  let cols = null;
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const items = (await page.getTextContent()).items;
    if (!cols) {
      cols = detectColumns(items);
      if (cols) console.log(`[SUBSIDIES] kolomgrenzen gedetecteerd: ${cols.map(c => `${c.key}<${Math.round(c.max)}`).join(' ')}`);
      else { cols = FALLBACK_COLS; console.warn('[SUBSIDIES] kopregel niet herkend — fallback-kolommen gebruikt'); }
    }
    const rows = rowsFromPage(items, cols);
    for (const row of rows) {
      // Pagina-kop en -titel overslaan. Zonder deze check plakt de "doorgelopen regel"-
      // logica hieronder de paginatitel achter de naam van de vorige ontvanger.
      const heleRegel = Object.values(row).join(' ').trim();
      if (/^Subsidie/i.test(row.jaar) ||
          /Openbaar\s+Subsidieregister/i.test(heleRegel) ||
          /\bDatum\s+\d{2}-\d{2}-\d{4}\b/.test(heleRegel) ||
          /^(deel)?programma$|^naam|^omschrijving$|^bedrag$/i.test(row.deelprogramma)) continue;
      const jaar = (row.jaar.match(/20\d{2}/) || [])[0];
      const bedrag = parseBedrag(row.bedrag);

      if (jaar && bedrag !== null) {
        const { programmanr, deelprogramma } = splitDeelprogramma(row.deelprogramma);
        vorige = {
          jaar: Number(jaar),
          programmanr,
          deelprogramma,
          instelling: row.instelling,
          omschrijving: row.omschrijving,
          bedrag,
        };
        records.push(vorige);
      } else if (vorige && (row.instelling || row.omschrijving)) {
        // doorgelopen regel: plak aan het vorige record
        if (row.instelling) vorige.instelling = `${vorige.instelling} ${row.instelling}`.trim();
        if (row.omschrijving) vorige.omschrijving = `${vorige.omschrijving} ${row.omschrijving}`.trim();
      }
    }
  }
  return records;
}

async function run() {
  console.log(`\n[SUBSIDIES] gestart ${new Date().toISOString()}`);
  await ensureTable();
  await ensureSource(db, {
    name: 'Subsidieregister gemeente Amersfoort',
    url: PAGE_URL,
    source_type: 'scrape',
    reliability: 'primary',
    category: 'registry',
    scrape_frequency: 'weekly',
    tier: 1,
  });

  const pdfs = await findPdfs();
  console.log(`[SUBSIDIES] ${pdfs.length} registers gevonden: ${pdfs.map(p => p.jaar).join(', ')}`);

  let totaalNieuw = 0;
  for (const pdf of pdfs) {
    let records;
    try {
      records = await parsePdf(pdf.url);
    } catch (e) {
      console.error(`[SUBSIDIES] fout bij ${pdf.url}: ${e.message}`);
      continue;
    }

    // Idempotent: eerst de bestaande records van dit document weg
    const weg = await db.execute({ sql: 'DELETE FROM subsidies WHERE bron_url = ?', args: [pdf.url] });
    if (weg.rowsAffected) console.log(`[SUBSIDIES] ${pdf.jaar}: ${weg.rowsAffected} bestaande records vervangen`);

    let nieuw = 0, dubbel = 0;
    for (const rec of records) {
      const particulier = /^burger$/i.test(rec.instelling.trim()) ? 1 : 0;
      try {
        const res = await db.execute({
          sql: `INSERT INTO subsidies
                (jaar, programmanr, deelprogramma, ontvanger, ontvanger_normalized,
                 is_particulier, omschrijving, bedrag, bron_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [rec.jaar, rec.programmanr, rec.deelprogramma, rec.instelling,
                 normalize(rec.instelling), particulier, rec.omschrijving, rec.bedrag, pdf.url],
        });
        if (res.rowsAffected > 0) nieuw++; else dubbel++;
      } catch (e) {
        console.error(`[SUBSIDIES] insert-fout: ${e.message}`);
      }
    }
    totaalNieuw += nieuw;
    console.log(`[SUBSIDIES] ${pdf.jaar}: ${records.length} regels gelezen, ${nieuw} nieuw, ${dubbel} al bekend`);
  }

  // Koppel automatisch aan bekende organisaties
  const koppel = await db.execute(`
    UPDATE subsidies SET organization_id = (
      SELECT o.id FROM organizations o
      WHERE o.normalized_name = subsidies.ontvanger_normalized
    ) WHERE organization_id IS NULL AND is_particulier = 0`);
  console.log(`[SUBSIDIES] klaar: ${totaalNieuw} nieuwe records, ${koppel.rowsAffected} gekoppeld aan organisaties`);
}

run().catch(e => { console.error('[SUBSIDIES] fataal:', e); process.exit(1); });
