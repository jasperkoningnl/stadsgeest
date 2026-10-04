import test from 'node:test';
import assert from 'node:assert/strict';
import { routineReden } from '../../src/routine-lib.mjs';

const ob = (title) => ({ source_name: 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort', title });

test('tijdelijk gebruik van de weg en verlengde beslistermijn zijn routine', () => {
  for (const titel of [
    'Verleende vergunning tijdelijk gebruik van de weg, plaatsen van een container van 2 september t/m 23 september 2026 ter hoogte van Blekerssingel 38',
    'Verlenging verleende vergunning tijdelijk gebruik van de weg, plaatsen van een rolsteiger van 31 augustus t/m 11 september 2026 ter hoogte van Zuidsingel 11',
    'Verleende vergunning tijdelijk gebruik van de weg, plaatsen bouwplaats van 28 september 2026 t/m 8 januari 2027 ter hoogte van Klarissenstraat 58-110',
    'Verleende vergunning tijdelijk gebruik van de weg, plaatsen van een containervan 18 september t/m 24 september 2026 ter hoogte van Geelgorsstraat 23',
    'Amersfoort - Publicatie beslistermijn verlengen Leusderweg 310, 3817 KJ Amersfoort',
    'Kennisgeving verlenging beslistermijn Aanvraag beschikking behandelen Ruifweg 5, 3835PN Stoutenburg',
  ]) assert.match(routineReden(ob(titel)) || '', /^routine: /, titel);
});

test('echte aanvragen, monumentgevoelige soorten en andere bronnen blijven bij de weger', () => {
  for (const titel of [
    'Ontvangen aanvraag omgevingsvergunning voor het plaatsen van een containerstalling op het perceel Disselplein 2, 3829 MD Hooglanderveen',
    'Ontvangen aanvraag omgevingsvergunning voor het plaatsen van een dakkapel op het perceel Nieuweweg 4',
    'Verleende omgevingsvergunning voor het kappen van een boom op het perceel Utrechtseweg 266',
    'Verkeersbesluit plaatsen ondergrondse containers Soesterkwartier',
  ]) assert.equal(routineReden(ob(titel)), null, titel);
  assert.equal(routineReden({ source_name: 'De Stad Amersfoort', title: 'Vergunning tijdelijk gebruik van de weg voor container' }), null);
  assert.equal(routineReden({ source_name: 'Officiële Bekendmakingen — Leusden', title: '' }), null);
});
