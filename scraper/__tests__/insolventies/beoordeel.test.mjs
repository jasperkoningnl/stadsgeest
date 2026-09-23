// Filterregels voor het Centraal Insolventieregister: alleen lokale rechtspersonen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beoordeel } from '../../src/insolventies-lib.js';

test('lokale B.V. wordt opgenomen met kenmerk, KvK en vestigingsadres', () => {
  const t = 'Uitspraak faillissement op 22 september 2026 inzake (F.16/26/419) Houtindustrie Amersfoort B.V, corr.adr. Bruistensingel 400 5232AG \'s-Hertogenbosch, vest.adr. Textielweg 9 3812RV Amersfoort, KvK: 31009419 hodn Houtindustrie Amersfoort B.V. Cur: mr M.H. de Vries, Postbus 1 3500AA Utrecht.';
  const b = beoordeel('uitspraken faillissement', '', t);
  assert.equal(b.kenmerk, 'F.16/26/419');
  assert.equal(b.kvk, '31009419');
  assert.equal(b.vestiging, 'Textielweg 9 3812RV Amersfoort');
  assert.match(b.naam, /^Houtindustrie Amersfoort B\.V/);
});

test('vestigingsadres gaat voor postbus', () => {
  const t = 'Wegens gebrek aan baten op 01 september 2026 inzake (F.16/22/59) Kinetic Evaluation Instruments B.V, corr.adr. Postbus 353 3830AK LEUSDEN, vest.adr. Arnhemseweg 87 3832GK Leusden, KvK: 53860705';
  assert.equal(beoordeel('einde faillissementen', 'wegens gebrek aan baten', t).vestiging, 'Arnhemseweg 87 3832GK Leusden');
});

test('natuurlijke persoon (geb./woonadr.) wordt overgeslagen, ook met eenmanszaak', () => {
  const t = 'Uitspraak faillissement op 25 augustus 2026 inzake (F.16/26/372) R.J. Voorbeeld, woonadr. Teststraat 5 3825XZ Amersfoort, geb. Utrecht (Nederland) 12 augustus 1997. hodn Voorbeeld Dak vest.adr. Teststraat 5 3825XZ Amersfoort, KvK: 95069798.';
  assert.equal(beoordeel('uitspraken faillissement', '', t), null);
});

test('schuldsaneringen worden overgeslagen', () => {
  assert.equal(beoordeel('zittingen in schuldsaneringen', 'verificatievergadering', 'inzake (R.16/26/1) X B.V, vest.adr. Stadsring 1 3811HN Amersfoort'), null);
});

test('rechtspersoon buiten het werkgebied valt af, ook met "Amersfoort" in een handelsnaam', () => {
  const t = 'Uitspraak faillissement inzake (F.16/26/417) Autorijschool Voorbeeld B.V, vest.adr. Herculesplein 221 3584AA Utrecht, KvK: 30044129 hodn Rijschool Amersfoort vest.adr. Herculesplein 221 3584AA Utrecht.';
  assert.equal(beoordeel('uitspraken faillissement', '', t), null);
});
