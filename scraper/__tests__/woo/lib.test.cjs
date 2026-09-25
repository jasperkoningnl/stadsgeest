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

test('Schothorsterlaan-contractboilerplate wordt niet gepromoveerd', () => {
  const t = 'Huurder failliet wordt verklaard of surseance van betaling aanvraagt. '
    + 'In alle gevallen waarin verhuurder een sommatie, een ingebrekestelling of een exploot doet uitbrengen. '
    + 'Na ommekomst van de in de ingebrekestelling gestelde termijn. '
    + 'Indien de huurder het gehuurde onrechtmatig onder zich houdt. '
    + 'De notariële akte valt onder de geheimhoudingsplicht van artikel 20 van de Wet op het notarisambt.';
  assert.deepEqual(scanTekst(t), []);
});

test('algemene inkoopvoorwaarden en afgebroken beschikking geven geen zware treffers', () => {
  const t = 'De Gemeente mag de Overeenkomst ontbinden indien de Contractant zich schuldig heeft gemaakt aan een integriteitsschending volgens het screeningsresultaat. '
    + 'De Gemeente is gerechtigd een integriteitsscreening uit te voeren met een advies volgens de Wet Bibob. '
    + 'De apparatuur wordt ter be- schikking gesteld.';
  assert.deepEqual(scanTekst(t), []);
});

test('bussluiscontract bevat geen journalistieke ingebrekestelling of onrechtmatigheid', () => {
  const t = 'Beide partijen mogen ontbinden na een schriftelijke ingebrekestelling met een redelijke hersteltermijn. '
    + 'Wie onrechtmatig passeert krijgt een waarschuwing; de camera handhaaft onrechtmatige passages van voertuigen.';
  assert.deepEqual(scanTekst(t), []);
});

test('standaardvoorwaarden en camera-passages uit Texelstraat-Woo tellen niet', () => {
  const tekst = `Beide partijen mogen de overeenkomst ontbinden indien de andere partij
    de verplichtingen niet nakomt. Echter pas na een schriftelijke ingebrekestelling
    die zo gedetailleerd mogelijk is. Cliënt geeft daarbij een redelijke termijn om
    de tekortkoming te herstellen. Artikel 10. Geheimhouding. Opdrachtgever en
    Opdrachtnemer verbinden zich om geheimhouding te verzekeren. Wie onrechtmatig
    passeert, krijgt een waarschuwing of een bekeuring thuisgestuurd.`;
  assert.deepEqual(scanTekst(tekst), []);
});
