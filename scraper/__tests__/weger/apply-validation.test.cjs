'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { preflight, validatePlan, words, writePlan } = require('../../src/weger-apply.cjs');
const { jsonValue, pendingSignals } = require('../../src/weger-workset.cjs');

test('de wachtrij geeft alle open signalen en een opgeslagen oordeel kan niet worden herhaald', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    await db.executeMultiple(`
      CREATE TABLE signals (id INTEGER PRIMARY KEY, title TEXT, summary TEXT, status TEXT,
        confirmations INTEGER, first_seen_at TEXT, last_seen_at TEXT);
      CREATE TABLE tip_signals (signal_id INTEGER);
      CREATE TABLE signal_events (signal_id INTEGER, actor TEXT, event_type TEXT, status_from TEXT,
        status_to TEXT, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      WITH RECURSIVE ids(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM ids WHERE id<70)
      INSERT INTO signals SELECT id, 'Signaal ' || id, '', 'new', 1, '2026-11-12 00:00:00',
         '2026-11-12 00:00:00' FROM ids;
      INSERT INTO tip_signals VALUES (70);
      INSERT INTO signal_events (signal_id,actor,created_at) VALUES (69,'weger','2026-11-12 01:00:00');
      INSERT INTO signal_events (signal_id,actor,created_at) VALUES (68,'weger','2026-11-11 01:00:00');
      UPDATE signals SET status='discarded' WHERE id=67;
    `);
    const queue = await pendingSignals(db, { queue: true });
    assert.equal(queue.length, 67);
    assert.deepEqual(queue.slice(0, 2).map((row) => row.id), [1, 2]);
    assert.equal(queue.at(-1).id, 68);
    assert.deepEqual((await pendingSignals(db, { ids: [1, 68, 69] })).map((row) => row.id), [68, 1]);
    const plan = { reviews: [{
      signal_id: 1, status_to: 'watching', reason: 'Gelezen.',
      expected_last_seen_at: queue[0].last_seen_at, expected_reviewed_at: null,
    }] };
    assert.deepEqual(validatePlan(plan), []);
    const check = await preflight(db, plan);
    assert.deepEqual(check.errors, []);
    await writePlan(db, plan, check.statusBySignal);
    assert.match((await preflight(db, plan)).errors[0], /intussen beoordeeld/);
    assert.equal((await pendingSignals(db, { queue: true })).length, 66);
  } finally {
    db.close();
  }
});

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
      score: 8,
      score_motivatie: 'Officieel besluit met duidelijke lokale gevolgen.',
      weging: {
        _model: 'redactioneel-2', _route: 'onderzoek', ontdekking: 3, bewijs: 3, gevolgen: 2,
        _voorwaarden: { bronregel: true, lokaal: true, vergelijkbaar: true, nieuwheid: true, tegenverklaring: true },
        _onderbouwing: { ontdekking: 'Twee planningen tonen een nieuw verschil.', bewijs: 'Dezelfde projecten en mijlpalen gecontroleerd.',
          gevolgen: 'De planning raakt woningzoekenden.', tegenverklaring: 'Een andere projectfase is gecontroleerd.', nieuwheid: 'De vergelijking ontbreekt in eerdere berichtgeving.' },
      },
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

test('een waarschuwing maakt een tip onder de nieuwe drempel niet geldig', () => {
  const plan = validPlan();
  plan.tips[0].score = 5;
  plan.tips[0].briefing = plan.tips[0].briefing.replace(
    '- Stellen dat de uitvoering al begonnen is',
    '- Stellen dat de uitvoering al begonnen is\n- Redactionele waarschuwing: deze tip blijft onder de gewone drempel'
  );
  assert.match(validatePlan(plan).join('\n'), /geen uitzondering onder de drempel/);
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

test('een supertip-run maakt hoogstens één supertip, met minimaal score 7', () => {
  const plan = validPlan();
  plan.run = 'supertip';
  plan.tips[0].supertip = true;
  plan.tips[0].score = 5;
  const tweede = { ...validPlan().tips[0], supertip: true, signals: [{ id: 43, rol: 'dragend' }] };
  plan.tips.push(tweede);
  plan.reviews.push({ signal_id: 43, status_to: 'watching', reason: 'Gelezen.' });
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /hoogstens één supertip/);
  assert.match(errors, /minimaal score 7/);
});

test('Supertip hoort niet in de titel', () => {
  const plan = validPlan();
  plan.tips[0].titel = 'Supertip: raad besluit over woonwijk';
  assert.match(validatePlan(plan).join('\n'), /gebruik het veld supertip/);
});

test('oude bonusvelden kunnen de nieuwe drempel niet halen', () => {
  const plan = validPlan();
  plan.tips[0].weging = { tier_1: 3, concreet_bedrag: 2, precieze_locatie: 1 };
  plan.tips[0].score = 6;
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /_model moet redactioneel-2/);
  assert.match(errors, /geen losse bron-, bedrag- of locatiebonussen/);
});

test('puntensom, bovengrens en criteriumminima worden afzonderlijk gecontroleerd', () => {
  const plan = validPlan();
  plan.tips[0].score = 9;
  assert.match(validatePlan(plan).join('\n'), /moet de som/);
  plan.tips[0].weging.ontdekking = 1;
  plan.tips[0].weging.gevolgen = 3;
  plan.tips[0].score = 7;
  assert.match(validatePlan(plan).join('\n'), /minstens 2 voor ontdekking/);
  plan.tips[0].weging.ontdekking = 5;
  plan.tips[0].score = 11;
  assert.match(validatePlan(plan).join('\n'), /van 0 tot 4/);
});

test('onzekere nieuwheid of ontbrekende tegenverklaring blokkeert ook een hoge score', () => {
  const plan = validPlan();
  plan.tips[0].weging._voorwaarden.nieuwheid = false;
  delete plan.tips[0].weging._onderbouwing.tegenverklaring;
  const errors = validatePlan(plan).join('\n');
  assert.match(errors, /_voorwaarden.nieuwheid/);
  assert.match(errors, /_onderbouwing.tegenverklaring/);
});

test('nieuwsfeitroute vereist zwaar belang en een concrete uitzonderingsreden', () => {
  const plan = validPlan();
  plan.tips[0].weging._route = 'nieuwsfeit';
  assert.match(validatePlan(plan).join('\n'), /zwaar lokaal belang/);
  plan.tips[0].weging.gevolgen = 3;
  plan.tips[0].score = 9;
  plan.tips[0].weging._nieuwsfeit_reden = 'Een onverwachte sluiting heeft onmiddellijk gevolgen voor de hele stad.';
  assert.deepEqual(validatePlan(plan), []);
  plan.run = 'supertip';
  plan.tips[0].supertip = true;
  assert.match(validatePlan(plan).join('\n'), /supertip gebruikt de route onderzoek/);
});

test('nul tips blijft geldig en het nieuwe voorbeeld gebruikt het nieuwe model', () => {
  assert.deepEqual(validatePlan({ reviews: [], tips: [], dossier_facts: [] }), []);
  assert.deepEqual(validatePlan(require('../../../operations/weger-plan.example.json')), []);
});
