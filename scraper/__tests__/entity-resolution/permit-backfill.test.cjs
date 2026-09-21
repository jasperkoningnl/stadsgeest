const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAddress, classifyPermit, normalizeHouseNumber } = require('../../src/kg/permit-backfill.cjs');

test('extraheert exact postcode en huisnummer uit vergunningtitels', () => {
  assert.deepEqual(extractAddress('Verleende omgevingsvergunning op Basicweg 21, 3821 BR Amersfoort'), {
    postalCode: '3821BR', houseNumber: '21',
  });
  assert.deepEqual(extractAddress('Aanvraag gevelletters Storkstraat 20-III, 3833LB Leusden'), {
    postalCode: '3833LB', houseNumber: '20iii',
  });
  assert.equal(extractAddress('Vergunning voor bomen in de Hamersveldseweg'), null);
});

test('normaliseert alleen typografische huisnummertekens', () => {
  assert.equal(normalizeHouseNumber('20-III'), '20iii');
  assert.equal(normalizeHouseNumber('4 A'), '4a');
  assert.notEqual(normalizeHouseNumber('29-31'), normalizeHouseNumber('29'));
});

test('classificeert aanvraag, verlening en weigering afzonderlijk', () => {
  assert.equal(classifyPermit('Ontvangen aanvraag omgevingsvergunning'), 'PERMIT_APPLIED');
  assert.equal(classifyPermit('Verleende omgevingsvergunning'), 'PERMIT_GRANTED');
  assert.equal(classifyPermit('Weigering omgevingsvergunning'), 'PERMIT_REFUSED');
});
