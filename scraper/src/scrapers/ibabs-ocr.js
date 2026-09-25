// OCR-nazorg voor gescande iBabs-bijlagen zonder tekstlaag.
// Bounded: standaard maximaal twee documenten, twaalf pagina's per document en
// honderd seconden per run. De gewone PDF-extractie blijft daardoor snel.

import db from '../db.js';
import { logResult } from '../utils.js';
import { bouwFullText, isOcrKandidaat, MIN_OCR_TEKENS, ocrPdf } from '../ibabs-ocr-lib.js';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const MAX_DOCS = Number(arg('--max-docs', '2'));
const MAX_PAGINAS = Number(arg('--max-paginas', '12'));
const BUDGET_MS = Number(arg('--budget-ms', '100000'));
const MAX_BYTES = 40 * 1024 * 1024;

async function tabelBestaat(naam) {
  return (await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", args: [naam] })).rows.length > 0;
}

async function zorgVoorKolommen() {
  const kolommen = (await db.execute('PRAGMA table_info(raw_item_attachments)')).rows.map((r) => String(r.name));
  if (!kolommen.includes('tekstbron')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN tekstbron TEXT');
  if (!kolommen.includes('ocr_pogingen')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_pogingen INTEGER NOT NULL DEFAULT 0');
  if (!kolommen.includes('ocr_fout')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_fout TEXT');
  if (!kolommen.includes('ocr_at')) await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN ocr_at TEXT');
}

async function herbouwEnMarkeer(rawItemId) {
  const item = (await db.execute({ sql: 'SELECT content FROM raw_items WHERE id=?', args: [rawItemId] })).rows[0];
  const bijlagen = (await db.execute({ sql: "SELECT titel,tekst FROM raw_item_attachments WHERE raw_item_id=? AND status='ok' ORDER BY id", args: [rawItemId] })).rows;
  const volledig = bouwFullText(item?.content || '', bijlagen);
  const stmts = [{ sql: 'UPDATE raw_items SET full_text=?,fulltext_fetched_at=?,entities_scanned_at=NULL WHERE id=?', args: [volledig, new Date().toISOString(), rawItemId] }];
  // De scanmarkeringen moeten opnieuw worden opgebouwd op de uitgebreidere tekst.
  // Bestaande vermeldingen blijven geldig en kunnen menselijke reviews dragen;
  // de NER-extractor voegt nieuwe vermeldingen idempotent toe.
  if (await tabelBestaat('ner_scans')) stmts.unshift({ sql: 'DELETE FROM ner_scans WHERE raw_item_id=?', args: [rawItemId] });
  if (await tabelBestaat('document_addresses')) stmts.unshift({ sql: 'DELETE FROM document_addresses WHERE raw_item_id=?', args: [rawItemId] });
  if (await tabelBestaat('address_scans')) stmts.unshift({ sql: 'DELETE FROM address_scans WHERE raw_item_id=?', args: [rawItemId] });
  await db.batch(stmts, 'write');
}

async function scrape() {
  await zorgVoorKolommen();
  const bron = (await db.execute("SELECT id FROM sources WHERE name='Bestuurlijke informatie gemeente Amersfoort (iBabs)' ORDER BY id LIMIT 1")).rows[0];
  if (!bron) throw new Error('iBabs-bron ontbreekt.');
  const kandidaten = (await db.execute({
    sql: `SELECT id,raw_item_id,url,status,ocr_pogingen FROM raw_item_attachments
          WHERE status='geen_tekst' AND COALESCE(ocr_pogingen,0)<2 AND COALESCE(bytes,0)<=?
          ORDER BY opgehaald_at DESC,id DESC LIMIT ?`, args: [MAX_BYTES, MAX_DOCS],
  })).rows.filter((r) => isOcrKandidaat(String(r.status), Number(r.ocr_pogingen)));
  const start = Date.now();
  let ok = 0, leeg = 0, fouten = 0, bekeken = 0;
  for (const k of kandidaten) {
    if (Date.now() - start >= BUDGET_MS) break;
    bekeken++;
    try {
      const resp = await fetch(k.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('PDF groter dan 40 MB');
      const uit = await ocrPdf(buf, { maxPaginas: MAX_PAGINAS });
      const voldoende = uit.tekst.replace(/\s/g, '').length >= MIN_OCR_TEKENS;
      await db.execute({
        sql: `UPDATE raw_item_attachments SET status=?,tekst=?,tekens=?,paginas=COALESCE(paginas,?),tekstbron=?,
              ocr_pogingen=COALESCE(ocr_pogingen,0)+1,ocr_fout=?,ocr_at=datetime('now'),opgehaald_at=datetime('now') WHERE id=?`,
        args: [voldoende ? 'ok' : 'geen_tekst', voldoende ? uit.tekst : null, voldoende ? uit.tekst.length : 0, uit.paginas,
          voldoende ? 'ocr' : null, voldoende ? null : `OCR leverde minder dan ${MIN_OCR_TEKENS} tekens`, k.id],
      });
      if (voldoende) { ok++; await herbouwEnMarkeer(Number(k.raw_item_id)); } else leeg++;
    } catch (e) {
      fouten++;
      await db.execute({ sql: `UPDATE raw_item_attachments SET ocr_pogingen=COALESCE(ocr_pogingen,0)+1,ocr_fout=?,ocr_at=datetime('now') WHERE id=?`, args: [String(e.message).slice(0,500), k.id] });
      console.error(`OCR bijlage ${k.id}: ${e.message}`);
    }
  }
  console.log(`iBabs-OCR: ${bekeken} bekeken, ${ok} hersteld, ${leeg} nog zonder tekst, ${fouten} fouten`);
  await logResult(db, Number(bron.id), 'iBabs-OCR', ok, leeg, fouten, bekeken);
}

if (process.argv[1] && process.argv[1].endsWith('ibabs-ocr.js')) scrape().catch((e) => { console.error(e); process.exitCode = 1; });
