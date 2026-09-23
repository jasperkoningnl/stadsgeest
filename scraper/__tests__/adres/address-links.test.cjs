'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAddresses, parseStreetLine, selectExact } = require('../../src/kg/address-links.cjs');

const keys = (text) => extractAddresses(text).map((a) => a.key);

test('adres met postcode wordt herkend, ook met letter en dubbel voorkomen', () => {
  assert.deepEqual(keys('perceel Stadsring 55, 3811 HN Amersfoort'), ['pc:3811HN|55||']);
  assert.deepEqual(keys('perceel Kapelweg 148 A, 3818 BV Amersfoort'), ['pc:3818BV|148|a|']);
  const dubbel = extractAddresses('Krommestraat 28, 3811 CC Amersfoort. Locatie: Krommestraat 28, 3811 CC Amersfoort');
  assert.equal(dubbel.length, 1);
  assert.equal(dubbel[0].occurrences, 2);
});

test('adres zonder postcode alleen met bekende plaatsnaam', () => {
  assert.deepEqual(keys('vetafscheider aan Langestraat 143 te Amersfoort Het college'), ['str:langestraat|143|||amersfoort']);
  assert.deepEqual(keys('gevestigd op Hoofdstraat 12 te Utrecht'), []);
});

test('postbus is geen adres', () => {
  assert.deepEqual(keys('Rechtbank Midden-Nederland, Postbus 16005, 3500 DA Utrecht'), []);
});

test('registerregel wordt ontleed', () => {
  assert.equal(parseStreetLine('Camera Obscurastraat 63', '3813PK').key, 'pc:3813PK|63||');
  assert.equal(parseStreetLine('Kapelweg 148 A', '3818 BV').key, 'pc:3818BV|148|a|');
  assert.equal(parseStreetLine('Stadhuisplein', '3811LM'), null);
});

const doc = (o) => ({ bron: 'BAG', type: 'adres', gemeentenaam: 'Amersfoort', huisletter: '', huisnummertoevoeging: '', ...o });

test('alleen een exacte BAG-treffer telt', () => {
  const a = { postcode: '3811HN', huisnummer: '55', huisletter: '', toevoeging: '' };
  assert.equal(selectExact(a, [doc({ postcode: '3811HN', huisnummer: 55, nummeraanduiding_id: '1' })]).status, 'exact');
  assert.equal(selectExact(a, [doc({ postcode: '3811HN', huisnummer: 57, nummeraanduiding_id: '2' })]).status, 'none');
  // zonder letter in de tekst wint het adres zonder letter
  assert.equal(selectExact(a, [
    doc({ postcode: '3811HN', huisnummer: 55, nummeraanduiding_id: '1' }),
    doc({ postcode: '3811HN', huisnummer: 55, huisletter: 'A', nummeraanduiding_id: '3' }),
  ]).doc.nummeraanduiding_id, '1');
  // alleen varianten met letter: niet te kiezen
  assert.equal(selectExact(a, [
    doc({ postcode: '3811HN', huisnummer: 55, huisletter: 'A', nummeraanduiding_id: '3' }),
    doc({ postcode: '3811HN', huisnummer: 55, huisletter: 'B', nummeraanduiding_id: '4' }),
  ]).status, 'ambiguous');
  assert.equal(selectExact(a, [doc({ postcode: '3811HN', huisnummer: 55, gemeentenaam: 'Utrecht', nummeraanduiding_id: '5' })]).status, 'outside_area');
});

test('straat + plaats vereist dezelfde straatnaam en woonplaats', () => {
  const a = { postcode: '', street: 'aan de Langestraat', place: 'Amersfoort', huisnummer: '143', huisletter: '', toevoeging: '' };
  assert.equal(selectExact(a, [doc({ straatnaam: 'Langestraat', woonplaatsnaam: 'Amersfoort', huisnummer: 143, nummeraanduiding_id: '6' })]).status, 'exact');
  assert.equal(selectExact(a, [doc({ straatnaam: 'Korte Langestraat', woonplaatsnaam: 'Amersfoort', huisnummer: 143, nummeraanduiding_id: '7' })]).status, 'none');
  const k = { ...a, street: 'Korte Langestraat' };
  assert.equal(selectExact(k, [
    doc({ straatnaam: 'Langestraat', woonplaatsnaam: 'Amersfoort', huisnummer: 143, nummeraanduiding_id: '6' }),
    doc({ straatnaam: 'Korte Langestraat', woonplaatsnaam: 'Amersfoort', huisnummer: 143, nummeraanduiding_id: '7' }),
  ]).doc.nummeraanduiding_id, '7');
});

test('reeks, kadastrale aanduiding en langste plaatsnaam', () => {
  assert.deepEqual(keys('perceel Nijverheidsweg-Noord 69-71 3812 PZ Amersfoort'), ['pc:3812PZ|69||']);
  assert.deepEqual(keys('Utrechtseweg 11-2, 3811 NA Amersfoort'), ['pc:3811NA|11||2']);
  assert.deepEqual(keys('Amersfoort (AMF00) M 431, Amersfoort (AMF00)'), []);
  assert.deepEqual(keys('Stoutenburgerlaan 16 te Stoutenburg Noord en'), ['str:stoutenburgerlaan|16|||stoutenburgnoord']);
});
