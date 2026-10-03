import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { biedSignalenOpnieuwAan } from '../../src/heraanbieden.mjs';

async function maakDb() {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE signals (id INTEGER PRIMARY KEY, status TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE TABLE signal_items (signal_id INTEGER NOT NULL, raw_item_id INTEGER NOT NULL, PRIMARY KEY (signal_id, raw_item_id));
    CREATE TABLE tip_signals (tip_id INTEGER NOT NULL, signal_id INTEGER NOT NULL, PRIMARY KEY (tip_id, signal_id));
    CREATE TABLE signal_events (id INTEGER PRIMARY KEY AUTOINCREMENT, signal_id INTEGER NOT NULL, actor TEXT NOT NULL,
      event_type TEXT NOT NULL, status_from TEXT, status_to TEXT, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO signals VALUES (1, 'discarded', '2026-09-01 00:00:00'), (2, 'watching', '2026-09-01 00:00:00'),
      (3, 'watching', '2026-09-01 00:00:00'), (4, 'published', '2026-09-01 00:00:00'), (5, 'watching', '2026-09-01 00:00:00');
    INSERT INTO signal_items VALUES (1, 10), (2, 10), (3, 10), (4, 10), (5, 11);
    INSERT INTO tip_signals VALUES (7, 3);
  `);
  return db;
}

test('biedt open en weggezette signalen van het item opnieuw aan, en laat de rest staan', async () => {
  const db = await maakDb();
  const n = await biedSignalenOpnieuwAan(db, 10, { actor: 'fetch-fulltext', reden: 'tekst later gepubliceerd' });
  assert.equal(n, 2);
  const rijen = (await db.execute('SELECT id, status, last_seen_at > \'2026-09-02\' AS nieuw FROM signals ORDER BY id')).rows;
  assert.deepEqual(rijen.map((r) => [Number(r.id), r.status, Number(r.nieuw)]), [
    [1, 'watching', 1],   // weggezet: terug naar watching
    [2, 'watching', 1],   // open: alleen last_seen_at
    [3, 'watching', 0],   // heeft al een tip
    [4, 'published', 0],  // eindstatus
    [5, 'watching', 0],   // hoort bij een ander item
  ]);
  const events = (await db.execute('SELECT signal_id, actor, event_type, status_from, status_to FROM signal_events ORDER BY signal_id')).rows;
  assert.deepEqual(events.map((e) => [Number(e.signal_id), e.actor, e.event_type, e.status_from, e.status_to]), [
    [1, 'fetch-fulltext', 'reoffered', 'discarded', 'watching'],
    [2, 'fetch-fulltext', 'reoffered', 'watching', 'watching'],
  ]);
});

test('een item zonder signaal levert nul op en schrijft niets', async () => {
  const db = await maakDb();
  assert.equal(await biedSignalenOpnieuwAan(db, 99, { actor: 'x', reden: 'y' }), 0);
  assert.equal(Number((await db.execute('SELECT count(*) AS n FROM signal_events')).rows[0].n), 0);
});
