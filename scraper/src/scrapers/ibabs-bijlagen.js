// ibabs-bijlagen.js — haalt de bijlagen (PDF's) op van Woo-besluiten en convenanten
// op het iBabs-publieksportaal en zet de tekst in raw_items.full_text. Toegevoegd 2026-09-23.
//
// Waarom: ibabs-woo.js leest alleen de itempagina (zaaknummer, datums, bestandsnamen).
// Het Woo-besluit, de inventarislijst en de openbaar gemaakte stukken zelf bleven
// ongelezen. Voor het zoeken naar personen, organisaties en adressen zijn juist die
// stukken de hooiberg.
//
// Werkwijze
// 1. Volledige lijst per categorie via POST /Reports/GetReportData/{rapport}.
// 2. Ontbreekt het item in raw_items, dan wordt het aangemaakt. Items ouder dan
//    VERSHEID_DAGEN krijgen is_historical=1 en is_processed=1: ze voeden de
//    entiteitextractie maar maken geen nieuwe signalen (geen backfillgolf).
// 3. Per item de documentlinks lezen; nog niet opgehaalde PDF's downloaden via
//    /Document/View/{documentId}, tekst extraheren, vastleggen in raw_item_attachments.
// 4. full_text van het item = itemtekst + alle bijlageteksten; entities_scanned_at
//    wordt leeggemaakt zodat extractie opnieuw draait.
//
// Scans zonder tekstlaag krijgen status 'geen_tekst'. ibabs-ocr.js verwerkt
// daarna een kleine, begrensde portie met Tesseract.
//
// Aanroep (vanuit scraper/): node src/scrapers/ibabs-bijlagen.js [--max-docs 300] [--categorie woo,convenanten]

import * as cheerio from 'cheerio';
import db from '../db.js';
import { contentHash, getOrCreateSource, logResult, naarPublicatieIso } from '../utils.js';
import { RAPPORTEN, rijNaarItem, documentLinks, leeftijdDagen, IBABS_BASE, bijlageIsAfgehandeld } from '../ibabs-lib.js';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const VERSHEID_DAGEN = 30;
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_PAGINAS = 150;
const MAX_FULLTEXT = 200000;
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const MAX_DOCS = Number(arg('--max-docs', '25')); // past binnen de 120s-timeout van run-weekly
const MAX_HERPOGINGEN = Number(arg('--max-retries', '3'));
const CATEGORIEEN = arg('--categorie', 'woo,convenanten').split(',');
const pauze = ms => new Promise(r => setTimeout(r, ms));

let pdfjsCache = null;
async function pdfTekst(buffer) {
  if (!pdfjsCache) pdfjsCache = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsCache.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const delen = [];
  const n = Math.min(doc.numPages, MAX_PAGINAS);
  for (let p = 1; p <= n; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    delen.push(c.items.map(i => i.str).join(' '));
  }
  const paginas = doc.numPages;
  await doc.destroy();
  return { tekst: delen.join('\n').replace(/[ \t]+/g, ' ').trim(), paginas };
}

async function zorgVoorTabel() {
  await db.execute(`CREATE TABLE IF NOT EXISTS raw_item_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
    document_id TEXT NOT NULL UNIQUE,
    titel TEXT,
    url TEXT NOT NULL,
    bytes INTEGER,
    paginas INTEGER,
    tekens INTEGER,
    status TEXT NOT NULL CHECK(status IN ('ok','geen_tekst','te_groot','geen_pdf','fout')),
    tekst TEXT,
    pogingen INTEGER NOT NULL DEFAULT 1,
    opgehaald_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const kolommen = (await db.execute('PRAGMA table_info(raw_item_attachments)')).rows.map(r => String(r.name));
  if (!kolommen.includes('pogingen')) {
    await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN pogingen INTEGER NOT NULL DEFAULT 1');
  }
  if (!kolommen.includes('tekstbron')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN tekstbron TEXT');
  if (!kolommen.includes('ocr_pogingen')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_pogingen INTEGER NOT NULL DEFAULT 0');
  if (!kolommen.includes('ocr_fout')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_fout TEXT');
  if (!kolommen.includes('ocr_at')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_at TEXT');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_ria_item ON raw_item_attachments(raw_item_id)');
}

async function rapport(r) {
  const resp = await fetch(`${IBABS_BASE}/Reports/GetReportData/${r.id}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'draw=1&start=0&length=5000',
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`GetReportData HTTP ${resp.status}`);
  return (await resp.json()).data || [];
}

function itemTekst(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();
  const bron = $('main').first().length ? $('main').first() : $('body');
  return bron.text().replace(/\s+/g, ' ').replace(/^\s*Vorige pagina\s*/i, '').trim();
}

async function zorgVoorItem(sourceId, item, detail) {
  const bestaand = await db.execute({ sql: 'SELECT id FROM raw_items WHERE external_url = ? ORDER BY id LIMIT 1', args: [item.url] });
  if (bestaand.rows.length) return { id: Number(bestaand.rows[0].id), nieuw: false };
  const oud = (leeftijdDagen(item.datum) ?? 0) > VERSHEID_DAGEN;
  const r = await db.execute({
    sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary, content_hash, published_at, is_processed, is_historical)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [sourceId, item.url, item.titel, detail.substring(0, 8000), `${item.titel.split(':')[0]}, zaak ${item.zaaknummer || '?'}`.substring(0, 500),
      contentHash(`${item.titel}${item.url}`), naarPublicatieIso(item.datum), oud ? 1 : 0, oud ? 1 : 0],
  });
  return { id: Number(r.lastInsertRowid), nieuw: true };
}

