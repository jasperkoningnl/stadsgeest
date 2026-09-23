// Parsering van hoofdstuk 8 (Organisaties) uit eForms-PDF's van TenderNed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePartijen, winnaarsWaarde } from '../../src/tenderned-partijen.js';

const regels = [
  '6.1.2 Informatie over winnaars', 'Winnaar:', 'Officiële naam: | KWS Infra B.V.', 'Waarde van de', '3 055 000Euro', 'aanbesteding:',
  '8. Organisaties', '8.1 ORG-0001', 'Officiële naam: | Gemeente Amersfoort', 'Registratienummer: | 451541026',
  'Postadres: | Stadhuisplein 1', 'Stad: | Amersfoort', 'Postcode: | 3811 LM',
  'Andere contactpunten:', 'Officiële naam: | Rechtbank Midden Nederland', 'Stad: | Utrecht',
  'Rollen van deze organisatie:', 'Koper', 'Organisatie die het contract ondertekent',
  // pdfjs knipt labels soms in stukjes
  '8.1 | ORG-0002', 'Officiële naam | : | KWS Infra B.V.', 'Registratienummer | : | 05062469', 'Postadres | : | Lange Dreef 9',
  'Stad | : | VIANEN', 'Postcode | : | 4131NJ', 'Rollen van deze organisatie:', 'Inschrijver', 'Winnaar van deze', 'LOT-0000',
  '11. Informatie over een aankondiging', 'Officiële naam: | Niet meer in hoofdstuk 8',
];

test('koper en winnaar met registratienummer en adres', () => {
  const p = parsePartijen(regels);
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].naam, p[0].is_koper, p[0].is_winnaar, p[0].postcode, p[0].plaats], ['Gemeente Amersfoort', 1, 0, '3811LM', 'Amersfoort']);
  assert.deepEqual([p[1].naam, p[1].registratienummer, p[1].is_winnaar, p[1].adres], ['KWS Infra B.V.', '05062469', 1, 'Lange Dreef 9']);
});

test('andere contactpunten overschrijven de hoofdorganisatie niet', () => {
  assert.equal(parsePartijen(regels)[0].plaats, 'Amersfoort');
});

test('waarde van de winnende inschrijving', () => {
  assert.equal(winnaarsWaarde(regels), 3055000);
});

test('zonder hoofdstuk 8 geen partijen', () => {
  assert.deepEqual(parsePartijen(['1. Koper', 'Officiële naam: | X']), []);
});
