// Adapter: DUO Open Onderwijsdata — prognoses BO en SBO per vestiging.
//
// De prognosebron bevat geen naam of plaats. Daarom wordt iedere rij eerst via
// de actuele, officiële DUO-vestigingsregistratie aan Amersfoort of Leusden
// gekoppeld. De eerste geldige run is uitsluitend een nulmeting.

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const {
  DATASETS: SCHOOL_DATASETS,
  isLocalRecord,
  normalizeDuoRecord,
  validateResponse: validateAddressResponse,
} = require('./duo-schoolvestigingen.cjs');

const SOURCE_NAME = 'DUO — prognoses BO en SBO per vestiging';
const DATASET_PAGE_URL = 'https://onderwijsdata.duo.nl/datasets/wpoprognoses';
const METADATA_URL = 'https://onderwijsdata.duo.nl/api/3/action/package_show?id=wpoprognoses';
const API_URL = 'https://onderwijsdata.duo.nl/api/3/action/datastore_search';
const LOCAL_CITIES = new Set(['AMERSFOORT', 'LEUSDEN']);
const BASELINE_KEY = 'duo-prognoses:baseline';
const PARSER_VERSION = '1.0';
const REQUIRED_FIELDS = ['INSTELLINGSCODE', 'VESTIGINGSCODE', 'TYPE_PO', 'JAAR', 'PROGNOSEAANTALLEN'];
const MIN_NATIONAL_ROWS = 100_000;
const MIN_LOCAL_SCHOOLS = 40;
const MIN_YEARS_PER_SCHOOL = 10;
const TREND_HORIZON_YEARS = 4;

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

function parseCommaCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value.trim());
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, '').trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('DUO prognose-CSV eindigt midden in een geciteerd veld');
  if (value || row.length > 0) {
    row.push(value.replace(/\r$/, '').trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }
  if (rows.length < 2) throw new Error('DUO prognose-CSV bevat geen records');
  const headers = rows[0];
  const missing = REQUIRED_FIELDS.filter(field => !headers.includes(field));
  if (missing.length > 0) throw new Error(`DUO prognoseschema gewijzigd; ontbrekende velden: ${missing.join(', ')}`);
  return rows.slice(1).map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
}

function selectForecastResource(payload, minimumRows = MIN_NATIONAL_ROWS) {
  if (!payload?.success || !payload.result || !Array.isArray(payload.result.resources)) {
    throw new Error('DUO prognosemetadata is geen geldige CKAN package-response');
  }
  const candidates = payload.result.resources
    .filter(resource => resource.state === 'active' && String(resource.format).toUpperCase() === 'CSV' && resource.url)
    .sort((a, b) => String(b.last_modified || '').localeCompare(String(a.last_modified || '')));
  if (candidates.length === 0) throw new Error('DUO prognosemetadata bevat geen actieve CSV-resource');
  const resource = candidates[0];
  if (Number(resource.total_record_count || 0) < minimumRows) {
    throw new Error(`DUO prognosebestand verdacht klein volgens metadata: ${resource.total_record_count || 0} records`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(resource.last_modified || ''))) {
    throw new Error('DUO prognosemetadata mist een geldige wijzigingsdatum');
  }
  return {
    id: resource.id,
    url: resource.url,
    lastModified: resource.last_modified,
    version: String(resource.last_modified).slice(0, 10),
    totalRecords: Number(resource.total_record_count),
  };
}

function fullVestigingscode(row) {
  const instelling = String(row.INSTELLINGSCODE || '').trim().toUpperCase();
  const vestiging = String(row.VESTIGINGSCODE || '').trim().toUpperCase();
  if (!instelling || !vestiging) return '';
  return vestiging.startsWith(instelling) ? vestiging : `${instelling}${vestiging.padStart(2, '0')}`;
}

