const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { BASELINE_KEY, archiveSnapshot, ensureSource, fetchBuffer, normalizeText, semanticHash } = require('../phase3-core.cjs');

const BASE = 'https://dataderden.cbs.nl/ODataApi/OData/47022NED';
const SOURCE_URL = 'https://data.politie.nl/#/Politie/nl/dataset/47022NED/table';
const VERSION = '1.0.0';
const DETECTOR_VERSION = 'crime-robust-1.0';
const MUNICIPALITIES = ['GM0307', 'GM0327'];
const CRIME_PATTERN = /inbraak|diefstal|geweld|vernieling|brandstichting|wapen|drug|overval|straatroof/i;
const META = {
  name: 'Politie/CBS — geregistreerde misdrijven per buurt', url: SOURCE_URL, sourceClass: 'MEASUREMENT',
  version: VERSION, frequency: 'weekly', category: 'data', lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13',
  ownerContact: null, manifest: { owner: 'Politie/CBS', license: 'open data', dataset: '47022NED',
    identity: 'gebiedscode + delictscode + maand', area_version: 'DataProperties.MapYear', intended_frequency: 'maandelijks',
    minimum_count: 5, history_months: 60, backtest_months: 24,
    detector: 'kalendermaand + rolling-12 + gemeentetrend + median/MAD; tweede patroon vereist' },
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
  const fetched = await fetchBuffer(url, { fetchImpl, label: 'Politie/CBS OData', accept: 'application/json', timeoutMs: 90_000 });
  return { fetched, data: JSON.parse(fetched.buffer.toString('utf8')) };
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
    const crimes = (crimeResponse.data.value || []).filter(item => CRIME_PATTERN.test(item.Title) && normalizeText(item.Key) !== '0.0.0').slice(0, 16);
    if (crimes.length < 5) throw new Error(`Politie/CBS delictdimensie verdacht: ${crimes.length} geselecteerd`);
    const periods = (periodResponse.data.value || []).map(item => item.Key).filter(key => /^\d{4}MM\d{2}$/.test(key)).sort();
    const from = periods.at(-61) || periods[0];
    const areaFilter = `(startswith(WijkenEnBuurten,'BU0307')%20or%20startswith(WijkenEnBuurten,'BU0327')%20or%20WijkenEnBuurten%20eq%20'GM0307%20%20%20%20'%20or%20WijkenEnBuurten%20eq%20'GM0327%20%20%20%20')`;
    const rows = [];
    for (const crime of crimes) {
      const code = encodeURIComponent(crime.Key);
      const url = `${BASE}/TypedDataSet?$filter=${areaFilter}%20and%20SoortMisdrijf%20eq%20'${code}'%20and%20Perioden%20ge%20'${from}'&$top=10000`;
      rows.push(...await fetchAll(url, this.fetchImpl, archive));
    }
    if (rows.length < 1000) throw new Error(`Politie/CBS datavolume verdacht klein: ${rows.length}`);
    const latestPeriod = [...new Set(rows.map(row => row.Perioden))].sort().at(-1);
    const assessmentContext = buildAssessmentContext(rows);
    const anomalies = rows.filter(row => row.Perioden === latestPeriod && normalizeText(row.WijkenEnBuurten).startsWith('BU'))
      .map(point => ({ point, assessment: assessCrimePoint(point, rows, areaMap, assessmentContext) })).filter(item => item.assessment.anomaly);
    const latestHashes = new Map(); let baselineComplete = false;
    if (this.sourceId > 0) {
      const result = await this.db.execute({ sql: `SELECT source_key,semantic_hash FROM source_records WHERE source_id=? AND source_key LIKE 'politie:%'`, args: [this.sourceId] });
      for (const row of result.rows) latestHashes.set(row.source_key, row.semantic_hash);
      const marker = await this.db.execute({ sql: 'SELECT id FROM source_records WHERE source_id=? AND source_key=? LIMIT 1', args: [this.sourceId, BASELINE_KEY] });
      baselineComplete = marker.rows.length > 0;
    }
    const baseline = !baselineComplete; let revisions = 0, events = 0;
    if (!this.dryRun) {
      const statements = [];
      for (const row of rows.filter(item => item.Perioden >= previousPeriod(latestPeriod, 24))) {
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
    }
    const backtest = backtestCrime(rows, areaMap, 24);
    if (backtest.months < 24) throw new Error(`Politie-backtest te kort: ${backtest.months} maanden`);
    if (!this.dryRun) await this.db.execute({ sql: `INSERT INTO phase3_backtests(test_name,period_from,period_to,months,detector_version,input_count,signal_count,suppressed_count,metrics_json)
      VALUES ('politie-r5',?,?,?,?,?,?,?,?)`, args: [backtest.from, backtest.to, backtest.months, DETECTOR_VERSION, backtest.evaluated, backtest.signals, backtest.suppressed, JSON.stringify(backtest)] });
    return { sourceId: this.sourceId, baseline, total: rows.length, latestPeriod, mapYear, areas: areaRows.length, crimes: crimes.length,
      anomalies: baseline ? 0 : anomalies.length, events, revisions, backtest };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: `CBS 47022NED, detector ${DETECTOR_VERSION}` }; }
}

module.exports = { BASE, CRIME_PATTERN, DETECTOR_VERSION, META, PolitieCbsAdapter, assessCrimePoint, backtestCrime, buildAssessmentContext, median, previousPeriod, robustZ };
