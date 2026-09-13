const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINIMUMS, calculateMetrics, canonicalizeArticleUrl, classifyFeedback,
  evidenceHash, latestFeedbackByTip,
} = require('../../src/phase5-core.cjs');
const { RULE_IDENTITIES } = require('../../src/kg/detection-rules.cjs');

test('canonicaliseert Nieuwsplein33-artikelen en verwijdert tracking', () => {
  assert.equal(
    canonicalizeArticleUrl('http://www.nieuwsplein33.nl/nieuws/test/?utm_source=x#deel'),
    'https://nieuwsplein33.nl/nieuws/test',
  );
  assert.throws(() => canonicalizeArticleUrl('https://example.org/artikel'), /nieuwsplein33/);
});

test('houdt kwaliteitsdimensies uit elkaar', () => {
  assert.deepEqual(classifyFeedback('afgekeurd', 'feitelijk_fout').verdict, 'feitelijk_fout');
  assert.equal(classifyFeedback('afgekeurd', 'feitelijk_fout').dimension, 'tipkwaliteit');
  assert.equal(classifyFeedback('afgekeurd', 'duplicaat').dimension, 'tipkwaliteit');
  assert.equal(classifyFeedback('afgekeurd', 'verkeerd_geclusterd').dimension, 'clustervorming');
  assert.equal(classifyFeedback('afgekeurd', 'bron_fout').dimension, 'bronkwaliteit');
  assert.equal(classifyFeedback('geparkeerd', 'te_vroeg').dimension, 'timing');
  assert.equal(classifyFeedback('afgekeurd', 'geen_nieuwswaarde').dimension, 'redactionele_relevantie');
});

test('onderdrukt historische dubbele handelingen en respecteert heropenen', () => {
  const rows = [
    { id: 1, tip_id: 7, gebruiker: 'redactie', actie: 'geparkeerd', reden_code: 'te_vroeg', created_at: '2026-01-01 10:00:00' },
    { id: 2, tip_id: 7, gebruiker: 'redactie', actie: 'geparkeerd', reden_code: 'te_vroeg', created_at: '2026-01-01 10:00:00' },
    { id: 3, tip_id: 8, gebruiker: 'redactie', actie: 'goedgekeurd', created_at: '2026-01-01 11:00:00' },
    { id: 4, tip_id: 8, gebruiker: 'redactie', actie: 'heropend', created_at: '2026-01-01 12:00:00' },
  ];
  assert.deepEqual(latestFeedbackByTip(rows).map(row => row.id), [1]);
});

test('telt artikeluitkomsten per canonieke URL precies eenmaal', () => {
  const feedback = [
    { id: 1, tip_id: 1, actie: 'goedgekeurd', verdict: 'bruikbaar', dimension: 'tipkwaliteit', created_at: '2026-01-01' },
    { id: 2, tip_id: 2, actie: 'afgekeurd', verdict: 'duplicaat', dimension: 'clustervorming', created_at: '2026-01-02' },
  ];
  const contexts = new Map([[1, { signals: [{ rule: 'R5', sources: [{ id: 4, name: 'Bron A', role: null }] }] }], [2, { signals: [{ rule: 'R10', sources: [{ id: 4, name: 'Bron A', role: null }] }] }]]);
  const outcomes = [
    { normalized_url: 'https://nieuwsplein33.nl/a', without_stadsgeest: 1, status: 'published' },
    { normalized_url: 'https://nieuwsplein33.nl/a', without_stadsgeest: 1, status: 'published' },
  ];
  const metrics = calculateMetrics({ feedbackRows: feedback, contextsByFeedbackId: contexts, outcomes, signalSummary: { total: 10, unused: 4 } });
  assert.equal(metrics.overall.assessed, 2);
  assert.equal(metrics.overall.precision, 0.5);
  assert.equal(metrics.outcomes.published, 1);
  assert.equal(metrics.outcomes.withoutStadsgeest, 1);
  assert.equal(metrics.sources[0].assessed, 2);
  assert.equal(metrics.overall.evidenceLevel, 'onvoldoende_voor_rapportage');
  assert.equal(MINIMUMS.sourceOrRuleChange, 50);
  assert.equal(evidenceHash({ b: 2, a: 1 }), evidenceHash({ a: 1, b: 2 }));
});

test('beschermt de vaste betekenis van R1-R16', () => {
  assert.deepEqual(Object.keys(RULE_IDENTITIES), Array.from({ length: 16 }, (_, i) => `R${i + 1}`));
  assert.equal(RULE_IDENTITIES.R5, 'Robuuste anomalie geregistreerde misdrijven');
  assert.equal(RULE_IDENTITIES.R10, 'Multi-source versterking');
  assert.equal(RULE_IDENTITIES.R11, 'Opvallende ontwikkeling leerlingaantal');
  assert.equal(RULE_IDENTITIES.R12, 'Opvallende ontwikkeling schoolprognose');
  assert.equal(RULE_IDENTITIES.R13, 'Betekenisvolle wijziging Onderwijsinspectie');
  assert.equal(RULE_IDENTITIES.R14, 'Grote lokale verkeersmaatregel');
});
