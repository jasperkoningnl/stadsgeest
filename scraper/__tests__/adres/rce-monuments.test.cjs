'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMonumentAddresses } = require('../../src/kg/rce-monument-addresses.cjs');
const row = { nr: { value: '123' }, pc: { value: '3811AB' }, adres: { value: 'Teststraat 1' } };
const response = (rows = [row]) => new Response(JSON.stringify({ results: { bindings: rows } }),
  { headers: { 'content-type': 'application/sparql-results+json' } });

test('tijdelijke RCE 503 wordt herprobeerd en levert exacte bronrijen', async () => {
  let calls = 0;
  const records = await loadMonumentAddresses({ fetchImpl: async (url) => {
    const query = new URL(url).searchParams.get('query');
    assert.match(query, /VALUES \?g/);
    return ++calls === 1 ? new Response('Unavailable', { status: 503 }) : response();
  } });
  assert.equal(calls, 2);
  assert.deepEqual(records, [{ sourceId: 154, ref: 'monument:123#Teststraat 1', role: 'monument',
    label: 'Rijksmonument 123', line: 'Teststraat 1', postcode: '3811AB' }]);
});

test('blijvende RCE 503 blijft een fout na precies drie pogingen', async () => {
  let calls = 0;
  await assert.rejects(loadMonumentAddresses({ fetchImpl: async () => {
    calls++; return new Response('Unavailable', { status: 503 });
  } }), /HTTP 503/);
  assert.equal(calls, 3);
});

test('lege of onvolledige RCE-respons wordt niet als succes beschouwd', async () => {
  await assert.rejects(loadMonumentAddresses({ fetchImpl: async () => response([]) }), /ontbreken/);
  await assert.rejects(loadMonumentAddresses({ fetchImpl: async () => response([{ ...row, pc: undefined }]) }), /ongeldige/);
});
