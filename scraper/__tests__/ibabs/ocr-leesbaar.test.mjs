import test from 'node:test';
import assert from 'node:assert/strict';
import { aandeelGewoneWoorden, isLeesbareOcr } from '../../src/ibabs-ocr-lib.js';

// Echte OCR-uitvoer van 3 oktober 2026, ingekort en herhaald tot boven de 200 tekens.
const mail = 'Verzonden: donderdag 5 december 2024 09:03 Aan: indebuurt033.nl Onderwerp: de opdracht voor het komende jaar. '
  + 'Wij hebben de stukken van de gemeente gelezen en zien dat de subsidie voor het wijkteam niet wordt verlengd. '
  + 'Kan de wethouder aangeven wat dit voor de bewoners van de wijk betekent en wie dit besluit heeft genomen?';
const foto = 'ad - of Mee ¥ Me oe . 3 Lg Eg ee en = " ts i 5 5 ah Ks P, ine hE) Peas Sy a ~ i cca ie ” '.repeat(4);
const kaart = '@ @ Li ® 100 mm E 147000 E f 17000 mm E ES SI ham = H 1655998 3 4 mm I | | — Ti | ( | NL | | a | Ee '.repeat(4);

test('een gescande mail telt als leesbare tekst', () => {
  assert.ok(aandeelGewoneWoorden(mail) > 0.15);
  assert.equal(isLeesbareOcr(mail), true);
});

test('ruis uit een foto of kaart telt niet als gelezen document', () => {
  assert.ok(aandeelGewoneWoorden(foto) < 0.05);
  assert.equal(isLeesbareOcr(foto), false);
  assert.equal(isLeesbareOcr(kaart), false);
});

test('te weinig tekens is nooit leesbaar, ook niet met gewone woorden', () => {
  assert.equal(isLeesbareOcr('Dit is een korte zin van de gemeente.'), false);
  assert.equal(isLeesbareOcr(''), false);
});
