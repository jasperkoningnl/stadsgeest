const crypto = require('crypto');

const POLICY_VERSION = 'phase5-v1';
const MINIMUMS = Object.freeze({
  reporting: 10,
  manualCalibration: 30,
  sourceOrRuleChange: 50,
  learnedRanking: 200,
  learnedRankingPositive: 50,
  learnedRankingNegative: 50,
  monthlyCyclesForChange: 2,
});

const REASON_POLICY = Object.freeze({
  zelf_niet_gevonden: ['bruikbaar', 'redactionele_relevantie'],
  concreet_gemaakt: ['bruikbaar', 'tipkwaliteit'],
  stond_al_op_lijst: ['bekend', 'timing'],
  goede_invalshoek: ['bruikbaar', 'redactionele_relevantie'],
  te_vroeg: ['bruikbaar', 'timing'],
  geen_tijd: ['bruikbaar', 'timing'],
  wacht_op_meer: ['te_zwak', 'tipkwaliteit'],
  onduidelijk: ['te_zwak', 'tipkwaliteit'],
  oud_nieuws: ['bekend', 'timing'],
  al_bekend: ['bekend', 'timing'],
  geen_nieuwswaarde: ['niet_relevant', 'redactionele_relevantie'],
  buiten_gebied: ['niet_lokaal', 'redactionele_relevantie'],
  niet_lokaal: ['niet_lokaal', 'redactionele_relevantie'],
  te_dun: ['te_zwak', 'tipkwaliteit'],
  te_zwak: ['te_zwak', 'tipkwaliteit'],
  duplicaat: ['duplicaat', 'tipkwaliteit'],
  verkeerd_geclusterd: ['duplicaat', 'clustervorming'],
  feitelijk_fout: ['feitelijk_fout', 'tipkwaliteit'],
  bron_fout: ['feitelijk_fout', 'bronkwaliteit'],
});

function classifyFeedback(action, reasonCode) {
  if (reasonCode && REASON_POLICY[reasonCode]) {
    const [verdict, dimension] = REASON_POLICY[reasonCode];
    return { verdict, dimension, policyVersion: POLICY_VERSION };
  }
  if (action === 'goedgekeurd') return { verdict: 'bruikbaar', dimension: 'redactionele_relevantie', policyVersion: POLICY_VERSION };
  if (action === 'geparkeerd') return { verdict: 'bruikbaar', dimension: 'timing', policyVersion: POLICY_VERSION };
  if (action === 'gepubliceerd') return { verdict: 'bruikbaar', dimension: 'artikeluitkomst', policyVersion: POLICY_VERSION };
  if (action === 'afgekeurd') return { verdict: 'onbekend', dimension: 'redactionele_relevantie', policyVersion: POLICY_VERSION };
  return { verdict: null, dimension: 'correctie', policyVersion: POLICY_VERSION };
}

function canonicalizeArticleUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Alleen http- of https-adressen.');
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'nieuwsplein33.nl') throw new Error('Gebruik het adres van het artikel op nieuwsplein33.nl.');
  parsed.protocol = 'https:';
  parsed.hostname = 'nieuwsplein33.nl';
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function evidenceHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function latestFeedbackByTip(rows) {
  const seenFingerprints = new Set();
  const latest = new Map();
  const sorted = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id));
  for (const row of sorted) {
    if (row.duplicate_of != null) continue;
    const fingerprint = [row.tip_id, row.gebruiker, row.actie, row.reden_code || '', row.reden_tekst || '', row.created_at].join('|');
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    if (row.actie === 'heropend') {
      latest.delete(Number(row.tip_id));
      continue;
    }
    latest.set(Number(row.tip_id), row);
  }
  return [...latest.values()];
}

function emptyBreakdown() {
  return { assessed: 0, usable: 0, known: 0, notLocal: 0, tooWeak: 0, duplicate: 0, factualError: 0, irrelevant: 0, unknown: 0 };
}

