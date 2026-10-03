import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRubriek, GROND_VASTGOED, FALLBACK_SOURCE, ALLE_BRONNEN } from '../../src/ob-routing.mjs';

test('rubriek beslist zoals voorheen', () => {
  assert.equal(routeRubriek(['Omgevingsvergunning'], 'Aanvraag dakkapel Voorbeeldstraat 1').source, 'ob-omgevingsvergunningen');
  assert.equal(routeRubriek(['Verkeersbesluit']).source, 'ob-verkeersbesluiten');
  assert.equal(routeRubriek(['Beleidsregels']).source, 'ob-beleidsregels');
  assert.equal(routeRubriek(['Overige besluiten van algemene strekking']).source, FALLBACK_SOURCE.source);
  assert.equal(routeRubriek([], null).source, FALLBACK_SOURCE.source);
});

test('grond en vastgoed: Didam-publicaties gaan op titel vóór de rubriek', () => {
  const titels = [
    'Voornemen tot verkoop van een perceel grond aan de Voorbeeldweg te Amersfoort',
    'Gemeente Amersfoort - voornemen tot uitgifte in erfpacht van een bouwkavel in Vathorst',
    'Bekendmaking voornemen tot verhuur gemeentelijk vastgoed Stadsring 1',
    'Publicatie op grond van het Didam-arrest: verkoop grond Hogeweg',
    'Gemeente Amersfoort is voornemens grond te verkopen; er is één serieuze gegadigde',
    'Verkoop van snippergroen nabij de Laan der Hoven',
    'Gronduitgifte De Hoef West, kavel 3',
  ];
  for (const t of titels) {
    assert.equal(routeRubriek(['Overige besluiten van algemene strekking'], t).source, GROND_VASTGOED.source, t);
  }
  // Ook als de rubriek iets anders zegt: de titel wint.
  assert.equal(routeRubriek(['Omgevingsvergunning'], 'Voornemen tot verkoop van een perceel aan de Kwekersweg').source, GROND_VASTGOED.source);
});

test('grond en vastgoed: geen valse treffers op gewone vergunningen', () => {
  const titels = [
    'Verleende omgevingsvergunning, bouwen van een berging op eigen grond, Voorbeeldstraat 12',
    'Kennisgeving verlenging beslistermijn, Grondstraat 4',
    'Vastgesteld bestemmingsplan Kavelweg Noord',
    'Verkoop- en verhuurverbod lachgas: wijziging APV',
    'Aanwijzingsbesluit parkeerverbod Pandhuisstraat',
  ];
  for (const t of titels) {
    assert.notEqual(routeRubriek(['Overige besluiten van algemene strekking'], t).source, GROND_VASTGOED.source, t);
  }
  assert.equal(ALLE_BRONNEN.length, 8);
  assert.equal(new Set(ALLE_BRONNEN.map((b) => b.source)).size, 8);
});
