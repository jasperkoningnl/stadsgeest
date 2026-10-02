const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { BASELINE_KEY, archiveSnapshot, ensureSource, fetchBuffer, normalizeText, semanticHash } = require('../phase3-core.cjs');

const BASE = 'https://dataderden.cbs.nl/ODataApi/OData/47022NED';
const SOURCE_URL = 'https://data.politie.nl/#/Politie/nl/dataset/47022NED/table';
const VERSION = '2.0.0';
const DETECTOR_VERSION = 'crime-robust-1.0';
const TREND_DETECTOR_VERSION = 'crime-trend-2.0';
const MUNICIPALITIES = ['GM0307', 'GM0327'];
const MUNICIPALITY_NAMES = { GM0307: 'Amersfoort', GM0327: 'Leusden' };
const NATIONAL_CODE = 'NL00';
const TREND_WINDOWS = [3, 12];
const MAX_TREND_EVENTS = 8;
const CRIME_PATTERN = /inbraak|diefstal|geweld|vernieling|brand|ontploffing|wapen|drug|overval|straatroof/i;
const CRIME_CODES = new Set([
  '0.0.0',
  '1.1.1', '1.1.2', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3.1',
  '1.4.3', '1.4.4', '1.4.5', '1.4.6', '1.4.7', '1.6.1', '1.6.2',
  '2.1.1', '2.2.1', '2.5.1', '2.5.2',
  '3.1.1', '3.1.3', '3.5.2', '3.5.5', '3.6.4', '3.7.1', '3.7.4', '3.9.1',
]);
const META = {
  name: 'Politie/CBS — geregistreerde misdrijven per buurt', url: SOURCE_URL, sourceClass: 'MEASUREMENT',
  version: VERSION, frequency: 'weekly', category: 'data', lastVerifiedAt: '2026-10-01', termsCheckedAt: '2026-09-13',
  ownerContact: null, manifest: { owner: 'Politie/CBS', license: 'open data', dataset: '47022NED',
    identity: 'gebiedscode + delictscode + maand', area_version: 'DataProperties.MapYear', intended_frequency: 'maandelijks',
    minimum_count: 5, history_months: 60, backtest_months: 24,
    crime_codes: [...CRIME_CODES], national_reference: 'NL00 uit dezelfde dataset',
    detector: 'buurtanomalie plus wijk/gemeente-trends over 3 en 12 maanden; landelijke seizoenscorrectie en FDR' },
};

