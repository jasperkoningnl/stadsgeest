'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { teVerwijderen } = require('../../src/snapshot-opruimen.cjs');
const { magSnapshotBewaren } = require('../../src/kg/phase3-core.cjs');

const f = (dag, uur, hash) => `2026-${dag}T${uur}-00-00-000Z-${hash.padEnd(12, '0')}.gz`;
const nu = new Date('2026-10-04T12:00:00Z');

test('dubbele hash: alleen de oudste kopie blijft, ook in een gewone map', () => {
  const namen = [f('09-13', '18', 'aaa'), f('09-20', '07', 'aaa'), f('09-27', '04', 'aaa'), f('09-13', '18', 'bbb'), 'manifest.json'];
  assert.deepEqual(teVerwijderen(namen, { nu }).sort(), [f('09-20', '07', 'aaa'), f('09-27', '04', 'aaa')].sort());
});

test('kwartierbron: laatste per dag en de laatste 48 uur blijven', () => {
  const namen = [
    f('09-30', '08', 'a01'), f('09-30', '12', 'a02'), f('09-30', '23', 'a03'),
    f('10-01', '09', 'b01'), f('10-01', '10', 'b02'),
    f('10-03', '06', 'c01'), f('10-03', '15', 'c02'), f('10-04', '09', 'd01'),
  ];
  assert.deepEqual(teVerwijderen(namen, { kwartier: true, nu }).sort(),
    [f('09-30', '08', 'a01'), f('09-30', '12', 'a02'), f('10-01', '09', 'b01')].sort());
  assert.deepEqual(teVerwijderen(namen, { nu }), []);
});

test('momentopname: zelfde inhoud of binnen twintig uur wordt niet opnieuw bewaard', () => {
  const laatste = { fetched_at: '2026-10-04 11:45:00', content_hash: 'h1', storage_uri: 'data/x.gz' };
  assert.deepEqual(magSnapshotBewaren(null, 'h1', nu), { bewaren: true, storageUri: null });
  assert.deepEqual(magSnapshotBewaren(laatste, 'h1', nu), { bewaren: false, storageUri: 'data/x.gz' });
  assert.deepEqual(magSnapshotBewaren(laatste, 'h2', nu), { bewaren: false, storageUri: null });
  assert.deepEqual(magSnapshotBewaren({ ...laatste, fetched_at: '2026-10-03 06:16:00' }, 'h2', nu), { bewaren: true, storageUri: null });
});

test('bekende Notubiz-documenten worden uit alle URL-vormen herkend', async () => {
  const { bekendeDocumentIds } = await import('../../src/notubiz-lib.js');
  const ids = bekendeDocumentIds([
    'https://api.notubiz.nl/document/16145664/1',
    'https://amersfoort.raadsinformatie.nl/document/17422842/2#search=x',
    'https://amersfoort.notubiz.nl/document/123/1',
    'https://example.org/document/999/1', null,
  ]);
  assert.deepEqual([...ids].sort(), ['123', '16145664', '17422842']);
});