function addVerdict(target, verdict) {
  target.assessed++;
  if (verdict === 'bruikbaar') target.usable++;
  else if (verdict === 'bekend') target.known++;
  else if (verdict === 'niet_lokaal') target.notLocal++;
  else if (verdict === 'te_zwak') target.tooWeak++;
  else if (verdict === 'duplicaat') target.duplicate++;
  else if (verdict === 'feitelijk_fout') target.factualError++;
  else if (verdict === 'niet_relevant') target.irrelevant++;
  else target.unknown++;
}

function finishBreakdown(value, monthlyCycles = 0) {
  const denominator = value.usable + value.notLocal + value.tooWeak + value.duplicate + value.factualError + value.irrelevant;
  return {
    ...value,
    precision: denominator ? value.usable / denominator : null,
    duplicateRate: denominator ? value.duplicate / denominator : null,
    evidenceLevel: value.assessed < MINIMUMS.reporting ? 'onvoldoende_voor_rapportage'
      : value.assessed < MINIMUMS.manualCalibration ? 'alleen_beschrijvend'
        : value.assessed < MINIMUMS.sourceOrRuleChange || monthlyCycles < MINIMUMS.monthlyCyclesForChange
          ? 'handmatige_kalibratie_mogelijk'
          : 'wijzigingsvoorstel_mogelijk_na_menselijke_goedkeuring',
  };
}

function calculateMetrics({ feedbackRows, contextsByFeedbackId = new Map(), outcomes = [], signalSummary = {}, monthlyCycles = 0 }) {
  const latest = latestFeedbackByTip(feedbackRows);
  const overall = emptyBreakdown();
  const dimensions = {};
  const sources = new Map();
  const rules = new Map();

  for (const row of latest) {
    const classified = row.verdict ? { verdict: row.verdict, dimension: row.dimension || 'onbekend' } : classifyFeedback(row.actie, row.reden_code);
    addVerdict(overall, classified.verdict);
    dimensions[classified.dimension] = (dimensions[classified.dimension] || 0) + 1;
    const context = contextsByFeedbackId.get(Number(row.id)) || {};
    const sourceKeys = new Map();
    const ruleKeys = new Set();
    for (const signal of context.signals || []) {
      if (signal.rule) ruleKeys.add(signal.rule);
      for (const source of signal.sources || []) {
        if (source.role !== 'spiegel') sourceKeys.set(String(source.id ?? source.name), source.name || String(source.id));
      }
    }
    for (const [key, name] of sourceKeys) {
      if (!sources.has(key)) sources.set(key, { key, name, ...emptyBreakdown() });
      addVerdict(sources.get(key), classified.verdict);
    }
    for (const key of ruleKeys) {
      if (!rules.has(key)) rules.set(key, { key, name: key, ...emptyBreakdown() });
      addVerdict(rules.get(key), classified.verdict);
    }
  }

  const uniqueOutcomes = new Map();
  for (const outcome of outcomes) {
    if (outcome.status !== 'published') continue;
    uniqueOutcomes.set(outcome.normalized_url, outcome);
  }
  const published = [...uniqueOutcomes.values()];
  return {
    policyVersion: POLICY_VERSION,
    minimums: MINIMUMS,
    overall: finishBreakdown(overall, monthlyCycles),
    dimensions,
    sources: [...sources.values()].map(v => finishBreakdown(v, monthlyCycles)).sort((a, b) => b.assessed - a.assessed || a.name.localeCompare(b.name)),
    rules: [...rules.values()].map(v => finishBreakdown(v, monthlyCycles)).sort((a, b) => b.assessed - a.assessed || a.name.localeCompare(b.name)),
    outcomes: {
      published: published.length,
      withoutStadsgeest: published.filter(v => Number(v.without_stadsgeest) === 1).length,
      unknown: published.filter(v => ![0, 1].includes(Number(v.without_stadsgeest))).length,
    },
    signals: {
      total: Number(signalSummary.total || 0),
      unused: Number(signalSummary.unused || 0),
      unusedRate: Number(signalSummary.total || 0) ? Number(signalSummary.unused || 0) / Number(signalSummary.total) : null,
    },
  };
}

module.exports = {
  MINIMUMS, POLICY_VERSION, REASON_POLICY, calculateMetrics, canonicalizeArticleUrl,
  classifyFeedback, evidenceHash, latestFeedbackByTip, stableStringify,
};
