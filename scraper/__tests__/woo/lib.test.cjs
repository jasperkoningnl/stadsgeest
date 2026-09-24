'use strict';

// Zoekregels voor Woo-bijlagen (woo-scan-lib.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanTekst, itemScore, PROMOTIE_DREMPEL } = require('../../src/woo-scan-lib.cjs');

test('liquiditeitstekort in een brief wordt gevonden met fragment', () => {
  const t = 'Uit de liquiditeitsprognose van MetMaya blijkt er voor de betalingen op 23 oktober niet voldoende middelen zijn.';
  const r = scanTekst(t);
  const liq = r.find((x) => x.term === 'liquiditeit');
  assert.ok(liq);
  assert.equal(liq.gewicht, 3);
  assert.match(liq.fragmenten[0], /23 oktober/);
});

test('beschikking telt niet als schikking', () => {
  const r = scanTekst('De beschikking is verzonden. Er volgt geen beschikkingen.');
  assert.equal(r.find((x) => x.term === 'schikking'), undefined);
  assert.ok(scanTekst('Partijen bereikten een schikking.').find((x) => x.term === 'schikking'));
});

test('aansprakelijk gesteld en aansprakelijkstelling vallen onder één term', () => {
  const r = scanTekst('De gemeente is aansprakelijk gesteld. Brief aansprakelijkstelling volgt.');
  const a = r.find((x) => x.term === 'aansprakelijkstelling');
  assert.equal(a.aantal, 2);
});

test('treffers dicht op elkaar leveren één fragment op, maximaal drie per term', () => {
  const blok = 'fraude '.repeat(5) + 'x'.repeat(600) + ' ';
  const r = scanTekst(blok.repeat(6)).find((x) => x.term === 'fraude');
  assert.equal(r.aantal, 30);
  assert.equal(r.fragmenten.length, 3);
});

test('itemScore telt per term het hoogste gewicht, niet het aantal treffers', () => {
  const treffers = [
    { term: 'fraude', gewicht: 3 }, { term: 'fraude', gewicht: 3 },
    { term: 'dwangsom', gewicht: 2 },
  ];
  assert.equal(itemScore(treffers), 5);
  assert.ok(itemScore([{ term: 'claim', gewicht: 1 }]) < PROMOTIE_DREMPEL);
  assert.ok(itemScore([{ term: 'ondermijning', gewicht: 3 }]) >= PROMOTIE_DREMPEL);
});

test('lege of ontbrekende tekst geeft geen treffers', () => {
  assert.deepEqual(scanTekst(null), []);
  assert.deepEqual(scanTekst(''), []);
});

test('vaste Woo-zinnen en contractclausules tellen niet mee', () => {
  const boiler = 'Deze informatie betreft persoonsgegevens van strafrechtelijke aard van de UAVG. '
    + 'Opdrachtgever kan zonder enige aanmaning of ingebrekestelling ontbinden. '
    + 'Indien een Partner insolvent wordt verklaard of surseance van betaling wordt verleend, eindigt deelname.';
  const r = scanTekst(boiler);
  assert.equal(r.find((x) => x.term === 'strafrechtelijk'), undefined);
  assert.equal(r.find((x) => x.term === 'ingebrekestelling'), undefined);
  assert.equal(r.find((x) => x.term === 'faillissement'), undefined);
  assert.ok(scanTekst('Er is aangifte gedaan tegen de bestuurder.').find((x) => x.term === 'strafrechtelijk'));
});

test('huurcontract- en accountantsclausules tellen niet mee', () => {
  const t = 'Deze overeenkomst eindigt van rechtswege, zonder dat daartoe een waarschuwing, ingebrekestelling, bevel nodig is, bij faillissement van Huurder. '
    + 'Dit geldt eveneens bij beschadiging, vernietiging of fraude. '
    + 'Afwijkingen van materieel belang als gevolg van fraude of fouten.';
  const r = scanTekst(t);
  for (const term of ['faillissement', 'ingebrekestelling', 'fraude']) assert.equal(r.find((x) => x.term === term), undefined, term);
  assert.ok(scanTekst('De stichting ging failliet na het vertrek van de bestuurder.').find((x) => x.term === 'faillissement'));
});
