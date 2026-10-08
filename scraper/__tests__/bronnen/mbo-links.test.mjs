import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMboLinks } from '../../src/mbo-links.mjs';

test('vindt nieuwskaarten op de MBO-homepage en slaat overzicht en externe links over', () => {
  const html = `
    <a href="/nieuws/">Nieuws</a>
    <article><h2>Studenten openen leerrestaurant</h2><a href="/nieuws/studenten-openen-leerrestaurant/">Lees meer</a></article>
    <a href="https://ander.nl/nieuws/elders/">Elders</a>`;
  assert.deepEqual([...extractMboLinks(html)], [[
    'https://www.mboamersfoort.nl/nieuws/studenten-openen-leerrestaurant/',
    'Studenten openen leerrestaurant',
  ]]);
});
