// Migratie (3 oktober 2026): koppeltabel voor deelitems van lange documenten.
// Eén keer draaien: node migrate-raw-item-parts.mjs (vanuit scraper/). Idempotent.
// Zie src/deelitems-lib.mjs voor het waarom.
import db from './src/db.js';

await db.batch([
  `CREATE TABLE IF NOT EXISTS raw_item_parts (
     part_id   INTEGER PRIMARY KEY REFERENCES raw_items(id),
     parent_id INTEGER NOT NULL REFERENCES raw_items(id),
     deel      INTEGER NOT NULL,
     van       INTEGER NOT NULL,
     tot       INTEGER NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (parent_id, deel)
   )`,
], 'write');
const n = (await db.execute('SELECT count(*) AS n FROM raw_item_parts')).rows[0].n;
console.log(`raw_item_parts bestaat; ${n} rijen.`);
