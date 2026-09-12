// Handmatige terugvalroute voor recente Notubiz-documenten die Cloudflare voor
// geautomatiseerde downloads blokkeert en nog niet in Open Raadsinformatie staan.
// Gebruik:
//   node src/import-notubiz-pdf.mjs --raw-id 8672 --file "C:\\...\\stuk.pdf"

import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';
import { createDb } from './lib.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function argumentsFor(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

async function pdfNaarTekst(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const delen = [];
  for (let pagina = 1; pagina <= Math.min(doc.numPages, 60); pagina++) {
    const page = await doc.getPage(pagina);
    const inhoud = await page.getTextContent();
    delen.push(inhoud.items.map(item => item.str).join(' '));
  }
  await doc.destroy();
  return delen.join('\n').replace(/\s+/g, ' ').trim();
}

const rawId = Number(argument('--raw-id'));
const fileArgs = argumentsFor('--file');
if (!Number.isInteger(rawId) || rawId <= 0 || fileArgs.length === 0) {
  throw new Error('Gebruik: node src/import-notubiz-pdf.mjs --raw-id <id> --file <pdf-pad> [--file <bijlage.pdf>]');
}

const filePaths = fileArgs.map(fileArg => resolve(fileArg));
const tekstdelen = [];
for (const filePath of filePaths) {
  const buffer = await readFile(filePath);
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`${filePath} is geen PDF-bestand`);
  }
  const deel = await pdfNaarTekst(buffer);
  tekstdelen.push(filePaths.length > 1 ? `[${basename(filePath)}]\n${deel}` : deel);
}
const tekst = tekstdelen.join('\n\n');
if (tekst.length < 200) {
  throw new Error(`PDF leverde slechts ${tekst.length} tekens op; mogelijk is dit een scan zonder tekstlaag`);
}

const db = createDb();
try {
  const item = await db.execute({
    sql: `SELECT r.id, r.title, r.external_url
          FROM raw_items r
          WHERE r.id = ?`,
    args: [rawId],
  });
  if (item.rows.length !== 1) throw new Error(`raw_item ${rawId} bestaat niet`);
  if (!String(item.rows[0].external_url || '').includes('notubiz.nl/document/')) {
    throw new Error(`raw_item ${rawId} is geen Notubiz-document`);
  }
  const kenmerk = String(item.rows[0].title || '').match(/\b20\d{2}-\d{2,3}\b/);
  if (kenmerk && !tekst.includes(kenmerk[0])) {
    throw new Error(`PDF bevat kenmerk ${kenmerk[0]} van raw_item ${rawId} niet`);
  }

  await db.execute({
    sql: `UPDATE raw_items
          SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL
          WHERE id = ?`,
    args: [tekst.substring(0, 200000), new Date().toISOString(), rawId],
  });
  console.log(`[NOTUBIZ-IMPORT] raw_item ${rawId}: ${tekst.length} tekens uit ${filePaths.length} PDF-bestand(en)`);
} finally {
  await db.close();
}
