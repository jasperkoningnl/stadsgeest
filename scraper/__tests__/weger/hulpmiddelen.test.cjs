'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAlleenLezend, splitStatements } = require('../../src/weger-query.cjs');
const { afstandMeter, puntUitWkt } = require('../../src/weger-adres.cjs');

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
