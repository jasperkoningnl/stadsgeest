'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { isAlleenLezend, splitStatements } = require('../../src/weger-query.cjs');
const { afstandMeter, puntUitWkt } = require('../../src/weger-adres.cjs');
const { loadDocumentUittreksels } = require('../../src/weger-workset.cjs');

test('weger-query laat alleen lezende zoekvragen door', () => {
  assert.equal(isAlleenLezend('select count(*) from signals'), true);
  assert.equal(isAlleenLezend('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(isAlleenLezend("select * from tips where titel like '%delete%'"), true);
  assert.equal(isAlleenLezend('delete from tips'), false);
  assert.equal(isAlleenLezend('with x as (select 1) delete from tips'), false);
  assert.equal(isAlleenLezend('select 1; drop table tips'), false);
  assert.equal(isAlleenLezend('pragma table_info(tips)'), false);
});

test('weger-query splitst statements op puntkomma plus regeleinde', () => {
  assert.deepEqual(splitStatements('select 1;\nselect 2;\r\n'), ['select 1', 'select 2']);
});

test('weger-adres rekent afstand en leest PDOK-punten', () => {
  assert.deepEqual(puntUitWkt('POINT(5.3856 52.1565)'), [5.3856, 52.1565]);
  assert.equal(puntUitWkt(''), null);
  const d = afstandMeter([5.3856, 52.1565], [5.3857, 52.1565]);
  assert.ok(d > 6 && d < 8, `verwacht circa 7 m, kreeg ${d}`);
});

test('werkset neemt alleen de nieuwste zekere documentbevindingen mee', async () => {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(`
    CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE raw_items (id INTEGER PRIMARY KEY, source_id INTEGER, title TEXT, external_url TEXT);
    CREATE TABLE signal_items (signal_id INTEGER, raw_item_id INTEGER);
    CREATE TABLE document_uittreksels (id INTEGER PRIMARY KEY, sleutel TEXT, raw_item_id INTEGER,
      kern TEXT, feiten TEXT, tekstbron TEXT, afgekapt INTEGER, document_tekens INTEGER,
      tekens INTEGER, begin_in_document INTEGER, instructie_versie TEXT);
    CREATE INDEX idx_document_uittreksels_item ON document_uittreksels(raw_item_id,id DESC);
    CREATE UNIQUE INDEX idx_document_uittreksels_sleutel ON document_uittreksels(sleutel,id);
    INSERT INTO sources VALUES (1,'Gemeente');
    INSERT INTO raw_items VALUES (10,1,'Groot stuk','https://voorbeeld.invalid/stuk');
    INSERT INTO signal_items VALUES (7,10);
  `);
  const oud = JSON.stringify([{ soort: 'bedrag', zin: 'Oud.', bewijsstatus: 'direct', citaten: [{ tekst: 'oud', plek: 'p. 1' }] }]);
  const nieuw = JSON.stringify([
    { soort: 'bedrag', zin: 'Nieuw.', bewijsstatus: 'direct', citaten: [{ tekst: 'nieuw', plek: 'p. 2' }] },
    { soort: 'risico', zin: 'Onzeker.', bewijsstatus: 'extractie_onzeker', citaten: [{ tekst: 'ruis', plek: 'tabel' }] },
  ]);
  await db.execute({ sql: 'INSERT INTO document_uittreksels VALUES (1,?,?,?,?,?,?,?,?,?,?)', args: ['item-10', 10, 'oud', oud, 'content', 0, 50000, 50000, 0, 'productie-2'] });
  await db.execute({ sql: 'INSERT INTO document_uittreksels VALUES (2,?,?,?,?,?,?,?,?,?,?)', args: ['item-10', 10, 'nieuw', nieuw, 'content', 0, 50000, 50000, 0, 'productie-2'] });
  const u = await loadDocumentUittreksels(db, 7);
  assert.equal(u.length, 1);
  assert.equal(u[0].kern, 'nieuw');
  assert.deepEqual(u[0].feiten.map((f) => f.zin), ['Nieuw.']);
  await db.close();
});