function monthNumber(period) { return Number(String(period).replace('MM', '')); }
function previousPeriod(period, months = 1) {
  const n = monthNumber(period); const date = new Date(Date.UTC(Math.floor(n / 100), (n % 100) - 1 - months, 1));
  return `${date.getUTCFullYear()}MM${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function median(values) {
  if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function robustZ(observed, history) {
  const med = median(history); if (med === null) return null;
  const mad = median(history.map(value => Math.abs(value - med)));
  if (!mad) return observed === med ? 0 : (observed > med ? 9 : -9);
  return 0.6745 * (observed - med) / mad;
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

function buildIndex(rows) {
  const index = new Map();
  for (const row of rows) index.set(`${normalizeText(row.WijkenEnBuurten)}|${normalizeText(row.SoortMisdrijf)}|${row.Perioden}`,
    Number(row.GeregistreerdeMisdrijven_1 || 0));
  return index;
}

function buildAssessmentContext(rows) {
  const index = buildIndex(rows); const series = new Map();
  for (const row of rows) {
    const key = `${normalizeText(row.WijkenEnBuurten)}|${normalizeText(row.SoortMisdrijf)}`;
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(row);
  }
  for (const values of series.values()) values.sort((a, b) => a.Perioden.localeCompare(b.Perioden));
  return { index, series };
}

function periodRange(endPeriod, months, offset = 0) {
  return Array.from({ length: months }, (_, index) => previousPeriod(endPeriod, offset + index));
}

function sumPeriods(index, area, crime, periods) {
  return periods.reduce((sum, period) => sum + (index.get(`${area}|${crime}|${period}`) || 0), 0);
}

function districtCode(areaCode) {
  return /^BU\d{8}$/.test(areaCode) ? `WK${areaCode.slice(2, 8)}` : null;
}

function aggregateTrendRows(rows) {
  const directDistricts = new Set(rows.filter(row => normalizeText(row.WijkenEnBuurten).startsWith('WK')).map(row =>
    `${normalizeText(row.WijkenEnBuurten)}|${normalizeText(row.SoortMisdrijf)}|${row.Perioden}`));
  const totals = new Map();
  for (const row of rows) {
    const area = normalizeText(row.WijkenEnBuurten);
    const targets = [];
    if (area.startsWith('BU')) {
      const district = districtCode(area);
      const directKey = `${district}|${normalizeText(row.SoortMisdrijf)}|${row.Perioden}`;
      if (!directDistricts.has(directKey)) targets.push(district);
    }
    if (area.startsWith('WK') || area.startsWith('GM') || area === NATIONAL_CODE) targets.push(area);
    for (const target of targets.filter(Boolean)) {
      const crime = normalizeText(row.SoortMisdrijf);
      const key = `${target}|${crime}|${row.Perioden}`;
      totals.set(key, (totals.get(key) || 0) + Number(row.GeregistreerdeMisdrijven_1 || 0));
    }
  }
  return [...totals.entries()].map(([key, value]) => {
    const [area, crime, period] = key.split('|');
    return { WijkenEnBuurten: area, SoortMisdrijf: crime, Perioden: period, GeregistreerdeMisdrijven_1: value };
  });
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function twoSidedP(zScore) {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(zScore)))));
}

function logGamma(value) {
  const coefficients = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = value; let temporary = value + 5.5;
  temporary -= (value + 0.5) * Math.log(temporary);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) series += coefficient / ++y;
  return -temporary + Math.log(2.5066282746310005 * series / value);
}

function binomialTwoSided(observed, total, probability) {
  if (total <= 0 || probability <= 0 || probability >= 1) return 1;
  const expected = total * probability;
  const variance = total * probability * (1 - probability);
  if (total > 200) return twoSidedP((observed - expected) / Math.sqrt(variance));
  const logProbability = count => logGamma(total + 1) - logGamma(count + 1) - logGamma(total - count + 1) +
    count * Math.log(probability) + (total - count) * Math.log(1 - probability);
  const observedLogProbability = logProbability(observed);
  let result = 0;
  for (let count = 0; count <= total; count++) {
    const value = logProbability(count);
    if (value <= observedLogProbability + 1e-9) result += Math.exp(value);
  }
  return Math.min(1, result);
}

function applyFalseDiscoveryRate(metrics, familySize = metrics.length) {
  const sorted = [...metrics].sort((a, b) => a.pValue - b.pValue);
  let nextQ = 1;
  for (let index = sorted.length - 1; index >= 0; index--) {
    nextQ = Math.min(nextQ, sorted[index].pValue * familySize / (index + 1));
    sorted[index].qValue = Math.min(1, nextQ);
  }
  return metrics;
}

function trendMetric(area, crime, latestPeriod, windowMonths, index, municipality = null) {
  const currentPeriods = periodRange(latestPeriod, windowMonths);
  const yearPeriods = currentPeriods.map(period => previousPeriod(period, 12));
  const previousPeriods = periodRange(latestPeriod, windowMonths, windowMonths);
  const observed = sumPeriods(index, area, crime, currentPeriods);
  const yearAgo = sumPeriods(index, area, crime, yearPeriods);
  const previousWindow = sumPeriods(index, area, crime, previousPeriods);
  const nationalObserved = sumPeriods(index, NATIONAL_CODE, crime, currentPeriods);
  const nationalYearAgo = sumPeriods(index, NATIONAL_CODE, crime, yearPeriods);
  const municipalityObserved = municipality ? sumPeriods(index, municipality, crime, currentPeriods) : null;
  const municipalityYearAgo = municipality ? sumPeriods(index, municipality, crime, yearPeriods) : null;
  if (yearAgo <= 0 || nationalYearAgo <= 0) return null;
  const nationalRatio = nationalObserved / nationalYearAgo;
  const expected = yearAgo * nationalRatio;
  if (expected < 5) return null;
  const difference = observed - expected;
  const ratio = observed / expected;
  const combined = observed + yearAgo;
  const expectedShare = nationalRatio / (1 + nationalRatio);
  const conditionalExpected = combined * expectedShare;
  const conditionalVariance = combined * expectedShare * (1 - expectedShare);
  const zScore = conditionalVariance > 0 ? (observed - conditionalExpected) / Math.sqrt(conditionalVariance) : 0;
  const pValue = binomialTwoSided(observed, combined, expectedShare);
  const direction = difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'stable';
  const minimumAbsolute = windowMonths === 3 ? 8 : 15;
  const minimumRatio = windowMonths === 3 ? 1.35 : 1.25;
  const material = Math.abs(difference) >= minimumAbsolute &&
    (ratio >= minimumRatio || ratio <= 1 / minimumRatio);
  const consecutive = direction === 'increase'
    ? observed - previousWindow >= minimumAbsolute && observed >= Math.max(10, previousWindow * 1.25)
    : previousWindow - observed >= minimumAbsolute && previousWindow >= 10 && observed <= previousWindow * 0.8;
  return { area, crime, latestPeriod, windowMonths, observed, yearAgo, previousWindow, expected, difference, ratio,
    zScore, pValue, qValue: 1, nationalObserved, nationalYearAgo, nationalRatio,
    municipalityObserved, municipalityYearAgo,
    municipalityRatio: municipalityYearAgo > 0 ? municipalityObserved / municipalityYearAgo : null,
    direction, material, consecutive,
    periodFrom: currentPeriods.at(-1), periodTo: currentPeriods[0], comparisonFrom: yearPeriods.at(-1), comparisonTo: yearPeriods[0] };
}

function assessCrimeTrends(rows, areas, latestPeriod) {
  const aggregated = aggregateTrendRows(rows);
  const context = buildAssessmentContext(aggregated);
  const areaCodes = [...new Set(aggregated.map(row => normalizeText(row.WijkenEnBuurten)))]
    .filter(area => area.startsWith('WK') || MUNICIPALITIES.includes(area));
  const crimes = [...new Set(aggregated.map(row => normalizeText(row.SoortMisdrijf)))];
  const metrics = [];
  for (const area of areaCodes) for (const crime of crimes) for (const windowMonths of TREND_WINDOWS) {
    const municipality = areas.get(area)?.municipality || (MUNICIPALITIES.includes(area) ? area : null);
    const metric = trendMetric(area, crime, latestPeriod, windowMonths, context.index, municipality);
    if (metric) metrics.push(metric);
  }
  applyFalseDiscoveryRate(metrics, areaCodes.length * crimes.length * TREND_WINDOWS.length);
  for (const metric of metrics) {
    metric.significant = metric.material && metric.qValue <= 0.05;
    metric.notable = metric.material && !metric.significant && metric.qValue <= (metric.windowMonths === 3 ? 0.15 : 0.1) &&
      (metric.windowMonths === 12 || metric.consecutive);
  }

  const bySeries = new Map();
  for (const metric of metrics.filter(item => item.significant || item.notable)) {
    const key = `${metric.area}|${metric.crime}`;
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key).push(metric);
  }
  const candidates = [];
  for (const series of bySeries.values()) {
    series.sort((a, b) => Number(b.significant) - Number(a.significant) || a.windowMonths - b.windowMonths || Math.abs(b.zScore) - Math.abs(a.zScore));
    const primary = series[0];
    const area = areas.get(primary.area);
    candidates.push({ ...primary, classification: primary.significant ? 'statistically_distinct' : 'notable',
      areaName: area?.name || MUNICIPALITY_NAMES[primary.area] || primary.area,
      municipality: area?.municipality || (MUNICIPALITIES.includes(primary.area) ? primary.area : null),
      windows: Object.fromEntries(series.map(item => [item.windowMonths, item])) });
  }
  return { candidates: candidates.sort((a, b) => Number(b.significant) - Number(a.significant) || Math.abs(b.zScore) - Math.abs(a.zScore)),
    tests: metrics.length, significant: metrics.filter(item => item.significant).length, notable: metrics.filter(item => !item.significant && item.notable).length };
}

function selectTrendCandidates(candidates, maximum = MAX_TREND_EVENTS) {
  const selected = []; const perCrime = new Map(); const perArea = new Map();
  for (const candidate of candidates) {
    if ((perCrime.get(candidate.crime) || 0) >= 2 || (perArea.get(candidate.area) || 0) >= 2) continue;
    selected.push(candidate);
    perCrime.set(candidate.crime, (perCrime.get(candidate.crime) || 0) + 1);
    perArea.set(candidate.area, (perArea.get(candidate.area) || 0) + 1);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function backtestCrimeTrends(rows, areas, months = 24) {
  const periods = [...new Set(rows.map(row => row.Perioden))].sort().slice(-months);
  let evaluated = 0; let candidates = 0; let eligibleCandidates = 0; let significant = 0; let notable = 0;
  for (const period of periods) {
    const result = assessCrimeTrends(rows, areas, period);
    evaluated += result.tests; eligibleCandidates += result.candidates.length;
    candidates += selectTrendCandidates(result.candidates).length;
    significant += result.significant; notable += result.notable;
  }
  return { months: periods.length, from: periods[0], to: periods.at(-1), evaluated, evaluatedPeriods: periods.length,
    candidates, eligibleCandidates, maximumPerPeriod: MAX_TREND_EVENTS, significant, notable, detectorVersion: TREND_DETECTOR_VERSION };
}

function assessCrimePoint(point, rows, areas, context = buildAssessmentContext(rows)) {
  const observed = Number(point.GeregistreerdeMisdrijven_1 || 0);
  if (observed < 5) return { anomaly: false, reason: 'minimum_count', observed };
  const area = normalizeText(point.WijkenEnBuurten), crime = normalizeText(point.SoortMisdrijf), period = point.Perioden;
  const municipality = areas.get(area)?.municipality;
  const index = context.index; const areaSeries = context.series.get(`${area}|${crime}`) || [];
  const month = String(period).slice(-2);
  const calendar = areaSeries.filter(row =>
    String(row.Perioden).endsWith(`MM${month}`) && row.Perioden < period).slice(-5).map(row => Number(row.GeregistreerdeMisdrijven_1 || 0));
  const rolling = areaSeries.filter(row => row.Perioden < period).slice(-12).map(row => Number(row.GeregistreerdeMisdrijven_1 || 0));
  if (calendar.length < 2 || rolling.length < 6) return { anomaly: false, reason: 'insufficient_history', observed };
  const seasonal = mean(calendar), rollingMean = mean(rolling); const expected = (seasonal + rollingMean) / 2;
  const z = robustZ(observed, rolling);
  const prev = index.get(`${area}|${crime}|${previousPeriod(period)}`) || 0;
  const cityNow = index.get(`${municipality}|${crime}|${period}`);
  const cityPrev = index.get(`${municipality}|${crime}|${previousPeriod(period, 12)}`);
  const cityRatio = cityNow !== undefined && cityPrev > 0 ? cityNow / cityPrev : null;
  const threshold = Math.max(2 * expected, expected + 5);
  const magnitude = observed >= threshold && z !== null && z >= 3.5;
  const secondPattern = prev >= Math.max(5, expected * 1.5) || (cityRatio !== null && cityRatio <= 1.25 && observed / expected >= 2);
  return { anomaly: magnitude && secondPattern, reason: magnitude ? (secondPattern ? 'trigger' : 'no_second_pattern') : 'below_threshold',
    observed, expected, seasonal, rollingMean, robustZ: z, previous: prev, municipality, cityNow, cityPrev, cityRatio, threshold };
}

function backtestCrime(rows, areas, months = 24) {
  const periods = [...new Set(rows.map(row => row.Perioden))].sort();
  const testedPeriods = periods.slice(-months); let evaluated = 0, signals = 0, suppressed = 0;
  const byReason = {}; const context = buildAssessmentContext(rows);
  for (const point of rows.filter(row => String(row.WijkenEnBuurten).trim().startsWith('BU') && testedPeriods.includes(row.Perioden))) {
    const result = assessCrimePoint(point, rows, areas, context);
    evaluated++; if (result.anomaly) signals++; else suppressed++;
    byReason[result.reason] = (byReason[result.reason] || 0) + 1;
  }
  return { months: Math.min(months, testedPeriods.length), from: testedPeriods[0], to: testedPeriods.at(-1), evaluated, signals, suppressed,
    signalRate: evaluated ? signals / evaluated : 0, byReason };
}

async function fetchJson(url, fetchImpl) {
  try {
    const fetched = await fetchBuffer(url, { fetchImpl, label: 'Politie/CBS OData', accept: 'application/json', timeoutMs: 90_000 });
    return { fetched, data: JSON.parse(fetched.buffer.toString('utf8')) };
  } catch (error) {
    const endpoint = String(url).match(/47022NED\/([^?]+)/)?.[1] || 'onbekend';
    const crime = decodeURIComponent(String(url).match(/SoortMisdrijf%20eq%20'([^']+)'/)?.[1] || 'dimensie');
    throw new Error(`Politie/CBS ${endpoint} (${crime}) mislukt: ${error.message}`, { cause: error });
  }
}
async function fetchAll(url, fetchImpl, archive) {
  const rows = [];
  let next = url;
  while (next) {
    const { fetched, data } = await fetchJson(next, fetchImpl); rows.push(...(data.value || [])); await archive(fetched);
    next = data['odata.nextLink'] || null;
  }
  return rows;
}

function crimeLabel(title) {
  return String(title || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim();
}

function periodLabel(period) {
  const months = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
  return `${months[Number(String(period).slice(-2)) - 1]} ${String(period).slice(0, 4)}`;
}

function trendDirectionLabel(direction) {
  return direction === 'increase' ? 'stijgt' : 'daalt';
}

class PolitieCbsAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; }
  async run() {
    this.sourceId = await ensureSource(this.db, META, this.dryRun);
    const snapshots = [];
    const archive = async fetched => { const snap = await archiveSnapshot(this.db, this.sourceId, META.name, fetched, this.dryRun); snapshots.push(snap); };
    const [areaResponse, crimeResponse, propertyResponse, periodResponse] = await Promise.all([
      fetchJson(`${BASE}/WijkenEnBuurten?$filter=Municipality%20eq%20'GM0307'%20or%20Municipality%20eq%20'GM0327'&$top=1000`, this.fetchImpl),
      fetchJson(`${BASE}/SoortMisdrijf?$top=1000`, this.fetchImpl), fetchJson(`${BASE}/DataProperties?$top=50`, this.fetchImpl),
      fetchJson(`${BASE}/Perioden?$top=1000`, this.fetchImpl),
    ]);
    for (const item of [areaResponse, crimeResponse, propertyResponse, periodResponse]) await archive(item.fetched);
    const areaRows = areaResponse.data.value || []; const areaMap = new Map(areaRows.map(row => [normalizeText(row.Key),
      { name: row.Title, municipality: normalizeText(row.Municipality), code: normalizeText(row.DetailRegionCode) }]));
    const mapYear = Number((propertyResponse.data.value || []).find(item => item.Key === 'WijkenEnBuurten')?.MapYear);
    if (!mapYear || areaRows.length < 50) throw new Error(`Politie/CBS gebiedsschema verdacht: ${areaRows.length} gebieden, kaartjaar ${mapYear || 'ontbreekt'}`);
    const crimes = (crimeResponse.data.value || []).filter(item => CRIME_CODES.has(normalizeText(item.Key)));
    const missingCrimeCodes = [...CRIME_CODES].filter(code => !crimes.some(item => normalizeText(item.Key) === code));
    if (missingCrimeCodes.length) throw new Error(`Politie/CBS delictdimensie mist codes: ${missingCrimeCodes.join(', ')}`);
    const periods = (periodResponse.data.value || []).map(item => item.Key).filter(key => /^\d{4}MM\d{2}$/.test(key)).sort();
    const from = periods.at(-61) || periods[0];
    const areaFilter = `(startswith(WijkenEnBuurten,'BU0307')%20or%20startswith(WijkenEnBuurten,'BU0327')%20or%20startswith(WijkenEnBuurten,'WK0307')%20or%20startswith(WijkenEnBuurten,'WK0327')%20or%20WijkenEnBuurten%20eq%20'GM0307%20%20%20%20'%20or%20WijkenEnBuurten%20eq%20'GM0327%20%20%20%20'%20or%20WijkenEnBuurten%20eq%20'NL00%20%20%20%20%20%20')`;
    const rows = [];
    for (const crime of crimes) {
      const code = encodeURIComponent(crime.Key);
      const url = `${BASE}/TypedDataSet?$filter=${areaFilter}%20and%20SoortMisdrijf%20eq%20'${code}'%20and%20Perioden%20ge%20'${from}'&$top=5000`;
      rows.push(...await fetchAll(url, this.fetchImpl, archive));
    }
    if (rows.length < 1000) throw new Error(`Politie/CBS datavolume verdacht klein: ${rows.length}`);
    const latestPeriod = [...new Set(rows.map(row => row.Perioden))].sort().at(-1);
    const assessmentContext = buildAssessmentContext(rows);
    const anomalies = rows.filter(row => row.Perioden === latestPeriod && normalizeText(row.WijkenEnBuurten).startsWith('BU') &&
      normalizeText(row.SoortMisdrijf) !== '0.0.0')
      .map(point => ({ point, assessment: assessCrimePoint(point, rows, areaMap, assessmentContext) })).filter(item => item.assessment.anomaly);
    const trendAssessment = assessCrimeTrends(rows, areaMap, latestPeriod);
    const trendCandidates = selectTrendCandidates(trendAssessment.candidates);
    const latestHashes = new Map(); let baselineComplete = false;
    const recordFrom = previousPeriod(latestPeriod, 24);
    if (this.sourceId > 0) {
      const result = await this.db.execute({ sql: `SELECT source_key,semantic_hash FROM source_records
        WHERE source_id=? AND source_key LIKE 'politie:%' AND substr(source_key,-8)>=? ORDER BY id`, args: [this.sourceId, recordFrom] });
      for (const row of result.rows) latestHashes.set(row.source_key, row.semantic_hash);
      const marker = await this.db.execute({ sql: 'SELECT id FROM source_records WHERE source_id=? AND source_key=? LIMIT 1', args: [this.sourceId, BASELINE_KEY] });
      baselineComplete = marker.rows.length > 0;
    }
    const baseline = !baselineComplete; let revisions = 0, events = 0;
    if (!this.dryRun) {
      const statements = [];
      for (const row of rows.filter(item => item.Perioden >= recordFrom)) {
        const area = normalizeText(row.WijkenEnBuurten), crime = normalizeText(row.SoortMisdrijf);
        const key = `politie:${area}:${crime}:${row.Perioden}`; const normalized = { ...row, WijkenEnBuurten: area, SoortMisdrijf: crime, mapYear };
        const hash = semanticHash(normalized); if (latestHashes.get(key) === hash) continue; if (latestHashes.has(key)) revisions++;
        statements.push({ sql: `INSERT OR IGNORE INTO source_records(source_id,source_key,raw_object,content_hash,semantic_hash,change_type)
          VALUES (?,?,?,?,?,?)`, args: [this.sourceId, key, JSON.stringify(normalized), semanticHash({ key, hash }), hash, latestHashes.has(key) ? 'corrected' : 'added'] });
      }
      for (let index = 0; index < statements.length; index += 200) await this.db.batch(statements.slice(index, index + 200), 'write');
      if (baseline) {
        const marker = { completedAt: new Date().toISOString(), latestPeriod, mapYear, records: rows.length };
        const hash = semanticHash(marker);
        await this.db.execute({ sql: `INSERT OR IGNORE INTO source_records(source_id,source_key,raw_object,content_hash,semantic_hash,change_type)
          VALUES (?,?,?,?,?,'added')`, args: [this.sourceId, BASELINE_KEY, JSON.stringify(marker), hash, hash] });
      }
      for (const area of areaRows) await this.db.execute({ sql: `INSERT OR IGNORE INTO area_versions(source_id,area_code,area_name,municipality_code,map_year,valid_from,source_url)
        VALUES (?,?,?,?,?,?,?)`, args: [this.sourceId, normalizeText(area.Key), area.Title, normalizeText(area.Municipality), mapYear, `${mapYear}-01-01`, SOURCE_URL] });
      if (!baseline) for (const { point, assessment } of anomalies) {
        const area = areaMap.get(normalizeText(point.WijkenEnBuurten)); const crime = crimes.find(item => normalizeText(item.Key) === normalizeText(point.SoortMisdrijf));
        const identifier = `politie-anomaly:${normalizeText(point.WijkenEnBuurten)}:${normalizeText(point.SoortMisdrijf)}:${point.Perioden}:${DETECTOR_VERSION}`;
        const exists = await this.db.execute({ sql: 'SELECT id FROM kg_events WHERE source_id=? AND source_identifier=?', args: [this.sourceId, identifier] });
        if (exists.rows.length) continue;
        const provenance = { source_name: META.name, source_class: META.sourceClass, source_url: SOURCE_URL, source_identifier: identifier,
          fetched_at: new Date().toISOString(), adapter_version: VERSION, raw_object_hashes: snapshots.map(item => item.hash), map_year: mapYear,
          area_code: normalizeText(point.WijkenEnBuurten), area_name: area?.name, municipality_code: assessment.municipality,
          crime_code: normalizeText(point.SoortMisdrijf), crime_name: crime?.Title, period: point.Perioden, ...assessment,
          warning: 'Geregistreerde misdrijven; registratie-effecten en kleine aantallen kunnen het beeld beïnvloeden.' };
        await this.db.execute({ sql: `INSERT INTO kg_events(event_type,title,summary,occurred_at,published_at,fetched_at,source_id,source_url,
          source_identifier,raw_object_hash,parser_version,detection_rule,provenance) VALUES ('CRIME_ANOMALY_DETECTED',?,?,?, ?,datetime('now'),?,?,?,?,?,'R5',?)`,
          args: [`Opvallende stijging ${crime?.Title || point.SoortMisdrijf} in ${area?.name || point.WijkenEnBuurten}`,
            `${assessment.observed} geregistreerde misdrijven; verwachting ${assessment.expected.toFixed(1)}, robuuste z-score ${assessment.robustZ.toFixed(1)}.`,
            `${point.Perioden.slice(0,4)}-${point.Perioden.slice(-2)}-01T00:00:00.000Z`, `${point.Perioden.slice(0,4)}-${point.Perioden.slice(-2)}-01T00:00:00.000Z`,
            this.sourceId, SOURCE_URL, identifier, snapshots.at(-1)?.hash || semanticHash(rows), VERSION, JSON.stringify(provenance)] });
        events++;
        await this.db.execute({ sql: `INSERT OR REPLACE INTO statistical_baselines(source_id,series_key,period,observed,expected,robust_z,municipality_expected,detector_version,explanation)
          VALUES (?,?,?,?,?,?,?,?,?)`, args: [this.sourceId, `${normalizeText(point.WijkenEnBuurten)}:${normalizeText(point.SoortMisdrijf)}`, point.Perioden,
          assessment.observed, assessment.expected, assessment.robustZ, assessment.cityNow, DETECTOR_VERSION, JSON.stringify(assessment)] });
      }
      if (!baseline) for (const assessment of trendCandidates) {
        const crime = crimes.find(item => normalizeText(item.Key) === assessment.crime);
        const label = crimeLabel(crime?.Title || assessment.crime);
        const identifier = `politie-trend:${assessment.area}:${assessment.crime}:${latestPeriod}:${TREND_DETECTOR_VERSION}`;
        const exists = await this.db.execute({ sql: 'SELECT id FROM kg_events WHERE source_id=? AND source_identifier=?', args: [this.sourceId, identifier] });
        if (exists.rows.length) continue;
        const percentage = Math.round((assessment.ratio - 1) * 100);
        const nationalPercentage = Math.round((assessment.nationalRatio - 1) * 100);
        const municipalityPercentage = assessment.municipalityRatio === null ? null : Math.round((assessment.municipalityRatio - 1) * 100);
        const provenance = { source_name: META.name, source_class: META.sourceClass, source_url: SOURCE_URL,
          source_identifier: identifier, fetched_at: new Date().toISOString(), adapter_version: VERSION,
          detector_version: TREND_DETECTOR_VERSION, raw_object_hashes: snapshots.map(item => item.hash), map_year: mapYear,
          reason: 'trend_trigger', area_code: assessment.area, area_name: assessment.areaName,
          municipality_code: assessment.municipality, area_level: assessment.area.startsWith('WK') ? 'wijk' : 'gemeente',
          crime_code: assessment.crime, crime_name: crime?.Title, period: latestPeriod,
          direction: assessment.direction, classification: assessment.classification, window_months: assessment.windowMonths,
          observed: assessment.observed, year_ago: assessment.yearAgo, previous_window: assessment.previousWindow,
          expected: assessment.expected, difference: assessment.difference, ratio: assessment.ratio,
          z_score: assessment.zScore, p_value: assessment.pValue, q_value: assessment.qValue,
          national_observed: assessment.nationalObserved, national_year_ago: assessment.nationalYearAgo,
          national_ratio: assessment.nationalRatio, period_from: assessment.periodFrom, period_to: assessment.periodTo,
          municipality_observed: assessment.municipalityObserved, municipality_year_ago: assessment.municipalityYearAgo,
          municipality_ratio: assessment.municipalityRatio,
          comparison_from: assessment.comparisonFrom, comparison_to: assessment.comparisonTo,
          warning: 'Geregistreerde misdrijven; aangiftebereidheid, registratie-effecten, gebiedswijzigingen en kleine aantallen kunnen het beeld beïnvloeden.' };
        const summary = `${assessment.observed} registraties in ${periodLabel(assessment.periodFrom)}–${periodLabel(assessment.periodTo)}, ` +
          `tegen ${assessment.yearAgo} in dezelfde periode een jaar eerder (${percentage >= 0 ? '+' : ''}${percentage}% na landelijke correctie; ` +
          `landelijk ${nationalPercentage >= 0 ? '+' : ''}${nationalPercentage}%` +
          `${municipalityPercentage === null || assessment.area.startsWith('GM') ? '' : `; gemeente ${municipalityPercentage >= 0 ? '+' : ''}${municipalityPercentage}%`}).`;
        await this.db.execute({ sql: `INSERT INTO kg_events(event_type,title,summary,occurred_at,published_at,fetched_at,source_id,source_url,
          source_identifier,raw_object_hash,parser_version,detection_rule,provenance) VALUES ('CRIME_TREND_DETECTED',?,?,?, ?,datetime('now'),?,?,?,?,?,'R5',?)`,
          args: [`${label} ${trendDirectionLabel(assessment.direction)} in ${assessment.areaName}`, summary,
            `${latestPeriod.slice(0,4)}-${latestPeriod.slice(-2)}-01T00:00:00.000Z`, `${latestPeriod.slice(0,4)}-${latestPeriod.slice(-2)}-01T00:00:00.000Z`,
            this.sourceId, SOURCE_URL, identifier, snapshots.at(-1)?.hash || semanticHash(rows), VERSION, JSON.stringify(provenance)] });
        events++;
        await this.db.execute({ sql: `INSERT OR REPLACE INTO statistical_baselines(source_id,series_key,period,observed,expected,robust_z,municipality_expected,detector_version,explanation)
          VALUES (?,?,?,?,?,?,?,?,?)`, args: [this.sourceId, `trend${assessment.windowMonths}:${assessment.area}:${assessment.crime}`, latestPeriod,
          assessment.observed, assessment.expected, assessment.zScore, null, TREND_DETECTOR_VERSION, JSON.stringify(provenance)] });
      }
    }
    const backtest = backtestCrime(rows, areaMap, 24);
    const trendBacktest = backtestCrimeTrends(rows, areaMap, 24);
    if (backtest.months < 24) throw new Error(`Politie-backtest te kort: ${backtest.months} maanden`);
    if (trendBacktest.months < 24) throw new Error(`Politie-trendbacktest te kort: ${trendBacktest.months} maanden`);
    if (!this.dryRun) await this.db.execute({ sql: `INSERT INTO phase3_backtests(test_name,period_from,period_to,months,detector_version,input_count,signal_count,suppressed_count,metrics_json)
      VALUES ('politie-r5',?,?,?,?,?,?,?,?)`, args: [backtest.from, backtest.to, backtest.months, DETECTOR_VERSION, backtest.evaluated, backtest.signals, backtest.suppressed, JSON.stringify(backtest)] });
    if (!this.dryRun) await this.db.execute({ sql: `INSERT INTO phase3_backtests(test_name,period_from,period_to,months,detector_version,input_count,signal_count,suppressed_count,metrics_json)
      VALUES ('politie-r5-trends',?,?,?,?,?,?,?,?)`, args: [trendBacktest.from, trendBacktest.to, trendBacktest.months, TREND_DETECTOR_VERSION,
      trendBacktest.evaluated, trendBacktest.candidates, trendBacktest.evaluated - trendBacktest.candidates, JSON.stringify(trendBacktest)] });
    return { sourceId: this.sourceId, baseline, total: rows.length, latestPeriod, mapYear, areas: areaRows.length, crimes: crimes.length,
      anomalies: baseline ? 0 : anomalies.length, trendCandidates: baseline ? 0 : trendCandidates.length,
      trendTests: trendAssessment.tests, trendSignificant: trendAssessment.significant, trendNotable: trendAssessment.notable,
      trendPreview: trendCandidates.map(item => ({ area: item.areaName, crime: item.crime, windowMonths: item.windowMonths,
        direction: item.direction, classification: item.classification, observed: item.observed, yearAgo: item.yearAgo,
        expected: Number(item.expected.toFixed(1)), qValue: Number(item.qValue.toFixed(4)) })),
      events, revisions, backtest, trendBacktest };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: `CBS 47022NED, detectoren ${DETECTOR_VERSION}/${TREND_DETECTOR_VERSION}` }; }
}

module.exports = { BASE, CRIME_CODES, CRIME_PATTERN, DETECTOR_VERSION, TREND_DETECTOR_VERSION, META, PolitieCbsAdapter,
  aggregateTrendRows, applyFalseDiscoveryRate, assessCrimePoint, assessCrimeTrends, backtestCrime, backtestCrimeTrends, binomialTwoSided,
  buildAssessmentContext, districtCode, median, periodRange, previousPeriod, robustZ, selectTrendCandidates, trendMetric };
