import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOriLookup,
  extractOriText,
  isNotubizUrl,
  notubizDocumentParts,
  oriUrlCandidates,
} from '../../src/notubiz-fulltext.mjs';

const recentUrl = 'https://amersfoort.notubiz.nl/document/17387988/1/Vragen?connection_type=17&connection_id=13785768';

test('herkent zowel nieuwe als oude Notubiz-documentdomeinen', () => {
  assert.equal(isNotubizUrl(recentUrl), true);
  assert.equal(isNotubizUrl('https://api.notubiz.nl/document/17106654/2'), true);
  assert.equal(isNotubizUrl('https://example.nl/document/17106654/2'), false);
});

test('haalt document-id en revisie uit een Notubiz-URL', () => {
  assert.deepEqual(notubizDocumentParts(recentUrl), { documentId: '17387988', revision: '1' });
  assert.equal(notubizDocumentParts('https://amersfoort.notubiz.nl/modules/4/x'), null);
});

test('maakt ORI-kandidaten voor de nieuwe en oude URL-vorm', () => {
  const candidates = oriUrlCandidates(recentUrl);
  assert.ok(candidates.includes('https://api.notubiz.nl/document/17387988/1'));
  assert.ok(candidates.includes('https://amersfoort.notubiz.nl/document/17387988/1'));
  assert.ok(candidates.includes(recentUrl));
  assert.ok(buildOriLookup(recentUrl).query.bool.should.length >= 6);
});

test('accepteert alleen ORI-tekst van hetzelfde document en kiest de langste tekst', () => {
  const payload = { hits: { hits: [
    { _source: { original_url: 'https://api.notubiz.nl/document/999/1', text: 'verkeerd '.repeat(100) } },
    { _source: { original_url: 'https://api.notubiz.nl/document/17387988/1', text: 'kort '.repeat(50) } },
    { _source: { original_url: recentUrl, text: 'lang '.repeat(100) } },
  ] } };
  assert.equal(extractOriText(payload, recentUrl), 'lang '.repeat(100).trim());
});

test('weigert te korte ORI-metadata als fulltext', () => {
  const payload = { hits: { hits: [
    { _source: { original_url: recentUrl, text: 'alleen metadata' } },
  ] } };
  assert.equal(extractOriText(payload, recentUrl), null);
});
