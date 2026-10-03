// Eenmalig (3 oktober 2026): twee soorten iBabs-bijlagen opnieuw lezen.
//
// 1. Afgekapt: bijlagen langer dan 150 pagina's die via de gewone route zijn
//    gelezen (grens was 150; nu 600). De rest van het stuk komt er alsnog bij.
// 2. Dun: bijlagen die als gelezen tellen maar minder dan 200 tekens per pagina
//    hebben (scans met een flintertje tekstlaag). Die gaan door OCR; de uitvoer
//    vervangt de tekst alleen als zij leesbaar is en langer dan wat er stond.
//
// Daarna wordt full_text van de betrokken items opnieuw opgebouwd, inclusief
// deelitems. Gebruik (vanuit scraper/): node herlees-ibabs-bijlagen-20261003.mjs [--apply]
import db from './src/db.js';
import { isLeesbareOcr, ocrPdf } from './src/ibabs-ocr-lib.js';
import { herbouwEnMarkeer } from './src/scrapers/ibabs-ocr.js';
import { herkansBijVerbrokenVerbinding } from './src/deelitems.mjs';

const APPLY = process.argv.includes('--apply');
const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const MAX_PAGINAS = 600;
const MAX_OCR_PAGINAS = 40;

async function pdfTekst(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const delen = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
      const inhoud = await (await doc.getPage(p)).getTextContent();
      delen.push(inhoud.items.map((i) => i.str).join(' '));
    }
    return delen.join('\n').replace(/[ \t]+/g, ' ').trim();
  } finally { await doc.destroy(); }
}

const rijen = (await db.execute(`SELECT id, raw_item_id, url, paginas, tekens, tekstbron, substr(titel, 1, 50) AS titel
  FROM raw_item_attachments
  WHERE status = 'ok' AND ((paginas > 150 AND tekstbron IS NULL) OR (paginas >= 3 AND tekens * 1.0 / paginas < 200))
  ORDER BY id`)).rows;
const geraakt = new Set();
const tel = { afgekapt_aangevuld: 0, ocr_vervangen: 0, ocr_niet_beter: 0, fout: 0 };
for (const r of rijen) {
  const dun = Number(r.tekens) / Number(r.paginas) < 200;
  try {
    const res = await fetch(String(r.url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    let tekst, bron;
    if (dun) {
      const uit = await ocrPdf(buf, { maxPaginas: MAX_OCR_PAGINAS });
      if (!isLeesbareOcr(uit.tekst) || uit.tekst.length <= Number(r.tekens)) {
        tel.ocr_niet_beter++;
        console.log(`  #${r.id} ${r.titel}: OCR niet beter (${uit.tekst.length} tekens), ongewijzigd`);
        continue;
      }
      tekst = uit.tekst; bron = 'ocr'; tel.ocr_vervangen++;
    } else {
      tekst = await pdfTekst(buf);
      if (tekst.length <= Number(r.tekens)) { console.log(`  #${r.id} ${r.titel}: niets erbij`); continue; }
      bron = r.tekstbron; tel.afgekapt_aangevuld++;
    }
    console.log(`  #${r.id} ${r.titel}: ${r.tekens} -> ${tekst.length} tekens (${dun ? 'OCR' : 'alle pagina\'s'})`);
    if (APPLY) {
      // Na minuten OCR is de verbinding met Turso gesloten; de update mag veilig opnieuw.
      await herkansBijVerbrokenVerbinding(() => db.execute({ sql: "UPDATE raw_item_attachments SET tekst = ?, tekens = ?, tekstbron = ?, opgehaald_at = datetime('now') WHERE id = ?", args: [tekst, tekst.length, bron, r.id] }));
      geraakt.add(Number(r.raw_item_id));
    }
  } catch (e) { tel.fout++; console.log(`  #${r.id} ${r.titel}: fout ${e.message}`); }
}
for (const id of geraakt) await herkansBijVerbrokenVerbinding(() => herbouwEnMarkeer(id));
console.log(JSON.stringify({ bekeken: rijen.length, ...tel, items_herbouwd: geraakt.size }));
if (!APPLY) console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.');
