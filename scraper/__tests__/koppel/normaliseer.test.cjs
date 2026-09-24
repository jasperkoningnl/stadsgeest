'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliseerNaam, normaliseerKvk, normaliseerPlaats, huisnummer, maakRecord, voegSamen, clusteren, accepteerPaar,
} = require('../../src/koppel/normaliseer.cjs');
const { clusterKey, samenvatCluster } = require('../../src/koppel-organisaties.cjs');
const { PERSOONLIJK } = require('../../src/koppel/bronnen.cjs');

test('naam: rechtsvorm, accenten en leestekens vallen weg', () => {
  assert.equal(normaliseerNaam('Stichting Meander Medisch Centrum.'), 'meander medisch centrum');
  assert.equal(normaliseerNaam('STICHTING INTERKERKELIJK ORIËNTATIE CENTRUM'), 'interkerkelijk orientatie centrum');
  assert.equal(normaliseerNaam('Huisartsen Eemland Zorg B.V.'), 'huisartsen eemland zorg');
  assert.equal(normaliseerNaam('Jansen & Zn h.o.d.n. Bakkerij Jansen'), 'jansen en zn');
  assert.equal(normaliseerNaam('Coöperatie Eemland U.A.'), 'eemland');
});

test('kvk, plaats en huisnummer', () => {
  assert.equal(normaliseerKvk('3014 4691'), '30144691');
  assert.equal(normaliseerKvk('301446910000'), '30144691');
  assert.equal(normaliseerKvk('1234'), null);
  assert.equal(normaliseerPlaats('Hoogland'), 'amersfoort');
  assert.equal(normaliseerPlaats('Achterveld'), 'leusden');
  assert.equal(normaliseerPlaats('09-01-2024'), null);
  assert.equal(huisnummer('Basicweg 12 a'), '12a');
});

test('maakRecord laat te korte namen weg en zet de rol', () => {
  assert.equal(maakRecord({ bron: 'subsidie', naam: 'BV' }), null);
  assert.equal(maakRecord({ bron: 'subsidie', naam: 'Stichting Stadsring' }).rol, 'geld');
  assert.equal(maakRecord({ bron: 'arbeidsinspectie', naam: 'Succlean B.V.', rol: 'register' }).rol, 'register');
});

test('voegSamen: één record per bron en naam, toezicht wint van register', () => {
  const r = voegSamen([
    maakRecord({ bron: 'arbeidsinspectie', naam: 'Xenon B.V.', rol: 'register', extra: '2023 geen overtreding' }),
    maakRecord({ bron: 'arbeidsinspectie', naam: 'Xenon BV', rol: 'toezicht', extra: '2025 overtreding', kvk: '12345678' }),
    maakRecord({ bron: 'anbi', naam: 'Xenon' }),
  ].filter(Boolean));
  assert.equal(r.length, 2);
  assert.equal(r[0].rol, 'toezicht');
  assert.equal(r[0].kvk, '12345678');
  assert.equal(r[0].n_rijen, 2);
  assert.deepEqual(r.map((x) => x.uid), [0, 1]);
});

test('accepteerPaar: gedeeld adres zonder naamovereenkomst telt niet', () => {
  assert.equal(accepteerPaar([0, 1, 0.81, 0, 1, 1, 1]), false);
  assert.equal(accepteerPaar([0, 1, 0.81, 1, 1, 1, 1]), true);
  assert.equal(accepteerPaar([0, 1, 0.81, 1, -1, -1, 1]), false);
  assert.equal(accepteerPaar([0, 1, 0.7, 3, -1, -1, 0]), false);
  assert.equal(accepteerPaar([0, 1, 0.7, 3, -1, -1, -1]), true);
  assert.equal(accepteerPaar([0, 1, 0.7]), true);
});

function recs(lijst) {
  return voegSamen(lijst.map(maakRecord).filter(Boolean));
}

test('clusteren: harde sleutel koppelt, ander KvK-nummer nooit', () => {
  const r = recs([
    { bron: 'gleif', naam: 'Alfa Holding', kvk: '11111111' },
    { bron: 'tender_winnaar', naam: 'Alfa Techniek', kvk: '11111111' },
    { bron: 'zorg', naam: 'Alfa Zorg', kvk: '22222222' },
  ]);
  const { clusterVan, geweigerd } = clusteren(r, [[0, 2, 0.95, 3, 1, 1, 1]]);
  assert.equal(clusterVan[0], clusterVan[1]);
  assert.notEqual(clusterVan[0], clusterVan[2]);
  assert.equal(geweigerd, 1);
});

test('clusteren: een record zonder plaats slaat geen brug tussen twee plaatsen', () => {
  const r = recs([
    { bron: 'onderwijsinspectie', naam: 'De Baander', plaats: 'Amersfoort' },
    { bron: 'kg', naam: 'De Baander' },
    { bron: 'tender_winnaar', naam: 'De Baander', plaats: 'Elim', kvk: '01152112' },
  ]);
  const { clusterVan } = clusteren(r, [[0, 1, 0.9, 3, -1, -1, -1], [1, 2, 0.9, 3, -1, -1, -1]]);
  assert.equal(clusterVan[0], clusterVan[1]);
  assert.notEqual(clusterVan[1], clusterVan[2]);
});

test('clusterKey is stabiel en samenvatting telt KG niet als bron', () => {
  const r = recs([
    { bron: 'subsidie', naam: 'Stichting Stadsring', extra: '2025 €10.000' },
    { bron: 'anbi', naam: 'STICHTING STADSRING', plaats: 'Amersfoort' },
    { bron: 'kg', naam: 'Stadsring' },
  ]);
  assert.equal(clusterKey(r), clusterKey([...r].reverse()));
  const s = samenvatCluster(r);
  assert.deepEqual(s.bronnen, ['anbi', 'subsidie']);
  assert.equal(s.heeft_geld, 1);
  assert.equal(s.heeft_toezicht, 0);
});

test('persoonlijke rechtsvormen uit OpenKvK doen niet mee', () => {
  assert.ok(PERSOONLIJK.test('Eenmanszaak'));
  assert.ok(PERSOONLIJK.test('Vennootschap Onder Firma'));
  assert.ok(!PERSOONLIJK.test('Besloten Vennootschap'));
});
