/**
 * opruim-clusters.mjs — controleert en herstelt fout-geclusterde items.
 *
 * Standaard is dit een dry-run. Alleen met --commit worden wijzigingen gedaan.
 * Signalen die aan een tip gekoppeld zijn blijven altijd onaangeroerd.
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  entiteitMatchToegestaan,
  normalizeTitle,
  woordMatchScore,
} from './src/intake-matching.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DROOG = !process.argv.includes('--commit');
const BEKENDE_FOUTCLUSTERS = [587, 766, 931, 1279, 1348, 1612, 1695];

function setsVoor(rows) {
  return {
    strong: new Set(rows.filter(r => r.entity_type !== 'location').map(r => r.normalized_name)),
    locations: new Set(rows.filter(r => r.entity_type === 'location').map(r => r.normalized_name)),
  };
}

function overlap(itemEntities, seedEntities) {
  let strongMatches = 0;
  let locationMatches = 0;
  for (const naam of itemEntities.strong) if (seedEntities.strong.has(naam)) strongMatches++;
  for (const naam of itemEntities.locations) if (seedEntities.locations.has(naam)) locationMatches++;
  return { strongMatches, locationMatches };
}

async function entiteitenVoor(rawIds) {
  const result = new Map(rawIds.map(id => [id, { strong: new Set(), locations: new Set() }]));
  for (let i = 0; i < rawIds.length; i += 100) {
    const ids = rawIds.slice(i, i + 100);
    const ph = ids.map(() => '?').join(',');
    const rows = await db.execute({
      sql: `SELECT raw_item_id, entity_type, normalized_name
            FROM entities
            WHERE raw_item_id IN (${ph})
              AND entity_type IN ('person','organization','address','location')`,
      args: ids,
    });
    const perItem = new Map();
    for (const row of rows.rows) {
      if (!perItem.has(row.raw_item_id)) perItem.set(row.raw_item_id, []);
      perItem.get(row.raw_item_id).push(row);
    }
    for (const [id, values] of perItem) result.set(id, setsVoor(values));
  }
  return result;
}

async function run() {
  console.log(DROOG
    ? '=== DRY RUN — geen wijzigingen; gebruik --commit om toe te passen ===\n'
    : '=== LIVE RUN — onbetrouwbare koppelingen worden hersteld ===\n');

  const kandidaten = await db.execute({
    sql: `SELECT s.id, s.title, s.status,
                 (SELECT COUNT(*) FROM signal_items si WHERE si.signal_id = s.id) AS item_count,
                 (SELECT COUNT(*) FROM tip_signals ts WHERE ts.signal_id = s.id) AS tip_count
          FROM signals s
          WHERE s.status IN ('new','watching')
            AND ((SELECT COUNT(*) FROM signal_items si WHERE si.signal_id = s.id) > 10
                 OR s.id IN (${BEKENDE_FOUTCLUSTERS.map(() => '?').join(',')})
                 OR EXISTS (
                   SELECT 1 FROM signal_events se
                   WHERE se.signal_id = s.id AND se.actor = 'opruim-clusters'
                 ))
          ORDER BY item_count DESC`,
    args: BEKENDE_FOUTCLUSTERS,
  });

  let totaalOntkoppeld = 0;
  let totaalSignalen = 0;
  let overgeslagenTips = 0;

  for (const sig of kandidaten.rows) {
    if (Number(sig.tip_count) > 0) {
      console.log(`OVERGESLAGEN #${sig.id}: gekoppeld aan ${sig.tip_count} tip(s)`);
      overgeslagenTips++;
      continue;
    }

    const items = await db.execute({
      sql: `SELECT si.raw_item_id, si.added_at, r.title, src.name AS source_name
            FROM signal_items si
            JOIN raw_items r ON r.id = si.raw_item_id
            LEFT JOIN sources src ON src.id = r.source_id
            WHERE si.signal_id = ?
            ORDER BY datetime(si.added_at), si.raw_item_id`,
      args: [sig.id],
    });
    if (items.rows.length <= 1) continue;

    // Bij oude bulkimports hebben alle koppelingen soms hetzelfde added_at.
    // De signaaltitel is dan betrouwbaarder dan het laagste raw-item-id voor het
    // aanwijzen van de oorspronkelijke kern.
    const titelIndex = items.rows.findIndex(item => normalizeTitle(item.title) === normalizeTitle(sig.title));
    const seed = titelIndex >= 0 ? items.rows[titelIndex] : items.rows[0];
    const overigeItems = items.rows.filter(item => item.raw_item_id !== seed.raw_item_id);
    const signalVoorMatch = {
      title: sig.title,
      seed_title: seed.title,
      seed_source_name: seed.source_name,
    };
    const entityMap = await entiteitenVoor(items.rows.map(r => r.raw_item_id));
    const seedEntities = entityMap.get(seed.raw_item_id);
    const teOntkoppelen = [];

    for (const item of overigeItems) {
      const itemVoorMatch = { title: item.title, source_name: item.source_name };
      const woordMatch = woordMatchScore(itemVoorMatch, signalVoorMatch) > 0;
      const entityCounts = overlap(entityMap.get(item.raw_item_id), seedEntities);
      const entityMatch = entiteitMatchToegestaan(itemVoorMatch, signalVoorMatch, entityCounts);
      if (!woordMatch && !entityMatch) teOntkoppelen.push(item);
    }

    if (teOntkoppelen.length === 0) continue;
    console.log(`\n#${sig.id} ${items.rows.length} items: ${teOntkoppelen.length} onbetrouwbare koppelingen`);
    console.log(`  KERN: [${seed.raw_item_id}] "${(seed.title || '').substring(0, 75)}"`);
    for (const item of teOntkoppelen.slice(0, 3)) {
      console.log(`  LOS:  [${item.raw_item_id}] "${(item.title || '').substring(0, 75)}"`);
    }
    if (teOntkoppelen.length > 3) console.log(`  ... en ${teOntkoppelen.length - 3} meer`);

    if (!DROOG) {
      const ids = teOntkoppelen.map(r => r.raw_item_id);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const ph = chunk.map(() => '?').join(',');
        await db.execute({
          sql: `DELETE FROM signal_items WHERE signal_id = ? AND raw_item_id IN (${ph})`,
          args: [sig.id, ...chunk],
        });
        await db.execute({
          sql: `UPDATE raw_items SET is_processed = 0
                WHERE id IN (${ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM signal_items si WHERE si.raw_item_id = raw_items.id
                  )`,
          args: chunk,
        });
        await db.execute({
          sql: `DELETE FROM entity_signals
                WHERE signal_id = ? AND entity_id IN (
                  SELECT id FROM entities WHERE raw_item_id IN (${ph})
                )`,
          args: [sig.id, ...chunk],
        });
      }

      await db.execute({
        sql: `UPDATE signals
              SET confirmations = MAX(1, (SELECT COUNT(*) FROM signal_items WHERE signal_id = ?)),
                  last_seen_at = COALESCE(
                    (SELECT MAX(r.scraped_at) FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id WHERE si.signal_id = ?),
                    last_seen_at
                  )
              WHERE id = ?`,
        args: [sig.id, sig.id, sig.id],
      });
      await db.execute({
        sql: `INSERT INTO signal_events (signal_id, actor, event_type, reason)
              VALUES (?, 'opruim-clusters', 'cleanup', ?)`,
        args: [sig.id, `${teOntkoppelen.length} koppelingen verwijderd: ze faalden zowel de geteste titel-/documenttoets als de seed-entiteitstoets. Raw-item-id's: ${ids.join(',')}. Items zijn teruggezet voor herverwerking.`],
      });
    }

    totaalOntkoppeld += teOntkoppelen.length;
    totaalSignalen++;
  }

  console.log('\n═══ SAMENVATTING ═══');
  console.log(`Signalen met herstel: ${totaalSignalen}`);
  console.log(`Items los te maken:   ${totaalOntkoppeld}`);
  console.log(`Met tips overgeslagen:${overgeslagenTips}`);
  if (DROOG) console.log('\nDit was een dry run.');
}

run().catch(error => {
  console.error('FOUT:', error.message);
  process.exitCode = 1;
});
