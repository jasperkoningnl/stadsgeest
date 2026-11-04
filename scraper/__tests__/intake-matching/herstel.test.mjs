import test from 'node:test';
import assert from 'node:assert/strict';
import { herstelBesluit, leesMetHerkansing, maakBatcher } from '../../src/intake-herstel.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('afgebroken intake behoudt oorspronkelijke signaalkoppeling boven latere duplicaatfiltering', () => {
  const besluit = herstelBesluit(7, [
    { id: 1, raw_item_id: 7, signal_id: 9, decision: 'new_signal', reason: 'officiële bron' },
    { id: 2, raw_item_id: 7, signal_id: null, decision: 'filtered', reason: 'titel bestaat' },
  ], [{ raw_item_id: 7, signal_id: 9 }]);
  assert.equal(besluit.signal_id, 9);
  assert.equal(besluit.decision, 'new_signal');
  assert.match(besluit.reason, /officiële bron/);
});

test('koppeling zonder geflushte audit wordt hervat; verdwenen koppeling niet als succes hergebruikt', () => {
  assert.equal(herstelBesluit(7, [], [{ raw_item_id: 7, signal_id: 9 }]).signal_id, 9);
  assert.equal(herstelBesluit(7, [{ id: 1, raw_item_id: 7, signal_id: 9, decision: 'new_signal' }], []), null);
  assert.equal(herstelBesluit(8, [{ id: 1, raw_item_id: 8, decision: 'filtered', reason: 'routine' }], []).decision, 'filtered');
  assert.equal(herstelBesluit(10, [], []), null);
});

test('verbroken leesverbinding krijgt begrensde herkansing; writes en SQL-fouten niet', async () => {
  let calls = 0;
  const socket = new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
  const db = { async execute() { if (++calls < 3) throw socket; return { rows: [7] }; } };
  const options = { wacht: async () => {}, meld: () => {} };
  assert.deepEqual(await leesMetHerkansing(db, 'SELECT 1', options), { rows: [7] });
  assert.equal(calls, 3);
  await assert.rejects(leesMetHerkansing(db, 'UPDATE signals SET confirmations=confirmations+1', options), /uitsluitend/);
  let failures = 0;
  await assert.rejects(leesMetHerkansing({ execute: async () => { failures++; throw socket; } }, 'SELECT 1', options));
  assert.equal(failures, 3);
  failures = 0;
  await assert.rejects(leesMetHerkansing({ execute: async () => { failures++; throw Error('SQLITE_ERROR'); } }, 'SELECT 1', options));
  assert.equal(failures, 1);
});

test('onzekere batchwrite wordt bij foutafhandeling niet opnieuw verstuurd', async () => {
  let calls = 0;
  const batcher = maakBatcher({ batch: async () => { calls++; throw Error('verbinding weg na mogelijke commit'); } }, 1);
  await assert.rejects(batcher.push({ sql: 'INSERT INTO audit VALUES (1)' }));
  await assert.rejects(batcher.flush());
  assert.equal(calls, 1);
});

