import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { deelUrl, deelVelden, isDeelitem, verdeelRest } from '../../src/deelitems-lib.mjs';
import { werkDeelitemsBij } from '../../src/deelitems.mjs';

const klein = { eerste: 100, max: 50, minRest: 10 };

test('een document dat in het hoofditem past krijgt geen delen', () => {
  assert.deepEqual(verdeelRest('a'.repeat(90), klein), []);
  assert.deepEqual(verdeelRest('a'.repeat(105), klein), []); // staartje onder minRest
});

test('knipt de rest in delen, sluitend en zonder tekst te verliezen', () => {
  const tekst = `${'h'.repeat(100)}${'woord '.repeat(40).trim()}`;
  const delen = verdeelRest(tekst, klein);
  assert.ok(delen.length >= 5);
  assert.equal(delen[0].nummer, 2);
  assert.equal(delen[0].van, 100);
  assert.equal(delen[delen.length - 1].tot, tekst.length);
  for (let i = 1; i < delen.length; i++) assert.equal(delen[i].van, delen[i - 1].tot);
  assert.ok(delen.every((d) => d.tekst.length <= 50));
  assert.equal(delen.map((d) => d.tekst).join(' ').replace(/\s+/g, ' ').trim(), 'woord '.repeat(40).trim());
});

test('knipt bij voorkeur op een bijlagegrens', () => {
  const tekst = `${'h'.repeat(100)}${'a'.repeat(35)}\n\n=== Bijlage: brief ===\n${'b'.repeat(40)}`;
  const delen = verdeelRest(tekst, klein);
  assert.equal(delen[0].tekst, 'a'.repeat(35));
  assert.ok(delen[1].tekst.startsWith('=== Bijlage: brief ==='));
});

test('deel-URL en velden verwijzen naar het hoofditem', () => {
  assert.equal(deelUrl('https://x.nl/item#deel=2', 3), 'https://x.nl/item#deel=3');
  assert.equal(isDeelitem({ external_url: 'https://x.nl/item#deel=2' }), true);
  assert.equal(isDeelitem({ external_url: 'https://x.nl/item' }), false);
  const v = deelVelden({ id: 7, title: 'Woo-besluit', external_url: 'https://x.nl/item' }, { nummer: 2, van: 100, tot: 150 }, 4);
  assert.equal(v.title, 'Woo-besluit (deel 2 van 4)');
  assert.equal(v.external_url, 'https://x.nl/item#deel=2');
  assert.ok(v.content.includes('raw_item 7'));
});

async function maakDb() {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE raw_items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL, external_url TEXT, title TEXT,
      content TEXT, summary TEXT, scraped_at TEXT, content_hash TEXT, is_processed INTEGER NOT NULL DEFAULT 0,
      is_historical INTEGER DEFAULT 0, full_text TEXT, fulltext_fetched_at TEXT, entities_scanned_at TEXT, published_at TEXT);
    CREATE UNIQUE INDEX idx_raw_items_dedup ON raw_items(source_id, content_hash);
    CREATE TABLE raw_item_parts (part_id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL, deel INTEGER NOT NULL,
      van INTEGER NOT NULL, tot INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (parent_id, deel));
    INSERT INTO raw_items (id, source_id, external_url, title, scraped_at, content_hash, is_processed, entities_scanned_at)
      VALUES (1, 35, 'https://x.nl/woo/1', 'Woo-besluit', '2026-07-07 10:00:00', 'ouder', 1, '2026-07-08');
  `);
  return db;
}
const lang = (n) => `${'h'.repeat(200000)}${'tekst van de bijlage '.repeat(n)}`;

test('maakt deelitems die geen signaal opleveren en opnieuw draaien verandert niets', async () => {
  const db = await maakDb();
  const eerste = await werkDeelitemsBij(db, 1, lang(20000)); // 400.000 tekens voorbij het hoofditem
  assert.equal(eerste.aangemaakt, 3);
  const rijen = (await db.execute('SELECT id, title, external_url, is_processed, is_historical, scraped_at, length(full_text) AS n, entities_scanned_at FROM raw_items WHERE id > 1 ORDER BY id')).rows;
  assert.deepEqual(rijen.map((r) => r.external_url), ['https://x.nl/woo/1#deel=2', 'https://x.nl/woo/1#deel=3', 'https://x.nl/woo/1#deel=4']);
  assert.equal(rijen[0].title, 'Woo-besluit (deel 2 van 4)');
  assert.ok(rijen.every((r) => Number(r.is_processed) === 1 && Number(r.is_historical) === 1 && r.entities_scanned_at === null));
  assert.ok(rijen.every((r) => r.scraped_at === '2026-07-07 10:00:00' && Number(r.n) <= 180000));
  assert.equal(Number((await db.execute('SELECT count(*) AS n FROM raw_item_parts WHERE parent_id = 1')).rows[0].n), 3);

  const tweede = await werkDeelitemsBij(db, 1, lang(20000));
  assert.deepEqual(tweede, { aangemaakt: 0, bijgewerkt: 0, ongewijzigd: 3, vervallen: 0 });
});

test('werkt een gewijzigd deel bij, maakt een vervallen deel leeg en splitst een deelitem niet verder', async () => {
  const db = await maakDb();
  await werkDeelitemsBij(db, 1, lang(20000));
  const korter = await werkDeelitemsBij(db, 1, `${'h'.repeat(200000)}${'andere tekst '.repeat(1000)}`);
  assert.deepEqual(korter, { aangemaakt: 0, bijgewerkt: 1, ongewijzigd: 0, vervallen: 2 });
  const leeg = (await db.execute("SELECT count(*) AS n FROM raw_items WHERE id > 1 AND full_text IS NULL")).rows[0].n;
  assert.equal(Number(leeg), 2);
  assert.deepEqual(await werkDeelitemsBij(db, 2, lang(20000)), { aangemaakt: 0, bijgewerkt: 0, ongewijzigd: 0, vervallen: 0 });
});
