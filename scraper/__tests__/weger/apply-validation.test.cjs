'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, words } = require('../../src/weger-apply.cjs');

function validPlan() {
  return {
    reviews: [{ signal_id: 42, status_to: 'watching', reason: 'Officiële nieuwe bron gelezen.' }],
    tips: [{
      titel: 'Raad besluit over nieuwe woonwijk',
      kern: 'Het raadsbesluit maakt een eerder voornemen concreet en controleerbaar.',
      briefing: 'Controleer planning, geld en gevolgen bij gemeente en betrokken bewoners.',
      vervolgvragen: ['Wanneer begint de uitvoering?'],
      soort: 'nieuwsfeit',
      gemeente: 'Amersfoort',
      categorie: 'wonen',
      score: 6,
      score_motivatie: 'Officieel besluit met duidelijke lokale gevolgen.',
      weging: { primaire_bron: 3, lokale_impact: 3 },
      herkomst: [{ naam: 'Gemeente Amersfoort', tier: 1 }],
      elders_gebracht: [],
      toegevoegde_waarde: '',
      trefwoorden: ['woonwijk', 'raadsbesluit', 'planning'],
      dossier_id: null,
      signals: [{ id: 42, rol: 'dragend' }],
    }],
    dossier_facts: [],
  };
}

test('een geldig wegerplan heeft geen fouten', () => {
  assert.deepEqual(validatePlan(validPlan()), []);
});

test('een tip vereist een review voor ieder gekoppeld signaal', () => {
  const plan = validPlan();
  plan.reviews = [];
  assert.match(validatePlan(plan).join('\n'), /mist een review-oordeel/);
});

test('een tipsignaal kan niet tegelijk worden weggegooid', () => {
  const plan = validPlan();
  plan.reviews[0].status_to = 'discarded';
  assert.match(validatePlan(plan).join('\n'), /niet tegelijk aan een tip gekoppeld en discarded/);
});

test('grenzen en vaste waarden worden gecontroleerd', () => {
  const plan = validPlan();
  plan.tips[0].titel = 'Deze titel bevat veel te veel woorden en hoort daarom niet door de validatie heen te komen';
  plan.tips[0].signals[0].rol = 'hoofdbron';
  plan.tips[0].trefwoorden = ['één'];
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /maximaal 10 woorden/);
  assert.match(errors, /rol is ongeldig/);
  assert.match(errors, /3 tot 5/);
});

test('woorden telt lege ruimte niet mee', () => {
  assert.equal(words('  een   twee\n drie '), 3);
});