function roundPrediction(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function hashForecast(record) {
  const semantic = {
    sourceKey: record.sourceKey,
    type: record.type,
    forecasts: record.forecasts,
  };
  return crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}

function normalizeForecastRows(rows, schoolsByCode, resource) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('DUO prognosebestand bevat geen records');
  const fields = new Set(Object.keys(rows[0]));
  const missing = REQUIRED_FIELDS.filter(field => !fields.has(field));
  if (missing.length > 0) throw new Error(`DUO prognoseschema gewijzigd; ontbrekende velden: ${missing.join(', ')}`);

  const grouped = new Map();
  for (const row of rows) {
    const code = fullVestigingscode(row);
    const school = schoolsByCode.get(code);
    if (!school) continue;
    const year = Number(row.JAAR);
    const pupils = roundPrediction(row.PROGNOSEAANTALLEN);
    const type = String(row.TYPE_PO || '').trim().toUpperCase();
    if (!['BO', 'SBO'].includes(type) || !Number.isInteger(year) || pupils === null) continue;
    const key = `${type}:${code}`;
    if (!grouped.has(key)) grouped.set(key, { school, type, forecasts: new Map() });
    grouped.get(key).forecasts.set(year, pupils);
  }

  const records = [];
  for (const { school, type, forecasts } of grouped.values()) {
    const series = [...forecasts].sort((a, b) => a[0] - b[0]).map(([year, pupils]) => ({ year, pupils }));
    if (series.length < MIN_YEARS_PER_SCHOOL) {
      throw new Error(`DUO prognosereeks voor ${school.vestigingscode} is te kort: ${series.length} jaren`);
    }
    const record = {
      sourceKey: `duo-prognose:${type.toLowerCase()}:${school.vestigingscode}`,
      type: type.toLowerCase(),
      instellingCode: school.instellingCode,
      vestigingscode: school.vestigingscode,
      naam: school.naam,
      gemeente: school.gemeente,
      plaats: school.plaats,
      forecastVersion: resource.version,
      resourceLastModified: resource.lastModified,
      firstYear: series[0].year,
      lastYear: series.at(-1).year,
      forecasts: series,
      sourceUrl: resource.url,
      sourcePageUrl: DATASET_PAGE_URL,
    };
    record.contentHash = hashForecast(record);
    records.push(record);
  }
  return records.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

function significantDifference(from, to) {
  const absoluteChange = to - from;
  const absolute = Math.abs(absoluteChange);
  const relativeChange = from > 0 ? absoluteChange / from : null;
  const relative = Math.abs(relativeChange ?? 0);
  let thresholdBand = null;
  if (absolute >= 50) thresholdBand = 'minstens 50 leerlingen';
  else if (absolute >= 30 && relative >= 0.10) thresholdBand = 'minstens 30 leerlingen en 10 procent';
  else if (from > 0 && from < 100 && absolute >= 20 && relative >= 0.25) {
    thresholdBand = 'kleine vestiging: minstens 20 leerlingen en 25 procent';
  }
  if (!thresholdBand) return null;
  return {
    from,
    to,
    absoluteChange: Math.round(absoluteChange * 100) / 100,
    relativeChange,
    relativeChangePercent: Math.round(relativeChange * 1_000) / 10,
    thresholdBand,
  };
}

function assessForecastTrend(record, horizonYears = TREND_HORIZON_YEARS) {
  const first = record?.forecasts?.[0];
  if (!first) return null;
  const target = record.forecasts.find(item => item.year === first.year + horizonYears);
  if (!target) return null;
  const difference = significantDifference(first.pupils, target.pupils);
  if (!difference) return null;
  return {
    ...difference,
    kind: 'trend',
    type: difference.absoluteChange > 0 ? 'SCHOOL_FORECAST_GROWTH' : 'SCHOOL_FORECAST_DECLINE',
    fromYear: first.year,
    targetYear: target.year,
  };
}

function assessForecastRevision(previous, current) {
  if (!previous?.forecasts || !current?.forecasts) return null;
  const previousByYear = new Map(previous.forecasts.map(item => [item.year, item.pupils]));
  const candidates = current.forecasts.slice(0, 5)
    .filter(item => previousByYear.has(item.year))
    .map(item => ({ year: item.year, ...significantDifference(previousByYear.get(item.year), item.pupils) }))
    .filter(item => item.thresholdBand)
    .sort((a, b) => Math.abs(b.absoluteChange) - Math.abs(a.absoluteChange));
  if (candidates.length === 0) return null;
  const selected = candidates[0];
  return {
    ...selected,
    kind: 'revision',
    type: selected.absoluteChange > 0 ? 'SCHOOL_FORECAST_REVISED_UP' : 'SCHOOL_FORECAST_REVISED_DOWN',
    targetYear: selected.year,
  };
}

function assessForecastRealization(forecast, actual) {
  const actualYear = Number(actual?.peiljaar);
  const actualPupils = Number(actual?.aantalLeerlingen);
  const predicted = forecast?.forecasts?.find(item => item.year === actualYear)?.pupils;
  if (!Number.isInteger(actualYear) || !Number.isInteger(actualPupils) || actualPupils <= 0 || predicted === undefined) return null;
  const difference = significantDifference(predicted, actualPupils);
  if (!difference) return null;
  return {
    ...difference,
    kind: 'realization',
    type: difference.absoluteChange > 0 ? 'SCHOOL_FORECAST_OVERSHOOT' : 'SCHOOL_FORECAST_UNDERSHOOT',
    targetYear: actualYear,
    actual,
  };
}

class DuoPrognosesAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.fetchImpl = config.fetchImpl || fetch;
    this.minimumNationalRows = config.minimumNationalRows ?? MIN_NATIONAL_ROWS;
    this.minimumLocalSchools = config.minimumLocalSchools ?? MIN_LOCAL_SCHOOLS;
    this.actualRecords = config.actualRecords || null;
    this.sourceId = null;
    this.lastSourceInfo = null;
  }

  async _ensureSource() {
    const existing = await this.db.execute({ sql: 'SELECT id FROM sources WHERE name=?', args: [SOURCE_NAME] });
    if (existing.rows.length > 0) {
      this.sourceId = Number(existing.rows[0].id);
      return;
    }
    if (this.dryRun) {
      this.sourceId = -1;
      return;
    }
    const inserted = await this.db.execute({
      sql: `INSERT INTO sources
            (name, url, source_type, reliability, category, scrape_frequency,
             is_active, created_at, source_class, adapter_version)
            VALUES (?, ?, 'api', 'primary', 'data', 'weekly',
                    1, datetime('now'), 'MEASUREMENT', ?)`,
      args: [SOURCE_NAME, DATASET_PAGE_URL, PARSER_VERSION],
    });
    this.sourceId = Number(inserted.lastInsertRowid);
  }

  async _fetchJson(url, label) {
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`DUO ${label} ophalen mislukt: HTTP ${response.status}`);
    return response.json();
  }

  async _fetchText(url, label) {
    const response = await this.fetchImpl(url, {
      headers: { Accept: 'text/csv', 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`DUO ${label} ophalen mislukt: HTTP ${response.status}`);
    return response.text();
  }

  async _fetchLocalSchools() {
    const schools = new Map();
    for (const city of LOCAL_CITIES) {
      const params = new URLSearchParams({
        resource_id: SCHOOL_DATASETS[0].resourceId,
        limit: '100',
        filters: JSON.stringify({ GEMEENTENAAM: city }),
      });
      const result = validateAddressResponse(await this._fetchJson(`${API_URL}?${params}`, `BO-vestigingen ${city}`));
      for (const row of result.records.filter(isLocalRecord)) {
        const record = normalizeDuoRecord(row, SCHOOL_DATASETS[0]);
        schools.set(record.vestigingscode, record);
      }
    }
    if (schools.size < this.minimumLocalSchools) {
      throw new Error(`DUO lokale BO/SBO-selectie verdacht klein: ${schools.size} vestigingen`);
    }
    return schools;
  }

  async _fetchRecords() {
    const resource = selectForecastResource(
      await this._fetchJson(METADATA_URL, 'prognosemetadata'),
      this.minimumNationalRows,
    );
    const [schools, csv] = await Promise.all([
      this._fetchLocalSchools(),
      this._fetchText(resource.url, 'prognosebestand'),
    ]);
    const rows = parseCommaCsv(csv);
    if (rows.length < this.minimumNationalRows) throw new Error(`DUO prognosebestand verdacht klein: ${rows.length} records`);
    const records = normalizeForecastRows(rows, schools, resource);
    if (records.length < this.minimumLocalSchools) {
      throw new Error(`DUO lokale prognoseselectie verdacht klein: ${records.length} vestigingen`);
    }
    this.lastSourceInfo = {
      version: resource.version,
      lastModified: resource.lastModified,
      resourceId: resource.id,
      url: resource.url,
      nationalRows: rows.length,
      localSchools: records.length,
      firstYear: Math.min(...records.map(record => record.firstYear)),
      lastYear: Math.max(...records.map(record => record.lastYear)),
    };
    return records;
  }

  async _loadState() {
    if (this.sourceId < 0) return { records: new Map(), baselineComplete: false };
    const result = await this.db.execute({
      sql: `SELECT sr.id, sr.source_key, sr.raw_object, sr.content_hash,
                   sr.semantic_hash, sr.change_type
            FROM source_records sr
            JOIN (
              SELECT source_key, MAX(id) AS latest_id
              FROM source_records WHERE source_id=? GROUP BY source_key
            ) latest ON latest.latest_id=sr.id`,
      args: [this.sourceId],
    });
    const records = new Map();
    let baselineComplete = false;
    for (const row of result.rows) {
      if (row.source_key === BASELINE_KEY) {
        baselineComplete = true;
        continue;
      }
      records.set(row.source_key, {
        id: Number(row.id),
        record: JSON.parse(row.raw_object || '{}'),
        contentHash: row.semantic_hash || row.content_hash,
        changeType: row.change_type,
      });
    }
    return { records, baselineComplete };
  }

  async _loadActuals() {
    if (this.actualRecords) return new Map(this.actualRecords.map(record => [record.vestigingscode, record]));
    if (this.sourceId < 0) return new Map();
    const result = await this.db.execute({
      sql: `SELECT sr.raw_object
            FROM source_records sr
            JOIN sources s ON s.id=sr.source_id
            JOIN (
              SELECT sr2.source_id, sr2.source_key, MAX(sr2.id) AS latest_id
              FROM source_records sr2
              JOIN sources s2 ON s2.id=sr2.source_id
              WHERE s2.name='DUO — leerlingaantallen BO en VO per vestiging'
                AND sr2.source_key LIKE 'duo-leerlingen:bo:%'
              GROUP BY sr2.source_id, sr2.source_key
            ) latest ON latest.latest_id=sr.id
            WHERE sr.change_type!='removed'`,
    });
    const actuals = new Map();
    for (const row of result.rows) {
      const record = JSON.parse(row.raw_object || '{}');
      if (record.vestigingscode) actuals.set(record.vestigingscode, record);
    }
    return actuals;
  }

  async _saveRecord(record, changeType, previousId = null) {
    if (this.dryRun) return;
    const storageHash = crypto.createHash('sha256')
      .update(`${record.contentHash}:${changeType}:${previousId || 0}`)
      .digest('hex');
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, previous_id, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [this.sourceId, record.sourceKey, JSON.stringify(record), storageHash,
        record.contentHash, previousId, changeType],
    });
  }

  async _markBaselineComplete(records) {
    if (this.dryRun) return;
    const payload = {
      completedAt: new Date().toISOString(),
      sourceVersion: this.lastSourceInfo.version,
      records: records.length,
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, change_type)
            VALUES (?, ?, ?, ?, ?, 'added')`,
      args: [this.sourceId, BASELINE_KEY, JSON.stringify(payload), hash, hash],
    });
  }

  async _ensureEntity(record) {
    if (this.dryRun) return null;
    const schoolIdentifier = `${SCHOOL_DATASETS[0].pageUrl}#bo:${record.vestigingscode}`;
    const forecastIdentifier = `${DATASET_PAGE_URL}#${record.type}:${record.vestigingscode}`;
    const found = await this.db.execute({
      sql: `SELECT entity_id FROM entity_identifiers
            WHERE identifier_type='website' AND value IN (?, ?) LIMIT 1`,
      args: [schoolIdentifier, forecastIdentifier],
    });
    let entityId;
    if (found.rows.length > 0) {
      entityId = Number(found.rows[0].entity_id);
    } else {
      const inserted = await this.db.execute({
        sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
              VALUES ('organization', ?, ?)`,
        args: [record.naam, String(record.naam).trim().toLowerCase().replace(/\s+/g, ' ')],
      });
      entityId = Number(inserted.lastInsertRowid);
    }
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO entity_identifiers
            (entity_id, identifier_type, value, source_url, verified_at)
            VALUES (?, 'website', ?, ?, datetime('now'))`,
      args: [entityId, forecastIdentifier, DATASET_PAGE_URL],
    });
    return entityId;
  }

  async _emitEvent(change, record, previous, entityId) {
    if (this.dryRun) return false;
    const detail = change.kind === 'trend'
      ? `${change.fromYear}-${change.targetYear}`
      : `${change.targetYear}:${change.from}->${change.to}`;
    const sourceIdentifier = `${record.sourceKey}:${record.forecastVersion}:${change.type}:${detail}`;
    const existing = await this.db.execute({
      sql: `SELECT id FROM kg_events
            WHERE source_id=? AND source_identifier=? AND event_type=? LIMIT 1`,
      args: [this.sourceId, sourceIdentifier, change.type],
    });
    if (existing.rows.length > 0) return false;

    const labels = {
      SCHOOL_FORECAST_GROWTH: 'DUO voorziet opvallende leerlinggroei',
      SCHOOL_FORECAST_DECLINE: 'DUO voorziet opvallende leerlingkrimp',
      SCHOOL_FORECAST_REVISED_UP: 'DUO stelt leerlingenprognose fors omhoog bij',
      SCHOOL_FORECAST_REVISED_DOWN: 'DUO stelt leerlingenprognose fors omlaag bij',
      SCHOOL_FORECAST_OVERSHOOT: 'Leerlingaantal ligt fors boven eerdere DUO-prognose',
      SCHOOL_FORECAST_UNDERSHOOT: 'Leerlingaantal ligt fors onder eerdere DUO-prognose',
    };
    const title = `${labels[change.type]}: ${record.naam}`;
    const roundedFrom = Math.round(change.from * 10) / 10;
    const roundedTo = Math.round(change.to * 10) / 10;
    const sign = change.absoluteChange > 0 ? '+' : '';
    const summary = change.kind === 'trend'
      ? `${record.naam} (${record.vestigingscode}) gaat in de DUO-prognose van ${roundedFrom} leerlingen in ${change.fromYear} naar ${roundedTo} in ${change.targetYear} (${sign}${change.relativeChangePercent}%).`
      : `${record.naam} (${record.vestigingscode}): ${roundedFrom} naar ${roundedTo} leerlingen voor ${change.targetYear} (${sign}${change.relativeChangePercent}%).`;
    const provenance = {
      source_name: SOURCE_NAME,
      source_class: 'MEASUREMENT',
      current: record,
      previous,
      actual: change.actual || null,
      change_kind: change.kind,
      target_year: change.targetYear,
      from_year: change.fromYear || null,
      absolute_change: change.absoluteChange,
      relative_change: change.relativeChange,
      threshold_band: change.thresholdBand,
      journalistically_relevant: true,
    };
    const inserted = await this.db.execute({
      sql: `INSERT INTO kg_events
            (event_type, title, summary, occurred_at, published_at, fetched_at, source_id,
             source_url, source_identifier, raw_object_hash, parser_version, detection_rule, provenance)
            VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, 'DUO_PROGNOSE_SIGNIFICANT_CHANGE', ?)`,
      args: [change.type, title, summary, `${record.forecastVersion}T00:00:00.000Z`,
        `${record.forecastVersion}T00:00:00.000Z`, this.sourceId, DATASET_PAGE_URL,
        sourceIdentifier, record.contentHash, PARSER_VERSION, JSON.stringify(provenance)],
    });
    if (entityId) {
      await this.db.execute({
        sql: `INSERT OR IGNORE INTO event_entities
              (event_id, entity_id, role, evidence, confidence)
              VALUES (?, ?, 'subject', 'DUO vestigingscode en prognosereeks', 1.0)`,
        args: [Number(inserted.lastInsertRowid), entityId],
      });
    }
    return true;
  }

  async run() {
    await this._ensureSource();
    const records = await this._fetchRecords();
    const [state, actuals] = await Promise.all([this._loadState(), this._loadActuals()]);
    const baseline = !state.baselineComplete;
    const currentKeys = new Set(records.map(record => record.sourceKey));
    let created = 0;
    let changed = 0;
    let removed = 0;
    let events = 0;

    for (const record of records) {
      const old = state.records.get(record.sourceKey);
      const unchanged = old && old.changeType !== 'removed' && old.contentHash === record.contentHash;
      const entityId = await this._ensureEntity(record);

      if (!baseline && old && old.changeType !== 'removed') {
        const realization = assessForecastRealization(old.record, actuals.get(record.vestigingscode));
        if (realization && await this._emitEvent(realization, record, old.record, entityId)) events++;
      }
      if (unchanged) continue;

      if (!old || old.changeType === 'removed') created++;
      else changed++;
      if (!baseline && old && old.changeType !== 'removed') {
        const revision = assessForecastRevision(old.record, record);
        const trend = assessForecastTrend(record);
        const previousTrend = assessForecastTrend(old.record);
        // Eén modelupdate mag niet twee signalen over dezelfde beweging maken.
        // Een forse herziening is specifieker; een trend-event volgt alleen bij
        // een nieuwe drempeloverschrijding of omslag zonder zo'n herziening.
        if (revision && await this._emitEvent(revision, record, old.record, entityId)) {
          events++;
        } else if (trend && (!previousTrend || previousTrend.type !== trend.type) &&
          await this._emitEvent(trend, record, old.record, entityId)) {
          events++;
        }
      }
      await this._saveRecord(record, !old || old.changeType === 'removed' ? 'added' : 'changed', old?.id || null);
    }

    // Een verdwenen prognosereeks kan datakwaliteit of een modelwijziging zijn.
    // Alleen het adressenregister mag een SCHOOL_CLOSED-event veroorzaken.
    if (!baseline) {
      for (const [sourceKey, old] of state.records) {
        if (old.changeType === 'removed' || currentKeys.has(sourceKey)) continue;
        const tombstone = { ...old.record, sourceKey, _removed: true, removedFromVersion: this.lastSourceInfo.version };
        tombstone.contentHash = crypto.createHash('sha256')
          .update(`${old.contentHash}:removed:${this.lastSourceInfo.version}`)
          .digest('hex');
        await this._saveRecord(tombstone, 'removed', old.id);
        removed++;
      }
    }

    if (baseline) await this._markBaselineComplete(records);
    const result = {
      total: records.length,
      baseline,
      created: baseline ? 0 : created,
      changed: baseline ? 0 : changed,
      removed,
      events,
      source: this.lastSourceInfo,
    };
    console.log(`[DUO Prognoses] ${baseline ? 'Nulmeting' : 'Run'}: ${JSON.stringify(result)}`);
    return result;
  }

  async health() {
    if (!this.lastSourceInfo) return { status: 'error', message: 'Nog geen geldige DUO-prognose verwerkt' };
    return {
      status: 'ok',
      message: `DUO-prognose ${this.lastSourceInfo.version}: ${this.lastSourceInfo.localSchools} lokale vestigingen, ${this.lastSourceInfo.firstYear}-${this.lastSourceInfo.lastYear}`,
      timestamp: new Date().toISOString(),
    };
  }
}

if (require.main === module) {
  const adapter = new DuoPrognosesAdapter({ dryRun: process.argv.includes('--dry-run') });
  adapter.run()
    .then(result => { console.log('[DUO Prognoses] Resultaat:', JSON.stringify(result, null, 2)); process.exit(0); })
    .catch(error => { console.error('[DUO Prognoses] Fatale fout:', error); process.exit(1); });
}

module.exports = {
  API_URL,
  BASELINE_KEY,
  DATASET_PAGE_URL,
  METADATA_URL,
  SOURCE_NAME,
  DuoPrognosesAdapter,
  assessForecastRealization,
  assessForecastRevision,
  assessForecastTrend,
  fullVestigingscode,
  hashForecast,
  normalizeForecastRows,
  parseCommaCsv,
  selectForecastResource,
  significantDifference,
};
