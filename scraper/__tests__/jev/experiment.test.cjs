'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../src/jev-experiment-lib.cjs');
function response() {
  return { model: lib.MODEL, usage: { input_tokens: 1000 }, answers: {
    relation: { type: 'choice', choice: 'same_case', confidence: 0.875,
      probabilities: { same_case: 0.9, related: 0.025, overlap_only: 0.025, unrelated: 0.025, insufficient: 0.025 } },
    same_case: { type: 'noul', noul: 0.9 },
  } };
}
test('timeout en onbekende gebruiksdata blijven volledig gereserveerd', () => {
  const entries = [{ status: 'unresolved' }, { status: 'reserved' }];
  assert.equal(lib.budgetUsed(entries), 2 * lib.RESERVATION);
  assert.equal(lib.canReserve(entries, 2.5 * lib.RESERVATION), false);
  assert.equal(lib.canReserve(entries, 3.1 * lib.RESERVATION), true);
});
test('gevalideerd succes rekent alleen bevestigd invoergebruik', () => {
  const result = lib.validateResponse(response());
  assert.equal(lib.budgetUsed([{ status: 'ok', result }]), 1000 * lib.PRICE);
  assert.equal(lib.budgetUsed([{ status: 'not_sent' }]), 0);
});
test('modelwijziging, ontbrekend gebruik en ongeldige verdelingen falen gesloten', () => {
  for (const mutate of [r => r.model = 'jev-latest', r => delete r.usage,
    r => r.usage.input_tokens = 64001, r => r.answers.relation.probabilities.same_case = 0.3,
    r => r.answers.same_case.noul = NaN, r => r.answers.relation.choice = 'invented']) {
    const r = response(); mutate(r); assert.throws(() => lib.validateResponse(r));
  }
});
test('herordenen behoudt opties en maakt aparte reproduceerbare cache-identiteit', () => {
  const pair = { a: { title: 'A' }, b: { title: 'B' } };
  const a = lib.requestFor(pair), b = lib.requestFor(pair, true);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(Object.keys(a.questions.relation.criteria).reverse(), Object.keys(b.questions.relation.criteria));
  assert.notEqual(lib.hash(a), lib.hash(b));
});
test('reviewmeting telt geen modellen, dubbelen of onbekende paren als menselijk bewijs', () => {
  const pairs = [{ id: 'p', baseline_title_link: true }];
  const results = [{ status: 'ok', variant: 'normal', pair_id: 'p', result: lib.validateResponse(response()) }];
  const reviews = [
    { pair_id: 'p', label: 'same_case', reviewer: 'model', reviewer_type: 'ai' },
    { pair_id: 'missing', label: 'same_case', reviewer: 'human', reviewer_type: 'human' },
    { pair_id: 'p', label: 'same_case', reviewer: 'Jasper', reviewer_type: 'human' },
    { pair_id: 'p', label: 'unrelated', reviewer: 'Jasper', reviewer_type: 'human' },
  ];
  const evaluation = lib.evaluateLabels(pairs, results, reviews);
  assert.equal(evaluation.human_reviewed, 1);
  assert.equal(evaluation.classification_accuracy, null);
});
test('passages zijn begrensd en contactgegevens gaan niet naar de API', () => {
  const d = { title: 'Beleidsstuk', body: 'Mail test@example.nl of bel 033-1234567. ' + 'x'.repeat(10000) };
  const e = lib.excerpt(d, ['x']);
  assert.ok(e.passages.length <= 5);
  assert.ok(e.passages.every(p => p.end - p.start <= 1100));
  assert.ok(!JSON.stringify(e).includes('test@example.nl'));
  assert.ok(!JSON.stringify(e).includes('033-1234567'));
});
