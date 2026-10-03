// Afzonderlijke naloop voor grote iBabs-PDF's.
// Verwerkt bewust maximaal één bestand per run, buiten run-weekly.
// Aanroep vanuit scraper/: node src/scrapers/ibabs-grote-bijlagen.js

import db from '../db.js';
import { logResult } from '../utils.js';
import { werkDeelitemsBij } from '../deelitems.mjs';
import { bouwFullText } from '../ibabs-ocr-lib.js';
import { isGroteBijlageKandidaat, MIB } from '../ibabs-grote-bijlagen-lib.js';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const MAX_BYTES = Number(process.env.IBABS_GROTE_BIJLAGE_MAX_MB || 100) * MIB;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.IBABS_GROTE_BIJLAGE_TIMEOUT_MS || 300000);
const MAX_PAGINAS = Number(process.env.IBABS_GROTE_BIJLAGE_MAX_PAGINAS || 600);
const MAX_POGINGEN = 3;

async function zorgVoorKolommen() {
  const kolommen = (await db.execute('PRAGMA table_info(raw_item_attachments)')).rows.map((r) => String(r.name));
  if (!kolommen.includes('grote_pogingen')) {
    await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN grote_pogingen INTEGER NOT NULL DEFAULT 0');
  }
  if (!kolommen.includes('grote_fout')) {
    await db.execute('ALTER TABLE raw_item_attachments ADD COLUMN grote_fout TEXT');
  }
}

async function pdfTekst(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true,
  }).promise;
  const delen = [];
  const aantal = Math.min(doc.numPages, MAX_PAGINAS);
  try {
    for (let pagina = 1; pagina <= aantal; pagina++) {
      const inhoud = await (await doc.getPage(pagina)).getTextContent();
      delen.push(inhoud.items.map((item) => item.str).join(' '));
    }
    return { tekst: delen.join('\n').replace(/[ \t]+/g, ' ').trim(), paginas: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

async function herbouwFullText(rawItemId) {
  const item = (await db.execute({ sql: 'SELECT content FROM raw_items WHERE id=?', args: [rawItemId] })).rows[0];
  const bijlagen = (await db.execute({
    sql: "SELECT titel,tekst FROM raw_item_attachments WHERE raw_item_id=? AND status='ok' ORDER BY id",
    args: [rawItemId],
  })).rows;
  await db.execute({
    sql: 'UPDATE raw_items SET full_text=?,fulltext_fetched_at=?,entities_scanned_at=NULL WHERE id=?',
    args: [bouwFullText(item?.content || '', bijlagen), new Date().toISOString(), rawItemId],
  });
  // Wat niet in full_text past gaat naar deelitems (sinds 2026-10-03).
  await werkDeelitemsBij(db, rawItemId, bouwFullText(item?.content || '', bijlagen, Number.MAX_SAFE_INTEGER));
}

async function kiesKandidaat() {
  const rijen = (await db.execute(`SELECT id,raw_item_id,document_id,titel,url,status,bytes,
      COALESCE(grote_pogingen,0) grote_pogingen
    FROM raw_item_attachments
    WHERE status IN ('te_groot','fout') AND COALESCE(grote_pogingen,0) < ${MAX_POGINGEN}
    ORDER BY COALESCE(grote_pogingen,0),opgehaald_at,id
    LIMIT 100`)).rows;
  return rijen.find((rij) => isGroteBijlageKandidaat({
    status: String(rij.status), bytes: Number(rij.bytes || 0), titel: String(rij.titel || ''),
    grotePogingen: Number(rij.grote_pogingen || 0),
  }, { maxPogingen: MAX_POGINGEN })) || null;
}

async function main() {
  await zorgVoorKolommen();
  const bron = (await db.execute("SELECT id FROM sources WHERE name='Bestuurlijke informatie gemeente Amersfoort (iBabs)' ORDER BY id LIMIT 1")).rows[0];
  if (!bron) throw new Error('iBabs-bron ontbreekt.');
  const kandidaat = await kiesKandidaat();
  if (!kandidaat) {
    console.log('iBabs-grote-bijlagen: geen kandidaat');
    await logResult(db, Number(bron.id), 'iBabs-grote-bijlagen', 0, 0, 0, 0);
    return;
  }
  try {
    const response = await fetch(kandidaat.url, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`download HTTP ${response.status}`);
    if (!/pdf/i.test(response.headers.get('content-type') || '')) throw new Error('download is geen PDF');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      throw new Error(`PDF is ${(buffer.length / MIB).toFixed(1)} MB; limiet is ${(MAX_BYTES / MIB).toFixed(0)} MB`);
    }
    const uit = await pdfTekst(buffer);
    const voldoende = uit.tekst.replace(/\s/g, '').length > 200;
    await db.execute({
      sql: `UPDATE raw_item_attachments SET bytes=?,paginas=?,tekens=?,status=?,tekst=?,tekstbron=?,
            grote_pogingen=COALESCE(grote_pogingen,0)+1,grote_fout=NULL,opgehaald_at=datetime('now') WHERE id=?`,
      args: [buffer.length, uit.paginas, voldoende ? uit.tekst.length : 0, voldoende ? 'ok' : 'geen_tekst',
        voldoende ? uit.tekst : null, voldoende ? 'pdf' : null, kandidaat.id],
    });
    if (voldoende) await herbouwFullText(Number(kandidaat.raw_item_id));
    console.log(`iBabs-grote-bijlagen: ${kandidaat.document_id} — ${(buffer.length / MIB).toFixed(1)} MB, ${uit.paginas} pagina's, ${voldoende ? `${uit.tekst.length} tekens` : 'geen tekstlaag'}`);
    await logResult(db, Number(bron.id), 'iBabs-grote-bijlagen', voldoende ? 1 : 0, voldoende ? 0 : 1, 0, 1);
  } catch (error) {
    const melding = String(error.message || error).slice(0, 500);
    await db.execute({
      sql: `UPDATE raw_item_attachments SET grote_pogingen=COALESCE(grote_pogingen,0)+1,
            grote_fout=?,opgehaald_at=datetime('now') WHERE id=?`,
      args: [melding, kandidaat.id],
    });
    console.error(`iBabs-grote-bijlagen: ${kandidaat.document_id} mislukt: ${melding}`);
    await logResult(db, Number(bron.id), 'iBabs-grote-bijlagen', 0, 0, 1, 1);
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
