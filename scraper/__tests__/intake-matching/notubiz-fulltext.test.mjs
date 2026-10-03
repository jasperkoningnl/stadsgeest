import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOriLookup,
  documentenUitPayload,
  extractOriText,
  haalNotubizTekst,
  isNotubizUrl,
  notubizDocumentParts,
  notubizModuleItem,
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


// ── Directe pdf-route via api.notubiz.nl (2026-10-03) ────────────────────────

const ingekomenUrl = 'https://amersfoort.notubiz.nl/document/17490799/1/490+Brief+GS?connection_type=16&connection_id=1208955';
const moduleUrl = 'https://amersfoort.notubiz.nl/modules/1/Ingekomen%20stukken/1207847';

// Vorm van het echte antwoord van api.notubiz.nl/modules/1/items/1208955 (3 oktober 2026).
const modulePayload = { item: { id: '1208955', attachments: { document: [
  { self: 'api.notubiz.nl/document/17490799', url: 'https://api.notubiz.nl/document/17490799/2', title: '490 Brief GS',
    connections: [{ self: 'https://api.notubiz.nl/document/17490799/2/connections/16/1208955' }] },
  { self: 'api.notubiz.nl/document/17490800', url: 'https://api.notubiz.nl/document/17490800/2', title: '490 Bijlage bij brief GS', connections: [] },
] }, attributes: [{ label: 'Afzender', values: [{ content: 'Gedeputeerde Staten' }] }] } };

const PDF = Buffer.from('%PDF-1.7 nep');
function antwoord({ status = 200, json = null, body = Buffer.from('<result/>') }) {
  return { ok: status >= 200 && status < 300, status, json: async () => json, arrayBuffer: async () => body };
}
// Nep-fetch: `routes` is een lijst [deel van de URL, antwoord]; de eerste treffer telt.
function nepFetch(routes) {
  const gevraagd = [];
  const fetchFn = async (url) => {
    gevraagd.push(url);
    const route = routes.find(([deel]) => url.includes(deel));
    return route ? antwoord(route[1]) : antwoord({ status: 404 });
  };
  return { fetchFn, gevraagd };
}
const langeTekst = 'tekst van het stuk '.repeat(20).trim();
const opties = (fetchFn, pdfNaarTekst = async () => langeTekst) => ({ fetchFn, pdfNaarTekst, pauzeMs: 0 });

test('vindt het module-item achter een overzichtspagina en achter connection_type=16', () => {
  assert.deepEqual(notubizModuleItem(moduleUrl), { moduleId: '1', itemId: '1207847' });
  assert.deepEqual(notubizModuleItem(ingekomenUrl), { moduleId: '1', itemId: '1208955' });
  assert.equal(notubizModuleItem(recentUrl), null); // connection_type=17 is geen module-item
  assert.equal(notubizModuleItem('https://example.nl/modules/1/x/5'), null);
});

test('leest documenten met hun actuele versie uit een API-antwoord, elk één keer', () => {
  assert.deepEqual(documentenUitPayload(modulePayload), [
    { documentId: '17490799', revision: '2', titel: '490 Brief GS' },
    { documentId: '17490800', revision: '2', titel: '490 Bijlage bij brief GS' },
  ]);
  assert.deepEqual(documentenUitPayload(null), []);
});

test('haalt de pdf bij api.notubiz.nl en nooit bij de geblokkeerde site', async () => {
  const { fetchFn, gevraagd } = nepFetch([['api.notubiz.nl/document/17387988/1', { body: PDF }]]);
  const uit = await haalNotubizTekst(recentUrl, opties(fetchFn));
  assert.equal(uit.text, langeTekst);
  assert.deepEqual(gevraagd, ['https://api.notubiz.nl/document/17387988/1']);
});

test('valt terug op de actuele versie als de opgeslagen revisie weigert', async () => {
  const { fetchFn, gevraagd } = nepFetch([
    ['/document/17387988/1', { status: 400 }],
    ['/document/17387988?', { json: { document: { url: 'https://api.notubiz.nl/document/17387988/3', title: 'Vragen' } } }],
    ['/document/17387988/3', { body: PDF }],
  ]);
  const uit = await haalNotubizTekst(recentUrl, opties(fetchFn));
  assert.equal(uit.text, langeTekst);
  assert.equal(uit.documenten[0].revision, '3');
  assert.equal(gevraagd.length, 3);
});

test('neemt bij een ingekomen stuk brief én bijlage mee', async () => {
  const { fetchFn } = nepFetch([
    ['/modules/1/items/1208955', { json: modulePayload }],
    ['/document/17490799/2', { body: PDF }],
    ['/document/17490800/2', { body: PDF }],
  ]);
  const uit = await haalNotubizTekst(ingekomenUrl, opties(fetchFn));
  assert.ok(uit.text.includes('[490 Brief GS]'));
  assert.ok(uit.text.includes('[490 Bijlage bij brief GS]'));
  assert.deepEqual(uit.documenten.map((d) => d.status), ['ok', 'ok']);
});

test('meldt een module-item zonder document zonder een pdf te proberen', async () => {
  const { fetchFn, gevraagd } = nepFetch([['/modules/1/items/1207847', { json: { item: { id: '1207847', attributes: [] } } }]]);
  const uit = await haalNotubizTekst(moduleUrl, opties(fetchFn));
  assert.equal(uit.text, null);
  assert.equal(uit.reason, 'module-item zonder document');
  assert.equal(gevraagd.length, 1);
});

test('herkent een scan zonder tekstlaag en een geweigerde download', async () => {
  const scan = nepFetch([['/document/17387988/1', { body: PDF }]]);
  const uitScan = await haalNotubizTekst(recentUrl, opties(scan.fetchFn, async () => 'pag 1'));
  assert.equal(uitScan.text, null);
  assert.match(uitScan.reason, /^pdf zonder tekstlaag/);
  assert.equal(uitScan.documenten[0].status, 'scan');

  const dicht = nepFetch([['/document/17387988/1', { status: 400 }], ['/document/17387988?', { status: 403 }]]);
  const uitDicht = await haalNotubizTekst(recentUrl, opties(dicht.fetchFn));
  assert.equal(uitDicht.text, null);
  assert.equal(uitDicht.reason, 'http_400');
});
