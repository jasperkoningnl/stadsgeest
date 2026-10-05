// Eenmalig (3 oktober 2026): OCR-uitvoer die alleen ruis is, weer intrekken.
//
// Tesseract maakt van foto's, kaarten en handschrift ook "tekst". Tot vandaag
// telde alles boven de 200 tekens als gelukt; 30 van de 45 OCR-bijlagen bleken
// ruis en stonden zo in full_text. Dit script zet zulke bijlagen terug op
// geen_tekst (met de reden in ocr_fout) en bouwt full_text van de betrokken
// items opnieuw op. De maat staat in src/ibabs-ocr-lib.js (isLeesbareOcr); de
// OCR-job gebruikt dezelfde maat voor nieuwe scans.
//
// Gebruik (vanuit scraper/): node opruimen-ocr-ruis-20261003.mjs            droog
//                            node opruimen-ocr-ruis-20261003.mjs --apply
import db from '../src/db.js';
import { aandeelGewoneWoorden, isLeesbareOcr, OCR_RUIS_MELDING } from '../src/ibabs-ocr-lib.js';
import { herbouwEnMarkeer } from '../src/scrapers/ibabs-ocr.js';

const APPLY = process.argv.includes('--apply');
const rijen = (await db.execute("SELECT id, raw_item_id, tekens, tekst FROM raw_item_attachments WHERE tekstbron = 'ocr' AND status = 'ok' ORDER BY id")).rows;
const ruis = rijen.filter((r) => !isLeesbareOcr(r.tekst));
const items = [...new Set(ruis.map((r) => Number(r.raw_item_id)))];
console.log(`${rijen.length} OCR-bijlagen, ${ruis.length} ruis in ${items.length} items, ${rijen.length - ruis.length} leesbaar.`);
for (const r of ruis.slice(0, 5)) console.log(`  ruis #${r.id} (${aandeelGewoneWoorden(r.tekst).toFixed(2)}): ${String(r.tekst).replace(/\s+/g, ' ').slice(0, 60)}`);
if (!APPLY) { console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.'); process.exit(0); }

for (const r of ruis) {
  await db.execute({
    sql: "UPDATE raw_item_attachments SET status = 'geen_tekst', tekst = NULL, tekens = 0, tekstbron = NULL, ocr_fout = ? WHERE id = ?",
    args: [OCR_RUIS_MELDING, r.id],
  });
}
for (const id of items) await herbouwEnMarkeer(id);
console.log(`${ruis.length} bijlagen teruggezet, full_text van ${items.length} items opnieuw opgebouwd.`);