async function scrape() {
  await zorgVoorTabel();
  const sourceId = await getOrCreateSource(db, {
    name: 'Bestuurlijke informatie gemeente Amersfoort (iBabs)',
    url: `${IBABS_BASE}/`, sourceType: 'scrape', reliability: 'primary', category: 'government', scrapeFrequency: 'weekly',
  });
  const bestaandeBijlagen = (await db.execute('SELECT document_id, status, pogingen FROM raw_item_attachments')).rows;
  const gehad = new Set(bestaandeBijlagen
    .filter(r => bijlageIsAfgehandeld(String(r.status), Number(r.pogingen)))
    .map(r => String(r.document_id)));
  const herprobeerbaar = new Set(bestaandeBijlagen
    .filter(r => !bijlageIsAfgehandeld(String(r.status), Number(r.pogingen)))
    .map(r => String(r.document_id)));
  let items = 0, nieuweItems = 0, docs = 0, herpogingen = 0, ok = 0, leeg = 0, fouten = 0;

  for (const cat of CATEGORIEEN) {
    const r = RAPPORTEN[cat];
    if (!r) { console.error(`Onbekende categorie ${cat}`); continue; }
    for (const rij of await rapport(r)) {
      if (docs >= MAX_DOCS) break;
      const item = rijNaarItem(rij, r);
      try {
        const html = await (await fetch(item.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })).text();
        const links = documentLinks(html).filter(l => !gehad.has(l.documentId)
          && (!herprobeerbaar.has(l.documentId) || herpogingen < MAX_HERPOGINGEN));
        items++;
        if (!links.length) continue;
        const detail = itemTekst(html);
        const { id: rawId, nieuw } = await zorgVoorItem(sourceId, item, detail);
        if (nieuw) nieuweItems++;

        for (const l of links) {
          if (docs >= MAX_DOCS) break;
          const isHerpoging = herprobeerbaar.has(l.documentId);
          if (isHerpoging && herpogingen >= MAX_HERPOGINGEN) continue;
          docs++;
          if (isHerpoging) herpogingen++;
          let status = 'fout', tekst = null, bytes = null, paginas = null;
          try {
            await pauze(600);
            // Een bekende foutlink mag de volledige wekelijkse runner niet opnieuw
            // 90 seconden blokkeren. Nieuwe documenten houden de ruimere timeout.
            const timeout = isHerpoging ? 20000 : 90000;
            const resp = await fetch(l.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
            const type = resp.headers.get('content-type') || '';
            const buf = Buffer.from(await resp.arrayBuffer());
            bytes = buf.length;
            if (!resp.ok) status = 'fout';
            else if (!/pdf/i.test(type)) status = 'geen_pdf';
            else if (bytes > MAX_BYTES) status = 'te_groot';
            else {
              const t = await pdfTekst(buf);
              paginas = t.paginas;
              tekst = t.tekst;
              status = tekst.replace(/\s/g, '').length > 200 ? 'ok' : 'geen_tekst';
            }
          } catch (e) {
            console.error(`Document ${l.documentId}: ${e.message}`);
          }
          if (status === 'ok') ok++; else if (status === 'geen_tekst') leeg++; else fouten++;
          await db.execute({
            sql: `INSERT INTO raw_item_attachments (raw_item_id, document_id, titel, url, bytes, paginas, tekens, status, tekst, pogingen, tekstbron)
                  VALUES (?,?,?,?,?,?,?,?,?,1,?)
                  ON CONFLICT(document_id) DO UPDATE SET
                    raw_item_id = excluded.raw_item_id,
                    titel = excluded.titel,
                    url = excluded.url,
                    bytes = excluded.bytes,
                    paginas = excluded.paginas,
                    tekens = excluded.tekens,
                    status = excluded.status,
                    tekst = excluded.tekst,
                    tekstbron = excluded.tekstbron,
                    pogingen = raw_item_attachments.pogingen + 1,
                    opgehaald_at = datetime('now')`,
            args: [rawId, l.documentId, l.titel, l.url, bytes, paginas, tekst ? tekst.length : 0, status, status === 'ok' ? tekst : null, status === 'ok' ? 'pdf' : null],
          });
          gehad.add(l.documentId);
        }

        // full_text opnieuw samenstellen uit itemtekst en alle bijlagen met tekst.
        const bijlagen = (await db.execute({ sql: "SELECT titel, tekst FROM raw_item_attachments WHERE raw_item_id = ? AND status = 'ok' ORDER BY id", args: [rawId] })).rows;
        if (bijlagen.length) {
          const volledig = [detail, ...bijlagen.map(b => `\n\n=== Bijlage: ${b.titel} ===\n${b.tekst}`)].join('').substring(0, MAX_FULLTEXT);
          await db.execute({
            sql: `UPDATE raw_items SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL WHERE id = ?`,
            args: [volledig, new Date().toISOString(), rawId],
          });
        }
      } catch (e) {
        fouten++;
        console.error(`Item ${item.url}: ${e.message}`);
      }
      await pauze(400);
    }
  }
  console.log(`iBabs-bijlagen: ${items} items bekeken, ${nieuweItems} nieuw aangemaakt, ${docs} documenten (${herpogingen} herpogingen; ${ok} met tekst, ${leeg} zonder tekstlaag, ${fouten} overig)`);
  await logResult(db, sourceId, 'iBabs-bijlagen', ok, leeg, fouten, items);
}

if (process.argv[1] && process.argv[1].endsWith('ibabs-bijlagen.js')) {
  scrape().catch(e => { console.error(e); process.exitCode = 1; });
}
