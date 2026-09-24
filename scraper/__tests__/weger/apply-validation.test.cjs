'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, words } = require('../../src/weger-apply.cjs');
const { jsonValue } = require('../../src/weger-workset.cjs');

function validPlan() {
  return {
    reviews: [{ signal_id: 42, status_to: 'watching', reason: 'Officiële nieuwe bron gelezen.' }],
    tips: [{
      titel: 'Raad besluit over nieuwe woonwijk',
      kern: 'Het raadsbesluit maakt een eerder voornemen concreet en controleerbaar.',
      briefing: 'WAT WE WETEN\n1. De raad nam een besluit. — Gemeente Amersfoort, tier 1, https://voorbeeld.invalid/besluit, 12 september 2026\n\nBETROKKEN PERSONEN EN ORGANISATIES\n- Gemeente Amersfoort — besluitvormer\n\nHOE DIT IS GEVONDEN\nHet raadsbesluit is volledig gelezen.\n\nWAT WE NIET WETEN\n- Wanneer de uitvoering begint\n\nWAT HIER NIET IN MAG\n- Stellen dat de uitvoering al begonnen is\n\nELDERS GEBRACHT\nNiet aangetroffen.',
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

test('werkset-JSON behoudt het hoofdobject en zet bigint om', () => {
  const output = JSON.stringify({ signal_id: 42, confirmations: 3n }, jsonValue);
  assert.deepEqual(JSON.parse(output), { signal_id: 42, confirmations: 3 });
});

test('een dunne tip zet de drempelwaarschuwing onderaan en niet in de wachtrijmotivatie', () => {
  const plan = validPlan();
  plan.tips[0].score = 5;
  plan.tips[0].briefing = plan.tips[0].briefing.replace(
    '- Stellen dat de uitvoering al begonnen is',
    '- Stellen dat de uitvoering al begonnen is\n- Redactionele waarschuwing: deze tip blijft onder de gewone drempel'
  );
  assert.deepEqual(validatePlan(plan), []);

  plan.tips[0].score_motivatie = 'Deze tip ligt onder de gewone drempel.';
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /niet in score_motivatie/);
});

test('briefingkoppen moeten exact op een eigen regel staan', () => {
  const plan = validPlan();
  plan.tips[0].briefing = plan.tips[0].briefing.replace('WAT WE WETEN', '1. WAT WE WETEN');
  assert.match(validatePlan(plan).join('\n'), /mist de kop WAT WE WETEN/);
});

test('supertip mag alleen in een supertip-run', () => {
  const plan = validPlan();
  plan.tips[0].supertip = true;
  assert.match(validatePlan(plan).join('\n'), /alleen in een plan met run: "supertip"/);
  plan.run = 'supertip';
  assert.deepEqual(validatePlan(plan), []);
});

test('een supertip-run maakt hoogstens één supertip, met minimaal score 6', () => {
  const plan = validPlan();
  plan.run = 'supertip';
  plan.tips[0].supertip = true;
  plan.tips[0].score = 5;
  const tweede = { ...validPlan().tips[0], supertip: true, signals: [{ id: 43, rol: 'dragend' }] };
  plan.tips.push(tweede);
  plan.reviews.push({ signal_id: 43, status_to: 'watching', reason: 'Gelezen.' });
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /hoogstens één supertip/);
  assert.match(errors, /minimaal score 6/);
});

test('Supertip hoort niet in de titel', () => {
  const plan = validPlan();
  plan.tips[0].titel = 'Supertip: raad besluit over woonwijk';
  assert.match(validatePlan(plan).join('\n'), /gebruik het veld supertip/);
});
