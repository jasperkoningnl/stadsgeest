'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maanden, vergelijkReeks, vergelijkRest, historischeVragen, dossierVragen, main } = require('../../src/onderzoeksronde.cjs');

function reeks(area = 'WK030701', code = '1.2.3') {
  return [2025, 2026].flatMap((year, yi) => [7, 8, 9].map((month, i) => ({
    id: year * 100 + month,
    obj: { WijkenEnBuurten: area, SoortMisdrijf: code, Perioden: `${year}MM0${month}`, mapYear: 2025, GeregistreerdeMisdrijven_1: yi ? [25, 26, 18][i] : [32, 44, 29][i] },
  })));
}

test('vergelijking gebruikt dezelfde volledige maanden en behoudt herkomst', () => {
  assert.deepEqual(maanden('2026MM02'), ['2025MM12', '2026MM01', '2026MM02']);
  const r = vergelijkReeks(reeks(), '2026MM09');
  assert.equal(r.vorig.totaal, 105);
  assert.equal(r.huidig.totaal, 69);
  assert.equal(r.verschil, -36);
  assert.deepEqual(r.huidig.record_ids, [202607, 202608, 202609]);
});

test('ontbrekende, dubbele en afgeschermde maanden zijn geen daling naar nul', () => {
  const r = reeks();
  assert.equal(vergelijkReeks(r.slice(1), '2026MM09').geldig, false);
  assert.equal(vergelijkReeks([...r, r[0]], '2026MM09').geldig, false);
  for (const v of [null, '', '5', -1]) {
    const input = structuredClone(r);
    input[0].obj.GeregistreerdeMisdrijven_1 = v;
    assert.equal(vergelijkReeks(input, '2026MM09').geldig, false);
  }
});

test('verschillend kaartjaar blokkeert gebiedsvergelijking', () => {
  const r = reeks();
  r.slice(3).forEach(x => { x.obj.mapYear = 2026; });
  assert.equal(vergelijkReeks(r, '2026MM09').geldig, false);
});

test('restgebied is afgeleid en wordt bij ongelijke maanden of onmogelijke optelling geweigerd', () => {
  const deel = vergelijkReeks(reeks(), '2026MM09');
  const gm = structuredClone(deel);
  gm.vorig.totaal = 320;
  gm.huidig.totaal = 443;
  const rest = vergelijkRest(deel, gm);
  assert.equal(rest.vorig, 215);
  assert.equal(rest.huidig, 374);
  assert.match(rest.afleiding, /geen onafhankelijke bron/);
  gm.vorig.maanden[0] = '2025MM06';
  assert.equal(vergelijkRest(deel, gm).geldig, false);
  gm.vorig = structuredClone(deel.vorig);
  gm.huidig.totaal = 1;
  assert.equal(vergelijkRest(deel, gm).geldig, false);
});

test('wijkdaling wordt naast tegengestelde gemeentetrend gezet', () => {
  const gm = reeks('GM0307');
  gm.slice(3).forEach(x => { x.obj.GeregistreerdeMisdrijven_1 = 100; });
  const areas = [{ area_code: 'WK030701', area_name: 'Wijk', map_year: 2025, municipality_code: 'GM0307', source_url: 'https://bron' }];
  const result = historischeVragen([...reeks(), ...gm], areas, '2026MM09');
  assert.equal(result.leeslijst.length, 1);
  assert.ok(result.leeslijst[0].afwijking_van_gemeente < -100);
  assert.equal(result.leeslijst[0].landelijke_vergelijking.geldig, false);
  assert.equal(result.leeslijst[0].status, 'te_lezen');
});

test('spiegel, korte metadata en duplicaat leveren geen onafhankelijke bronnen op', () => {
  const body = 'De wijkteams onderzoeken de uitvoering. '.repeat(25);
  const doc = { key: 'item:1', raw_item_id: 1, body, title: 'Uitvoering', tier: 1, bronrol: null, published_at: null };
  const topics = [{ id: 'teams', vraag: 'Wat blijft liggen?', termen: ['wijkteams'] }];
  const result = dossierVragen([doc, { ...doc, key: 'item:2' }, { ...doc, key: 'item:3', bronrol: 'spiegel', body: body + 'nieuw' }, { ...doc, key: 'item:4', body: 'wijkteams' }], topics);
  assert.equal(result[0].unieke_teksten, 1);
  assert.equal(result[0].stukken[0].ook_beschikbaar_als.length, 1);
  assert.equal(result[0].stukken[0].opgegeven_publicatiedatum, null);
  assert.equal(result[0].stukken[0].passages[0].tekst, body.slice(0, 1013));
});

test('onbegrensde zoekvragen en externe databaseadressen worden geweigerd', async () => {
  assert.throws(() => dossierVragen([], Array(7).fill({})), /maximaal zes/);
  await assert.rejects(main(['--kopie', 'libsql://voorbeeld', '--datum', '2026-10-17', '--vragen', 'vragen.json', '--uit', 'uit.json']), /lokaal/);
});
