// Eenmalig (3 oktober 2026): leesbare titels voor de pdf's van bron 28 (Financiën).
//
// De titel was de linktekst ("2026 gepubliceerd op 23 september2026"). De scraper
// maakt nu bestandsnaam plus linktekst (pdfTitel). Omdat de dubbelcontrole op
// titel plus URL draait, krijgen de bestaande items dezelfde nieuwe titel én
// de bijbehorende content_hash; anders zou de volgende scrape ze als nieuw zien.
// Ook de deelitems en signalen die de oude titel droegen gaan mee.
//
// Gebruik (vanuit scraper/): node migrate-financien-titels-20261003.mjs [--apply]
import db from './src/db.js';
import { contentHash } from './src/utils.js';
import { pdfTitel } from './src/financien-lib.mjs';

const APPLY = process.argv.includes('--apply');
const items = (await db.execute(`SELECT id, title, external_url FROM raw_items
  WHERE source_id = 28 AND external_url LIKE '%financien.amersfoort.nl/assets/docs/%' AND external_url NOT LIKE '%#deel=%'
  ORDER BY id`)).rows;
const tel = { items: 0, delen: 0, signalen: 0, overgeslagen: 0 };
for (const it of items) {
  const oud = String(it.title || '');
  const nieuw = pdfTitel(String(it.external_url), oud);
  // Al omgezet (titel begint met de bestandsnaam): niet nog eens.
  const naam = pdfTitel(String(it.external_url), '');
  if (nieuw === oud || oud === naam || oud.startsWith(`${naam} (`)) { tel.overgeslagen++; continue; }
  if (tel.items < 4) console.log(`  #${it.id}: "${oud.replace(/\s+/g, ' ').slice(0, 45)}" -> "${nieuw}"`);
  tel.items++;
  if (!APPLY) continue;
  try {
    await db.execute({ sql: 'UPDATE raw_items SET title = ?, content_hash = ? WHERE id = ?', args: [nieuw, contentHash(`${nieuw}${it.external_url}`), it.id] });
  } catch (e) { tel.overgeslagen++; tel.items--; console.log(`  #${it.id} niet gewijzigd: ${e.message}`); continue; }
  const delen = (await db.execute({ sql: 'SELECT r.id, r.title, r.external_url FROM raw_item_parts p JOIN raw_items r ON r.id = p.part_id WHERE p.parent_id = ?', args: [it.id] })).rows;
  for (const d of delen) {
    const staart = (String(d.title).match(/ \(deel \d+ van \d+\)$/) || [''])[0];
    const titel = `${nieuw}${staart}`;
    await db.execute({ sql: 'UPDATE raw_items SET title = ?, content_hash = ? WHERE id = ?', args: [titel, contentHash(`${titel}${d.external_url}`), d.id] });
    tel.delen++;
  }
  const s = await db.execute({ sql: `UPDATE signals SET title = ? WHERE title = ? AND id IN (SELECT signal_id FROM signal_items WHERE raw_item_id = ?)`, args: [nieuw, oud, it.id] });
  tel.signalen += s.rowsAffected;
}
console.log(JSON.stringify(tel));
if (!APPLY) console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.');
