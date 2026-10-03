// Migratie (3 oktober 2026): drie indexen die volledige tabelscans wegnemen.
// Eén keer draaien: node migrate-indexen-20261003.mjs (vanuit scraper/). Idempotent.
//
// Waarom: elke scraper controleert per gevonden item of het al bestaat. Die
// controle zocht op external_url of op content_hash zonder bruikbare index en
// las dus bij elk item de hele raw_items-tabel (bijna 12.000 rijen). Bij ruim
// 600 items per run-all en vier runs per dag is dat rond 30 mln reads per dag,
// het grootste deel van het Turso-verbruik. Gemeten op 3 oktober: 11 mln reads
// rond de run-all van 21.30 uur. Zie docs/DATABASE-LEZEN.md.
import db from './src/db.js';

for (const sql of [
  'CREATE INDEX IF NOT EXISTS idx_raw_items_url ON raw_items(external_url)',
  'CREATE INDEX IF NOT EXISTS idx_raw_items_source_title ON raw_items(source_id, title)',
  'CREATE INDEX IF NOT EXISTS idx_signal_items_item ON signal_items(raw_item_id)',
]) {
  await db.execute(sql);
  console.log(`ok: ${sql.replace('CREATE INDEX IF NOT EXISTS ', '')}`);
}

// Controle: de drie zoekvragen moeten SEARCH ... USING INDEX geven, geen SCAN.
for (const [naam, sql] of [
  ['insertItem op URL', "SELECT id FROM raw_items WHERE external_url = 'x'"],
  ['insertItem op titel', "SELECT id FROM raw_items WHERE source_id = 1 AND title = 'x'"],
  ['saveRawItem', "UPDATE raw_items SET published_at = 'x' WHERE source_id = 1 AND content_hash = 'x' AND published_at IS NULL"],
  ['signaal bij item', 'SELECT signal_id FROM signal_items WHERE raw_item_id = 1'],
]) {
  const plan = (await db.execute(`EXPLAIN QUERY PLAN ${sql}`)).rows.map((r) => r.detail).join(' | ');
  console.log(`${naam}: ${plan}`);
}
