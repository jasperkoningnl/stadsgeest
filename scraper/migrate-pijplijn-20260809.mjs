/**
 * migrate-pijplijn-20260809.mjs — hoort bij de herschikking van 9 augustus 2026.
 *
 * Idempotent. Vier dingen, allemaal veilig om vaker te draaien:
 *
 *  1. Kolom `raw_items.published_at` toevoegen. Nog niemand vult hem; hij is de haak
 *     waaraan de scrapers later de echte publicatiedatum van een document hangen.
 *     Zolang hij leeg is valt de intake terug op `scraped_at`.
 *  2. Drempel van open signalen op 1 zetten. De drempel van 3 stamt uit de tijd dat
 *     er geen weger was. De weger leest sinds 8 augustus dagelijks alles wat open
 *     staat, dus de drempel hield niets meer tegen; hij zette alleen een ander etiket.
 *  3. `entities_scanned_at` leegmaken voor items die zijn gescand vóórdat hun
 *     documenttekst binnenkwam. Die zijn permanent afgevinkt terwijl alleen de titel
 *     is gelezen. Zonder deze reset blijft de bestaande voorraad blind.
 *  4. `fulltext_fetched_at` leegmaken voor PDF-items die eerder zijn overgeslagen,
 *     zodat fetch-fulltext ze opnieuw probeert nu hij PDF's wél kan lezen.
 *
 * Draaien: node migrate-pijplijn-20260809.mjs [--doen]
 * Zonder --doen rapporteert hij alleen wat hij zou wijzigen.
 */

import { createDb } from './src/lib.js';

const db = createDb();
const DOEN = process.argv.includes('--doen');
const label = DOEN ? 'UITGEVOERD' : 'ZOU DOEN';

async function telling(sql, args = []) {
  const r = await db.execute({ sql, args });
  return Number(r.rows[0]?.n ?? 0);
}

console.log(`\n=== Migratie pijplijn 2026-08-09 (${DOEN ? 'echt' : 'proefdraai'}) ===\n`);

// ── 1. Kolom published_at ─────────────────────────────────────────────────────
const kolommen = (await db.execute("SELECT name FROM pragma_table_info('raw_items')")).rows.map(r => r.name);
if (kolommen.includes('published_at')) {
  console.log('1. raw_items.published_at bestaat al — overgeslagen');
} else if (DOEN) {
  await db.execute('ALTER TABLE raw_items ADD COLUMN published_at TEXT');
  console.log('1. UITGEVOERD: kolom raw_items.published_at toegevoegd');
} else {
  console.log('1. ZOU DOEN: kolom raw_items.published_at toevoegen');
}

// ── 2. Drempel naar 1 voor open signalen ──────────────────────────────────────
const drempelN = await telling(
  `SELECT COUNT(*) n FROM signals WHERE threshold <> 1 AND status NOT IN ('published','discarded')`
);
if (DOEN && drempelN > 0) {
  await db.execute(`UPDATE signals SET threshold = 1 WHERE threshold <> 1 AND status NOT IN ('published','discarded')`);
}
console.log(`2. ${label}: drempel op 1 gezet voor ${drempelN} open signalen`);

// ── 3. Entiteitsstempel resetten waar de tekst later kwam ─────────────────────
// Voorwaarde: het item is gescand (entities_scanned_at gezet), er is inmiddels
// documenttekst, en die tekst kwam ná de scan binnen — of de scanvolgorde is niet
// vast te stellen omdat een van beide tijdstempels ontbreekt.
const RESET_ENT = `
  UPDATE raw_items SET entities_scanned_at = NULL
  WHERE entities_scanned_at IS NOT NULL
    AND full_text IS NOT NULL AND length(full_text) > 200
    AND (fulltext_fetched_at IS NULL OR fulltext_fetched_at >= entities_scanned_at)`;
const entN = await telling(`SELECT COUNT(*) n FROM raw_items
  WHERE entities_scanned_at IS NOT NULL
    AND full_text IS NOT NULL AND length(full_text) > 200
    AND (fulltext_fetched_at IS NULL OR fulltext_fetched_at >= entities_scanned_at)`);
if (DOEN && entN > 0) await db.execute(RESET_ENT);
console.log(`3. ${label}: entities_scanned_at gewist voor ${entN} items met documenttekst`);

// ── 4. PDF's opnieuw aanbieden aan fetch-fulltext ─────────────────────────────
const PDF_WHERE = `
  full_text IS NULL AND fulltext_fetched_at IS NOT NULL
  AND (external_url LIKE '%.pdf%' OR external_url LIKE '%/pdf/%')`;
const pdfN = await telling(`SELECT COUNT(*) n FROM raw_items WHERE ${PDF_WHERE}`);
if (DOEN && pdfN > 0) {
  await db.execute(`UPDATE raw_items SET fulltext_fetched_at = NULL WHERE ${PDF_WHERE}`);
}
console.log(`4. ${label}: fulltext_fetched_at gewist voor ${pdfN} eerder overgeslagen PDF-items`);

console.log(`\n=== Klaar ===${DOEN ? '' : '\nNiets gewijzigd. Draai opnieuw met --doen.'}\n`);
