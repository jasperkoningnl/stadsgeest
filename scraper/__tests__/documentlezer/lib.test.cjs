'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../src/documentlezer-lib.cjs');
const { controleerUittreksel, regelVan } = require('../../src/documentlezer-controle.cjs');

test('normaliseer trekt alleen witruimte gelijk', () => {
  assert.equal(lib.normaliseer('  een twee\n\ndrie\t vier '), 'een twee drie vier');
  assert.equal(lib.normaliseer('ge­zin'), 'gezin');
  assert.notEqual(lib.normaliseer('€ 1.200'), lib.normaliseer('€ 1200'));
  assert.notEqual(lib.normaliseer('Raad'), lib.normaliseer('raad'));
});

test('knip dekt de hele tekst in aansluitende delen', () => {
  const tekst = Array.from({ length: 900 }, (_, i) => `regel ${i} ${'x'.repeat(40)}`).join('\n');
  const delen = lib.knip(tekst, 10000);
  assert.ok(delen.length > 1);
  assert.equal(delen[0].van, 0);
  assert.equal(delen.at(-1).tot, tekst.length);
  for (let i = 1; i < delen.length; i++) assert.equal(delen[i].van, delen[i - 1].tot);
  for (const d of delen) assert.ok(d.tot - d.van <= 10000);
  assert.equal(delen.map((d) => tekst.slice(d.van, d.tot)).join(''), tekst);
  assert.deepEqual(lib.knip('kort', 10000), [{ van: 0, tot: 4 }]);
});

test('leesversie breekt lange regels zonder de tekst te veranderen', () => {
  const tekst = `${'woord '.repeat(900)}\nkort`;
  const lees = lib.leesversie(tekst);
  assert.ok(lees.split('\n').every((r) => r.length <= lib.MAX_REGEL));
  assert.equal(lib.normaliseer(lees), lib.normaliseer(tekst));
});

test('ontleedSleutel herkent item, bijlage en knipdeel', () => {
  assert.deepEqual(lib.ontleedSleutel('item-12'), { soort: 'item', id: 12, knipdeel: null });
  assert.deepEqual(lib.ontleedSleutel('bijlage-7-d2'), { soort: 'bijlage', id: 7, knipdeel: 2 });
  assert.throws(() => lib.ontleedSleutel('document-7'));
});

test('de leestekst is de langste van full_text en content; de weger ziet full_text eerst', () => {
  const rij = { full_text: 'menu', content: 'het eigenlijke stuk', summary: '' };
  assert.equal(lib.leestekstVanItem(rij), 'het eigenlijke stuk');
  assert.equal(lib.wegerTekst(rij), 'menu');
  assert.equal(lib.wegerTekst({ full_text: 'a'.repeat(9000) }).length, lib.WEGER_TEKENS);
});

function eenheid() {
  const kop = 'Raadsvoorstel over de begroting. Het college stelt voor de reserve aan te vullen.';
  const vulling = 'Dit is doorlopende tekst zonder bijzonderheden. '.repeat(120);
  const staart = 'De accountant waarschuwt dat het tekort in 2028 oploopt\ntot € 4,2 miljoen als de bezuiniging niet wordt gehaald.';
  const tekst = `${kop}\n${vulling}\n${staart}`;
  return { sleutel: 'item-1', tekst, weger: tekst.slice(0, lib.WEGER_TEKENS), begin_in_document: 0 };
}

function uittreksel(feiten) {
  return {
    versie: 'proef-1', sleutel: 'item-1', gelezen: { regels: 0, volledig: true, opmerking: '' },
    kern: 'Eerste zin. Tweede zin. Derde zin.', feiten,
    nieuwswaarde: { oordeel: 'aanleiding', waarom: 'Daarom.' },
  };
}

test('een letterlijk citaat wordt gevonden, ook over een regeleinde', () => {
  const r = controleerUittreksel(uittreksel([{
    soort: 'risico', zin: 'Het tekort loopt op.', plek: 'slot', regel: 1,
    citaat: 'het tekort in 2028 oploopt tot € 4,2 miljoen als de bezuiniging niet wordt gehaald',
  }]), eenheid());
  assert.deepEqual(r.vormfouten, []);
  assert.equal(r.feiten[0].gevonden, true);
  assert.equal(r.feiten[0].bij_weger, false);
  assert.equal(r.feiten[0].voorbij_grens, true);
});

test('een citaat uit het begin staat bij de weger', () => {
  const r = controleerUittreksel(uittreksel([{
    soort: 'toezegging', zin: 'De reserve wordt aangevuld.', plek: 'kop', regel: 1,
    citaat: 'Het college stelt voor de reserve aan te vullen.',
  }]), eenheid());
  assert.equal(r.feiten[0].gevonden, true);
  assert.equal(r.feiten[0].bij_weger, true);
  assert.equal(r.feiten[0].voorbij_grens, false);
});

test('een verbeterd, ingekort of samengevoegd citaat wordt afgekeurd', () => {
  const fout = [
    'het tekort in 2028 oploopt tot € 4,3 miljoen als de bezuiniging niet wordt gehaald',
    'het tekort in 2028 oploopt … als de bezuiniging niet wordt gehaald',
    'Het college stelt voor de reserve aan te vullen. De accountant waarschuwt dat het tekort',
    'het tekort in 2028 oploopt tot €4,2 miljoen als de bezuiniging niet wordt gehaald',
  ];
  const r = controleerUittreksel(uittreksel(fout.map((citaat) => ({
    soort: 'bedrag', zin: 'Zin.', plek: 'slot', regel: 1, citaat,
  }))), eenheid());
  assert.deepEqual(r.feiten.map((f) => f.gevonden), [false, false, false, false]);
});

test('vormfouten: onbekende soort, ontbrekend oordeel, niet volledig gelezen', () => {
  const u = uittreksel([{ soort: 'mening', zin: 'Zin.', plek: 'x', regel: 1, citaat: 'Het college stelt voor de reserve aan te vullen.' }]);
  u.nieuwswaarde.oordeel = 'misschien';
  u.gelezen.volledig = false;
  const r = controleerUittreksel(u, eenheid());
  assert.equal(r.vormfouten.length, 3);
});

test('regelVan geeft de regel van de leesversie', () => {
  const regels = ['eerste regel', '', 'tweede regel', 'derde regel'];
  const bron = lib.normaliseer(regels.join('\n'));
  assert.equal(regelVan(regels, bron.indexOf('eerste')), 1);
  assert.equal(regelVan(regels, bron.indexOf('tweede')), 3);
  assert.equal(regelVan(regels, bron.indexOf('derde')), 4);
});
