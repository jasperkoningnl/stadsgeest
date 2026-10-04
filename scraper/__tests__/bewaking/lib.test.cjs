'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { falendeScrapers, langStilleBronnen } = require('../../src/bewaking-lib.cjs');

const run = (scraper_file, dag, status) => ({ scraper_file, status, started_at: `2026-10-${dag}T23:06:00.000Z` });

test('scraper met drie timeouts op rij wordt gemeld, met het begin van de reeks', () => {
  const rijen = [
    run('bw-besluiten.js', '02', 'timeout'), run('bw-besluiten.js', '03', 'timeout'),
    run('bw-besluiten.js', '04', 'timeout'), run('bw-besluiten.js', '01', 'ok'),
    run('meander.js', '02', 'ok'), run('meander.js', '03', 'ok'), run('meander.js', '04', 'ok'),
  ];
  assert.deepEqual(falendeScrapers(rijen), [
    { scraper: 'bw-besluiten.js', aantal: 3, status: 'timeout', sinds: '2026-10-02' },
  ]);
});

test('een geslaagde laatste run of te weinig runs geeft geen melding', () => {
  const hersteld = [run('a.js', '01', 'timeout'), run('a.js', '02', 'error'), run('a.js', '03', 'ok')];
  const teKort = [run('b.js', '02', 'timeout'), run('b.js', '03', 'timeout')];
  const tussendoorGoed = [run('c.js', '01', 'timeout'), run('c.js', '02', 'ok'), run('c.js', '03', 'timeout')];
  assert.deepEqual(falendeScrapers([...hersteld, ...teKort, ...tussendoorGoed]), []);
});

test('lege runs en regels zonder scraper_file tellen niet als fout', () => {
  const rijen = [
    run('d.js', '01', 'empty'), run('d.js', '02', 'empty'), run('d.js', '03', 'empty'),
    { scraper_file: null, status: 'error', started_at: '2026-10-03 23:00:00' },
  ];
  assert.deepEqual(falendeScrapers(rijen), []);
});

test('tier-1-bron die leverde en drie weken niets brengt, komt op de lijst lang stil', () => {
  const nu = new Date('2026-10-04T10:00:00Z');
  const bronnen = [
    { id: 120, name: 'Raad — Vergaderingen en overig', tier: 1, bronrol: null },
    { id: 109, name: 'Omgevingsvergunningen', tier: 1, bronrol: null },
    { id: 61, name: 'Kunsthal', tier: 2, bronrol: null },
    { id: 165, name: 'Leusder Krant', tier: 1, bronrol: 'spiegel' },
    { id: 117, name: 'Amendementen', tier: 1, bronrol: null },
  ];
  const stats = new Map([
    [120, { laatste: '2026-08-09 05:00:00', n90: 40 }],
    [109, { laatste: '2026-10-03 02:31:00', n90: 600 }],
    [61, { laatste: '2026-08-01', n90: 100 }],
    [165, { laatste: '2026-08-01', n90: 50 }],
    [117, { laatste: '2026-08-09', n90: 2 }],
  ]);
  assert.deepEqual(langStilleBronnen(bronnen, stats, nu), [
    { id: 120, naam: 'Raad — Vergaderingen en overig', laatste: '2026-08-09', n90: 40 },
  ]);
});
