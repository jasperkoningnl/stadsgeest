// Eenmalige inhaalslag (3 oktober 2026): deelitems maken voor documenten die
// langer zijn dan full_text (200.000 tekens). Zie src/deelitems-lib.mjs.
//
// 1. Woo-besluiten en convenanten (iBabs): de volledige tekst staat al per
//    bijlage in raw_item_attachments; hier wordt niets gedownload.
// 2. Overige stukken waarvan full_text op de grens is afgekapt (begroting,
//    jaarverslag, lange ingekomen stukken): de pdf wordt opnieuw opgehaald.
//
// Deelitems zijn historisch en verwerkt: er ontstaan geen signalen.
//
// Gebruik (vanuit scraper/, na migrate-raw-item-parts.mjs):
//   node backfill-deelitems-20261003.mjs            droog: telt, schrijft niets
//   node backfill-deelitems-20261003.mjs --apply    opties: --alleen woo | pdf
import db from '../src/db.js';
import { bouwFullText } from '../src/ibabs-ocr-lib.js';
import { verdeelRest, HOOFDITEM_TEKENS } from '../src/deelitems-lib.mjs';
import { werkDeelitemsBij } from '../src/deelitems.mjs';
import { haalNotubizTekst, isNotubizUrl, pdfBufferNaarTekst } from '../src/notubiz-fulltext.mjs';

const APPLY = process.argv.includes('--apply');
const i = process.argv.indexOf('--alleen');
const ALLEEN = i > -1 ? process.argv[i + 1] : '';
const UA = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';
const tel = { items: 0, delen: 0, tekens: 0, aangemaakt: 0, bijgewerkt: 0, ongewijzigd: 0, mislukt: 0 };

async function verwerk(id, label, tekst) {
  const delen = verdeelRest(tekst);
  if (!delen.length) return;
  tel.items++; tel.delen += delen.length; tel.tekens += tekst.length - HOOFDITEM_TEKENS;
  console.log(`  #${id} ${label}: ${tekst.length} tekens, ${delen.length} delen`);
  if (!APPLY) return;
  // Na een lange download sluit Turso de wachtende verbinding ("fetch failed").
  // werkDeelitemsBij is idempotent, dus opnieuw proberen is veilig.
  let uit;
  for (let poging = 1; ; poging++) {
    try { uit = await werkDeelitemsBij(db, id, tekst); break; } catch (e) {
      if (poging >= 4 || !/fetch failed|socket|ECONNRESET/i.test(`${e.message} ${e.cause?.message || ''}`)) throw e;
      await new Promise((klaar) => setTimeout(klaar, 1500 * poging));
    }
  }
  tel.aangemaakt += uit.aangemaakt; tel.bijgewerkt += uit.bijgewerkt; tel.ongewijzigd += uit.ongewijzigd;
}

if (ALLEEN !== 'pdf') {
  const groot = (await db.execute(`SELECT raw_item_id, sum(tekens) AS tekens FROM raw_item_attachments
    WHERE status = 'ok' GROUP BY raw_item_id HAVING sum(tekens) > 150000 ORDER BY raw_item_id`)).rows;
  console.log(`Woo/iBabs: ${groot.length} items met veel bijlagetekst`);
  for (const g of groot) {
    const item = (await db.execute({ sql: 'SELECT content, title FROM raw_items WHERE id = ?', args: [g.raw_item_id] })).rows[0];
    const bijlagen = (await db.execute({
      sql: "SELECT titel, tekst FROM raw_item_attachments WHERE raw_item_id = ? AND status = 'ok' ORDER BY id", args: [g.raw_item_id],
    })).rows;
    await verwerk(Number(g.raw_item_id), String(item?.title || '').slice(0, 50), bouwFullText(item?.content || '', bijlagen, Number.MAX_SAFE_INTEGER));
  }
}

if (ALLEEN !== 'woo') {
  const afgekapt = (await db.execute(`SELECT r.id, r.source_id, r.external_url, r.title FROM raw_items r
    WHERE length(r.full_text) >= ${HOOFDITEM_TEKENS} AND r.external_url NOT LIKE '%#deel=%'
      AND r.source_id <> 164 -- Statenstukken: provinciebreed, zou vooral niet-lokale namen toevoegen
      AND NOT EXISTS (SELECT 1 FROM raw_item_attachments a WHERE a.raw_item_id = r.id)
    ORDER BY r.id`)).rows;
  console.log(`Overige afgekapte stukken: ${afgekapt.length}`);
  for (const r of afgekapt) {
    const url = String(r.external_url);
    let tekst = null;
    try {
      if (isNotubizUrl(url)) tekst = (await haalNotubizTekst(url)).text;
      else {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
        const buf = Buffer.from(await res.arrayBuffer());
        if (res.ok && buf.subarray(0, 5).toString('latin1') === '%PDF-') tekst = await pdfBufferNaarTekst(buf);
      }
    } catch (e) { console.log(`  #${r.id} fout: ${e.message}`); }
    if (!tekst) { tel.mislukt++; console.log(`  #${r.id} bron ${r.source_id}: geen pdf-tekst op te halen (${url.slice(0, 80)})`); continue; }
    await verwerk(Number(r.id), `bron ${r.source_id} ${String(r.title || '').slice(0, 45)}`, tekst);
    await new Promise((klaar) => setTimeout(klaar, 500));
  }
}

console.log(JSON.stringify(tel));
if (!APPLY) console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.');
