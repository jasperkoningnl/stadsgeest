// Parsering van het iBabs-publieksportaal: rapportrijen en documentlinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rijNaarItem, documentLinks, leeftijdDagen, bijlageIsAfgehandeld, RAPPORTEN } from '../../src/ibabs-lib.js';

test('Woo-rij krijgt dezelfde titelvorm als ibabs-woo.js', () => {
  const i = rijNaarItem({ DT_RowId: 'abc', zaaknummer: '2024-1', title: ' Aardgasvrij  Schothorst ', DAtum1: '16-04-2024', datum2: '01-09-2024' }, RAPPORTEN.woo);
  assert.equal(i.titel, 'Woo-verzoeken: Aardgasvrij Schothorst');
  assert.equal(i.url, 'https://amersfoort.bestuurlijkeinformatie.nl/Reports/Item/abc');
  assert.equal(i.datum, '01-09-2024');
});

test('documentlinks worden ontdubbeld en krijgen de linktekst als titel', () => {
  const html = '<a href="/Reports/Document/1a-2b?documentId=d-1"><span>Woo besluit</span> 2 MB</a>'
    + '<a href="/Reports/Document/1a-2b?documentId=d-1">Woo besluit</a><a href="/Reports/Document/1a-2b?documentId=d-2">Bijlage &amp; lijst</a>';
  const l = documentLinks(html);
  assert.equal(l.length, 2);
  assert.equal(l[0].titel, 'Woo besluit 2 MB');
  assert.equal(l[1].titel, 'Bijlage & lijst');
  assert.equal(l[1].url, 'https://amersfoort.bestuurlijkeinformatie.nl/Document/View/d-2');
});

test('leeftijd in dagen uit dd-mm-jjjj', () => {
  assert.equal(Math.round(leeftijdDagen('01-09-2026', Date.UTC(2026, 8, 11))), 10);
  assert.equal(leeftijdDagen('onbekend'), null);
});

test('een foutbijlage krijgt maximaal drie pogingen zonder nieuwe bijlagen te blokkeren', () => {
  assert.equal(bijlageIsAfgehandeld('fout', 1), false);
  assert.equal(bijlageIsAfgehandeld('fout', 2), false);
  assert.equal(bijlageIsAfgehandeld('fout', 3), true);
  assert.equal(bijlageIsAfgehandeld('geen_tekst', 1), true);
  assert.equal(bijlageIsAfgehandeld('ok', 1), true);
});
