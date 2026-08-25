/**
 * opruim-clusters.mjs — Ontkoppelt fout-geclusterde items uit vervuilde signalen
 *
 * Draait in de scraper-map: node opruim-clusters.mjs
 *
 * Wat het doet:
 * 1. Signalen met >10 items worden teruggebracht naar hun oorspronkelijke items
 *    (het eerste item op scraped_at, dat bij de titel hoort)
 * 2. Losgekoppelde items krijgen is_processed=0 zodat ze opnieuw door de intake gaan
 *    (nu mét de fix die ruis-entiteiten en omnibus-documenten goed behandelt)
 * 3. Confirmations wordt gereset naar het werkelijke aantal items
 * 4. Er wordt een signal_event geschreven dat de opruiming logt
 *
 * Veiligheidsmaatregelen:
 * - Draait standaard in dry-run; pas --commit mee voor echte wijzigingen
 * - Signalen die aan een tip gekoppeld zijn worden overgeslagen
 * - Elk signaal behoudt minstens zijn eerste item
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DROOG = !process.argv.includes('--commit');

async function run() {
  if (DROOG) {
    console.log('=== DRY RUN — geen wijzigingen. Gebruik --commit voor echte opruiming ===\n');
  } else {
    console.log('=== LIVE RUN — wijzigingen worden doorgevoerd ===\n');
  }

  // Vind vervuilde signalen (>10 items, niet aan een tip gekoppeld)
  const vervuild = await db.execute(`
    SELECT s.id, s.title, s.confirmations, s.status,
           (SELECT COUNT(*) FROM signal_items si WHERE si.signal_id = s.id) AS item_count,
           (SELECT COUNT(*) FROM tip_signals ts WHERE ts.signal_id = s.id) AS tip_count
    FROM signals s
    WHERE s.status IN ('new', 'watching')
      AND (SELECT COUNT(*) FROM signal_items si WHERE si.signal_id = s.id) > 10
    ORDER BY item_count DESC
  `);

  let totaalOntkoppeld = 0;
  let totaalSignalen = 0;

  for (const sig of vervuild.rows) {
    if (sig.tip_count > 0) {
      console.log(`OVERGESLAGEN #${sig.id} (${sig.item_count} items): aan ${sig.tip_count} tip(s) gekoppeld — "${(sig.title || '').substring(0, 60)}"`);
      continue;
    }

    // Vind het eerste item (de oorspronkelijke kern van het signaal)
    const items = await db.execute({
      sql: `SELECT si.raw_item_id, r.title, r.scraped_at
            FROM signal_items si
            JOIN raw_items r ON r.id = si.raw_item_id
            WHERE si.signal_id = ?
            ORDER BY r.scraped_at ASC`,
      args: [sig.id],
    });

    if (items.rows.length <= 1) continue;

    const eersteItem = items.rows[0];
    const teOntkoppelen = items.rows.slice(1);

    console.log(`\n#${sig.id} "${(sig.title || '').substring(0, 60)}" — ${items.rows.length} items, ${teOntkoppelen.length} ontkoppelen`);
    console.log(`  BEHOUDEN: [${eersteItem.raw_item_id}] "${(eersteItem.title || '').substring(0, 60)}"`);
    for (const it of teOntkoppelen.slice(0, 3)) {
      console.log(`  LOSKOPPELEN: [${it.raw_item_id}] "${(it.title || '').substring(0, 60)}"`);
    }
    if (teOntkoppelen.length > 3) {
      console.log(`  ... en ${teOntkoppelen.length - 3} meer`);
    }

    if (!DROOG) {
      const losIds = teOntkoppelen.map(r => r.raw_item_id);

      // Verwijder de fout-gekoppelde items uit signal_items
      for (let i = 0; i < losIds.length; i += 50) {
        const chunk = losIds.slice(i, i + 50);
        const ph = chunk.map(() => '?').join(',');
        await db.execute({
          sql: `DELETE FROM signal_items WHERE signal_id = ? AND raw_item_id IN (${ph})`,
          args: [sig.id, ...chunk],
        });
      }

      // Zet is_processed=0 zodat ze opnieuw door de intake gaan
      for (let i = 0; i < losIds.length; i += 50) {
        const chunk = losIds.slice(i, i + 50);
        const ph = chunk.map(() => '?').join(',');
        await db.execute({
          sql: `UPDATE raw_items SET is_processed = 0 WHERE id IN (${ph})`,
          args: chunk,
        });
      }

      // Verwijder entity_signals-koppelingen voor de losgekoppelde items
      for (let i = 0; i < losIds.length; i += 50) {
        const chunk = losIds.slice(i, i + 50);
        const ph = chunk.map(() => '?').join(',');
        await db.execute({
          sql: `DELETE FROM entity_signals WHERE signal_id = ? AND entity_id IN (
                  SELECT e.id FROM entities e WHERE e.raw_item_id IN (${ph})
                )`,
          args: [sig.id, ...chunk],
        });
      }

      // Reset confirmations
      await db.execute({
        sql: `UPDATE signals SET confirmations = 1 WHERE id = ?`,
        args: [sig.id],
      });

      // Log de opruiming
      await db.execute({
        sql: `INSERT INTO signal_events (signal_id, actor, event_type, reason)
              VALUES (?, 'opruimscript', 'cleanup', ?)`,
        args: [sig.id, `${teOntkoppelen.length} fout-geclusterde items ontkoppeld en teruggezet naar is_processed=0 voor herverwerking. Oorzaak: entity-matching op ruis-entiteiten (wethouders, burgemeester) en ontbrekende cap op grote signalen. Fixes doorgevoerd in intake-run.mjs op 2026-08-23.`],
      });
    }

    totaalOntkoppeld += teOntkoppelen.length;
    totaalSignalen++;
  }

  console.log(`\n═══ SAMENVATTING ═══`);
  console.log(`Signalen opgeruimd:   ${totaalSignalen}`);
  console.log(`Items ontkoppeld:     ${totaalOntkoppeld}`);
  console.log(`Items worden herverwerkt door de eerstvolgende intake-run`);
  if (DROOG) {
    console.log(`\nDit was een dry run. Gebruik: node opruim-clusters.mjs --commit`);
  }
}

run().catch(e => {
  console.error('FOUT:', e.message);
  process.exitCode = 1;
});
