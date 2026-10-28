const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { LrkKinderopvangAdapter } = require('../../src/kg/adapters/lrk-kinderopvang.cjs');

function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  // Productiekolommen en unieke sleutels; geen description/raw_data in kg_events.
  sqlite.exec(`
    CREATE TABLE sources(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO sources VALUES(139,'Landelijk Register Kinderopvang');
    CREATE TABLE raw_items(id INTEGER PRIMARY KEY,source_id INTEGER,external_url TEXT,
      title TEXT,content TEXT,summary TEXT,scraped_at TEXT,content_hash TEXT,
      is_processed INTEGER,published_at TEXT,UNIQUE(source_id,content_hash));
    CREATE TABLE kg_events(id INTEGER PRIMARY KEY,event_type TEXT,source_id INTEGER,
      source_url TEXT,source_identifier TEXT,title TEXT,summary TEXT,occurred_at TEXT,
      fetched_at TEXT,provenance TEXT,parser_version TEXT,created_at TEXT);
    CREATE INDEX idx_events_source ON kg_events(source_id);
    CREATE TABLE source_records(id INTEGER PRIMARY KEY,source_id INTEGER,source_key TEXT,
      raw_object TEXT,content_hash TEXT,semantic_hash TEXT,previous_id INTEGER,change_type TEXT,
      UNIQUE(source_id,source_key,content_hash));
  `);
  const execute = async ({ sql, args = [] }) => {
    const stmt = sqlite.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) return { rows: stmt.all(...args) };
    const r = stmt.run(...args);
    return { rows: [], lastInsertRowid: r.lastInsertRowid, rowsAffected: r.changes };
  };
  const db = { execute, transaction: async () => {
    sqlite.exec('BEGIN IMMEDIATE');
    return { execute, commit: async () => sqlite.exec('COMMIT'), rollback: async () => sqlite.exec('ROLLBACK') };
  } };
  const adapter = new LrkKinderopvangAdapter({ db });
  adapter.sourceId = 139;
  const row = { lrk_id: '123456789', actuele_naam_oko: 'Testopvang', status: 'Geregistreerd',
    aantal_kindplaatsen: '40', naam_houder: 'Teststichting', kvk_nummer_houder: '12345678',
    type_oko: 'BSO', opvanglocatie_adres: 'Teststraat 1', opvanglocatie_woonplaats: 'Amersfoort' };
  return { sqlite, adapter, row, db };
}

test('LRK schrijft herhaalde capaciteitswijzigingen naar het echte kolomcontract, zonder duplicaten', async t => {
  const { sqlite, adapter, row } = setup(t);
  await adapter._saveSnapshot([row]);
  adapter._fetchAndParse = async () => [{ ...row, aantal_kindplaatsen: '30' }];
  assert.equal((await adapter.run()).events, 1);
  assert.equal((await adapter.run()).events, 0);
  adapter._fetchAndParse = async () => [{ ...row, aantal_kindplaatsen: '20' }];
  assert.equal((await adapter.run()).events, 1);
  const events = sqlite.prepare('SELECT * FROM kg_events ORDER BY id').all();
  assert.equal(events.length, 2);
  assert.notEqual(events[0].source_identifier, events[1].source_identifier);
  assert.match(events[0].summary, /40 naar 30/);
  assert.match(events[1].summary, /30 naar 20/);
  assert.equal(events[0].occurred_at, null);
  assert.equal(JSON.parse(events[0].provenance).current.aantal_kindplaatsen, '30');
  assert.equal(JSON.parse(events[1].provenance).previous.plaatsen, '30');
  assert.equal(events[0].parser_version, 'lrk-1.1');
  assert.equal(sqlite.prepare('SELECT count(*) n FROM raw_items').get().n, 2);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM source_records').get().n, 3);
});

for (const table of ['raw_items', 'kg_events', 'source_records']) {
  test(`LRK rolt alle writes terug bij een fout in ${table} en kan daarna hervatten`, async t => {
    const { sqlite, adapter, row, db } = setup(t);
    await adapter._saveSnapshot([row]);
    adapter._fetchAndParse = async () => [{ ...row, aantal_kindplaatsen: '30' }];
    sqlite.exec(`CREATE TRIGGER force_error BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'schrijffout'); END;`);
    await assert.rejects(adapter.run(), /schrijffout/);
    assert.equal(adapter.db, db);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM raw_items').get().n, 0);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM kg_events').get().n, 0);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM source_records').get().n, 1);
    sqlite.exec('DROP TRIGGER force_error');
    assert.equal((await adapter.run()).events, 1);
  });
}

test('LRK dry-run schrijft geen bron, events of snapshot', async t => {
  const { sqlite, adapter, row } = setup(t);
  sqlite.exec('DELETE FROM sources');
  adapter.sourceId = null;
  adapter.dryRun = true;
  adapter._fetchAndParse = async () => [row];
  assert.equal((await adapter.run()).events, 1);
  for (const table of ['sources', 'raw_items', 'kg_events', 'source_records']) {
    assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  }
});

test('LRK houdt een retry van dezelfde overgang idempotent', async t => {
  const { sqlite, adapter, row } = setup(t);
  const event = { type: 'CHILDCARE_OPENED', lrkId: row.lrk_id, row };
  await adapter._processEvent(event, { previousSnapshotId: 3, observedAt: '2026-10-27T04:00:00Z' });
  await adapter._processEvent(event, { previousSnapshotId: 3, observedAt: '2026-10-28T04:00:00Z' });
  assert.equal(sqlite.prepare('SELECT count(*) n FROM raw_items').get().n, 1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM kg_events').get().n, 1);
});
