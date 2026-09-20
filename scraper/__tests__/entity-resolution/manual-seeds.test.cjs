const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEEDS } = require('../../migrate-phase1-seed-provenance.cjs');

test('iedere handmatige kernseed heeft herleidbare bron, reden en reviewbare identiteit', () => {
  assert.ok(SEEDS.length >= 6);
  for (const seed of SEEDS) {
    assert.ok(seed.name);
    assert.match(seed.website, /^[a-z0-9.-]+\.[a-z]{2,}$/i);
    assert.match(seed.sourceUrl, /^https:\/\//);
    assert.ok(seed.reason.length >= 20);
    assert.ok(seed.aliases.length >= 2);
  }
  for (const required of ['DierenPark Amersfoort', 'Flint Theater', 'FLUOR', 'De Lieve Vrouw']) {
    assert.ok(SEEDS.some(seed => seed.name === required), `${required} ontbreekt`);
  }
});