test('echte intake hervat na schrijffout zonder dubbele signalen, bevestigingen of verloren audit', () => {
  const scraper = fileURLToPath(new URL('../../', import.meta.url));
  mkdirSync(path.join(scraper, 'tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(scraper, 'tmp', 'intake-test-'));
  const dbPath = path.join(dir, 'fixture.db');
  const db = new DatabaseSync(dbPath);
  try {
    mkdirSync(path.join(dir, 'src'));
    copyFileSync(path.join(scraper, 'intake-run.mjs'), path.join(dir, 'intake-run.mjs'));
    for (const name of ['intake-matching.mjs', 'intake-herstel.mjs', 'routine-lib.mjs', 'omnibus-split-lib.mjs']) {
      copyFileSync(path.join(scraper, 'src', name), path.join(dir, 'src', name));
    }
    db.exec(`
      CREATE TABLE sources(id INTEGER PRIMARY KEY, name TEXT, reliability TEXT, category TEXT, tier INTEGER, bronrol TEXT);
      CREATE TABLE raw_items(id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, summary TEXT, content TEXT, external_url TEXT, scraped_at TEXT DEFAULT CURRENT_TIMESTAMP, published_at TEXT, is_processed INTEGER DEFAULT 0, is_historical INTEGER DEFAULT 0);
      CREATE TABLE signals(id INTEGER PRIMARY KEY, title TEXT, summary TEXT, status TEXT, confirmations INTEGER, threshold INTEGER, first_seen_at TEXT, last_seen_at TEXT);
      CREATE TABLE signal_items(signal_id INTEGER, raw_item_id INTEGER, added_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(signal_id,raw_item_id));
      CREATE TABLE persons(name TEXT);
      CREATE TABLE entities(id INTEGER PRIMARY KEY, raw_item_id INTEGER, entity_type TEXT, name TEXT, normalized_name TEXT, context TEXT);
      CREATE TABLE entity_signals(entity_id INTEGER, signal_id INTEGER, source_id TEXT, role TEXT, UNIQUE(entity_id,signal_id));
      CREATE TABLE intake_runs(id INTEGER PRIMARY KEY, trigger TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER, items_in INTEGER, items_filtered INTEGER, items_matched INTEGER, signals_created INTEGER, signals_historical INTEGER, thresholds_reached INTEGER, entities_created INTEGER, status TEXT, error_message TEXT);
      CREATE TABLE intake_decisions(id INTEGER PRIMARY KEY, intake_run_id INTEGER, raw_item_id INTEGER, source_id INTEGER, source_name TEXT, item_title TEXT, decision TEXT, reason TEXT, signal_id INTEGER, match_score INTEGER, tier INTEGER, entities_found TEXT);
      CREATE TABLE signal_events(id INTEGER PRIMARY KEY, signal_id INTEGER, actor TEXT, event_type TEXT, status_from TEXT, status_to TEXT, reason TEXT);
      INSERT INTO sources VALUES(1,'Officiële stukken','primary','government',1,NULL);
      INSERT INTO raw_items(id,source_id,title,content) VALUES(6,1,'Onderwijscentrum Hoogland krijgt schoolgebouw','bron'),(7,1,'Eerder gekoppelde ontwikkeling','De Alliantie'),(8,1,'Eerder gefilterde routine','routine'),(10,1,'Nieuwe bibliotheekinvestering','De Alliantie'),(11,1,'Onderwijscentrum Hoogland krijgt schoolgebouw','nieuwe officiële bevestiging');
      UPDATE raw_items SET is_processed=1 WHERE id=6;
      INSERT INTO signals VALUES(9,'Eerder gekoppelde ontwikkeling','bron','watching',1,1,'2026-10-01','2026-10-01');
      INSERT INTO signals VALUES(20,'Onderwijscentrum Hoogland krijgt schoolgebouw','bron','watching',1,1,'2026-10-01','2026-10-01');
      INSERT INTO signal_items(signal_id,raw_item_id) VALUES(9,7),(20,6);
      INSERT INTO intake_runs(id,status,started_at) VALUES(1,'error','2026-11-01');
      INSERT INTO intake_decisions(intake_run_id,raw_item_id,signal_id,decision,reason) VALUES(1,7,9,'new_signal','officiële bron'),(1,8,NULL,'filtered','routine');
      CREATE TRIGGER fout BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT,'test schrijffout'); END;
      CREATE TRIGGER koppelfout BEFORE INSERT ON signal_items WHEN NEW.raw_item_id=10 BEGIN SELECT RAISE(ABORT,'test koppelingsfout'); END;
    `);
    const run = () => spawnSync(process.execPath, [path.join(dir, 'intake-run.mjs'), 'test'], {
      cwd: dir, env: { ...process.env, TURSO_URL: `file:${dbPath.replace(/\\/g, '/')}`, TURSO_AUTH_TOKEN: '' }, encoding: 'utf8', timeout: 30000,
    });
    const linkFailure = run();
    assert.equal(linkFailure.status, 1, linkFailure.stderr);
    assert.equal(db.prepare('SELECT count(*) n FROM signals').get().n, 2, 'mislukte koppeling laat geen leeg nieuw signaal achter');
    db.exec('DROP TRIGGER koppelfout');
    const first = run();
    assert.equal(first.status, 1, first.stderr);
    assert.match(first.stderr, /entiteiten item 7/);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_items WHERE is_processed=1 AND id<>6').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM signals').get().n, 3);
    const bevestigd = db.prepare('SELECT confirmations,last_seen_at FROM signals WHERE id=20').get();
    assert.equal(bevestigd.confirmations, 2, 'één nieuwe bron telt éénmaal');
    db.exec('DROP TRIGGER fout');
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_items WHERE is_processed=1').get().n, 5);
    assert.equal(db.prepare('SELECT count(*) n FROM signals').get().n, 3);
    assert.deepEqual(db.prepare('SELECT confirmations,last_seen_at FROM signals WHERE id=20').get(), bevestigd);
    assert.equal(db.prepare('SELECT confirmations FROM signals WHERE id=9').get().confirmations, 1);
    assert.equal(db.prepare('SELECT last_seen_at FROM signals WHERE id=9').get().last_seen_at, '2026-10-01');
    assert.ok(db.prepare('SELECT entities_found FROM intake_decisions WHERE intake_run_id=4 AND raw_item_id=10').get().entities_found);
    assert.equal(db.prepare('SELECT status FROM intake_runs ORDER BY id DESC LIMIT 1').get().status, 'ok');
    const events = db.prepare('SELECT count(*) n FROM signal_events').get().n;
    assert.equal(run().status, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM signal_events').get().n, events);
  } finally {
    db.close();
    if (!path.resolve(dir).startsWith(path.resolve(scraper, 'tmp') + path.sep)) throw Error('onveilig testpad');
    rmSync(dir, { recursive: true, force: true });
  }
});
