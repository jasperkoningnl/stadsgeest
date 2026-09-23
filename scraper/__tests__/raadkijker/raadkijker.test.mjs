import test from 'node:test';
import assert from 'node:assert/strict';
import {
  motieSleutel, zelfdeMotie, uitslagWijziging, isBruikbaar, normaliseerNotubizUrl, inhoudskop,
} from '../../src/raadkijker.mjs';

test('motienummer zonder letter, en geen nummer bij verzamelpunten', () => {
  assert.equal(motieSleutel('Motie 2026-099M Amersfoort2014: Voortgang'), '2026-099');
  assert.equal(motieSleutel('VERDAAGD Motie 2026-092 KeiHart'), '2026-092');
  assert.equal(motieSleutel('Amendement 2026-077A PRO'), '2026-077');
  assert.equal(motieSleutel('Besluiten zonder debat, met amendementen en moties'), null);
});

test('hergebruikt nummer met andere inhoud is een andere motie', () => {
  assert.equal(zelfdeMotie(
    'AANGENOMEN Motie 2026-057M PRO, KeiHart voor Amersfoort, D66, VVD, CDA: Bruggen bouwen',
    'Motie 2026-057M KeiHart voor Amersfoort: Maak en houd vergunningen betaalbaar voor inwoner'), false);
  assert.equal(zelfdeMotie(
    'VERWORPEN Motie 2026-054M KeiHart voor Amersfoort Haastige spoed is zelden goed',
    'Motie 2026-054M KeiHart voor Amersfoort en VVD: Gehaaste spoed is zelden goed'), true);
});

test('uitslag alleen uit griffiestempel, en een definitief stempel blijft staan', () => {
  // RaadKijker zegt "aangenomen" bij de ongestempelde versie; dat telt niet.
  assert.equal(uitslagWijziging('VERWORPEN Motie 2026-054M X', 'Motie 2026-054M X'), null);
  assert.equal(uitslagWijziging('Motie 2026-093M X', 'AANGENOMEN Motie 2026-093M X'), 'AANGENOMEN Motie 2026-093M X');
  assert.equal(uitslagWijziging('VERDAAGD Motie 2026-092 X', 'AANGENOMEN Motie 2026-092 X'), 'AANGENOMEN Motie 2026-092 X');
  assert.equal(uitslagWijziging('AANGENOMEN Motie 2026-050M X', 'VERWORPEN Motie 2026-050M X'), null);
});

test('onbruikbaar: geen url, geen nummer of een oud stuk met verkeerde datum', () => {
  const url = 'https://api.notubiz.nl/document/1/1';
  assert.equal(isBruikbaar({ titel: 'Moties', bron_document_url: null, datum: '2026-09-23' }), false);
  assert.equal(isBruikbaar({ titel: 'Amendement Zwaluwstaarten, 25 januari 2022', bron_document_url: url, datum: '2026-06-03' }), false);
  assert.equal(isBruikbaar({ titel: 'Motie 2022-010M X', bron_document_url: url, datum: '2026-06-03' }), false);
  assert.equal(isBruikbaar({ titel: 'Motie 2026-104M SP', bron_document_url: url, datum: '2026-09-23' }), true);
});

test('Notubiz-url wordt de api-vorm en de kop noemt indiener en uitslag', () => {
  assert.equal(normaliseerNotubizUrl('https://amersfoort.notubiz.nl/document/17223447/1/AANGENOMEN+Motie?x=1'),
    'https://api.notubiz.nl/document/17223447/1');
  const kop = inhoudskop({ type: 'motie', datum: '2026-09-23', indiener_partij: 'SP', titel: 'Motie 2026-104M SP' });
  assert.match(kop, /Ingediend door: SP/);
  assert.match(kop, /Uitslag: nog niet bekend/);
});
