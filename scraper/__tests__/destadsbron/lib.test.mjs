import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { nlDatumIso, parseLijst } from '../../src/destadsbron-lib.mjs';

// Ingekort uit de voorpagina van destadsbron.nl (2 oktober 2026): drie
// artikelen, afbeeldingen weggelaten.
const HTML = readFileSync(new URL('../fixtures/destadsbron/voorpagina.html', import.meta.url), 'utf8');

test('nlDatumIso: Nederlandse datum en tijd naar UTC', () => {
  assert.equal(nlDatumIso('24 september 2026', 'om 21:52u'), '2026-09-24T19:52:00.000Z'); // zomertijd
  assert.equal(nlDatumIso(' 6 augustus 2026', ''), '2026-08-06T10:00:00.000Z');          // middag zonder tijd
  assert.equal(nlDatumIso('17 januari 2026', 'om 09:05u'), '2026-01-17T08:05:00.000Z'); // wintertijd
  assert.equal(nlDatumIso('gisteren'), null);
  assert.equal(nlDatumIso('3 smarch 2026'), null);
});

test('parseLijst: titel, auteur, datum, samenvatting en absolute url', () => {
  const lijst = parseLijst(HTML);
  assert.equal(lijst.length, 3);
  const [eerste, tweede] = lijst;
  assert.equal(eerste.titel, 'Een ufo vol hoornaars');
  assert.equal(eerste.auteur, 'Diana Wildschut');
  assert.equal(eerste.url, 'https://destadsbron.nl/nl/Een_ufo_vol_hoornaars');
  assert.equal(eerste.datum, '2026-09-24T19:52:00.000Z');
  assert.match(eerste.samenvatting, /^Tegen een boom bij het speelveldje/);
  assert.match(eerste.samenvatting, /\n\nMaar wat zijn het voor beestjes/);
  assert.equal(tweede.titel, 'Amersfoort in de toekomst');
  assert.equal(tweede.datum, '2026-09-20T15:08:00.000Z');
});

test('parseLijst: lege of andere pagina levert niets op', () => {
  assert.deepEqual(parseLijst('<html><body><ul><li>geen artikel</li></ul></body></html>'), []);
});
