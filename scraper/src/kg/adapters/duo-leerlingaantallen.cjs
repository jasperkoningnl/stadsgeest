// Adapter: DUO Open Onderwijsdata — leerlingaantallen per BO- en VO-vestiging.
//
// Officiële bronnen:
// - BO: historisch overzicht per schoolvestiging (laatste LEERLINGEN_YYYY-kolom)
// - VO: leerlingen per vestiging en bevoegd gezag (nieuwste twee jaargangen)
//
// De eerste volledig geslaagde run is uitsluitend een nulmeting. Daarna ontstaan
// alleen events bij grote, zowel absoluut als relatief betekenisvolle mutaties.

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { DATASETS: SCHOOL_DATASETS } = require('./duo-schoolvestigingen.cjs');

const SOURCE_NAME = 'DUO — leerlingaantallen BO en VO per vestiging';
const PO_PAGE_URL = 'https://www.duo.nl/open_onderwijsdata/primair-onderwijs/aantal-leerlingen/historisch-overzicht-leerlingen-schoolvestiging.jsp';
const PO_CSV_URL = 'https://www.duo.nl/open_onderwijsdata/images/06.-historisch-overzicht-aantal-leerlingen-per-schoolvestiging.csv';
const VO_PAGE_URL = 'https://duo.nl/open_onderwijsdata/voortgezet-onderwijs/aantal-leerlingen/aantal-leerlingen.jsp';
const LOCAL_CITIES = new Set(['AMERSFOORT', 'LEUSDEN']);
const BASELINE_KEY = 'duo-leerlingen:baseline';
const MIN_PO_ROWS = 9_000;
const MIN_VO_ROWS = 1_000;
const PARSER_VERSION = '1.0';

const PO_REQUIRED_FIELDS = [
  'INSTELLINGSCODE', 'VESTIGINGSCODE', 'NAAM_VESTIGING',
  'SOORT_VESTIGING', 'GEMEENTENAAM_VESTIGING',
];
const VO_REQUIRED_FIELDS = [
  'BEVOEGD GEZAG NUMMER', 'INSTELLINGSCODE', 'VESTIGINGSCODE',
  'INSTELLINGSNAAM VESTIGING', 'PLAATSNAAM', 'GEMEENTENAAM',
  'AANTAL LEERLINGEN',
];

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Kleine CSV-parser voor DUO's semikolonbestanden, inclusief dubbele quotes. */
function parseSemicolonCsv(text) {
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
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ';') {
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
  if (quoted) throw new Error('DUO CSV eindigt midden in een geciteerd veld');
  if (value || row.length > 0) {
    row.push(value.replace(/\r$/, '').trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }
  if (rows.length === 0) throw new Error('DUO CSV is leeg');

  const headers = rows[0];
  return rows.slice(1).map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
}

function validateFields(rows, requiredFields, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`DUO ${label} bevat geen records`);
  }
  const fields = new Set(Object.keys(rows[0]));
  const missing = requiredFields.filter(field => !fields.has(field));
  if (missing.length > 0) {
    throw new Error(`DUO ${label}-schema gewijzigd; ontbrekende velden: ${missing.join(', ')}`);
  }
}

function parsePublishedCount(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
}

function hashRecord(record) {
  // Alleen betekenisvolle telvelden: naam, volgorde, VAVO-detail en opmaak mogen
  // dezelfde telling niet als wijziging laten terugkomen.
  const semantic = {
    sourceKey: record.sourceKey,
    peiljaar: record.peiljaar,
    aantalLeerlingen: record.aantalLeerlingen,
  };
  return crypto.createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}

function latestPoYears(rows) {
  const years = Object.keys(rows[0] || {})
    .map(field => /^LEERLINGEN_(\d{4})$/.exec(field)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => b - a);
  if (years.length < 2) throw new Error('DUO BO-schema mist twee LEERLINGEN_YYYY-kolommen');
  return { currentYear: years[0], previousYear: years[1] };
}

function normalizePoRows(rows, sourceUrl = PO_CSV_URL) {
  validateFields(rows, PO_REQUIRED_FIELDS, 'BO');
  const { currentYear, previousYear } = latestPoYears(rows);
  const records = [];
  for (const row of rows) {
    const gemeente = String(row.GEMEENTENAAM_VESTIGING || '').trim().toUpperCase();
    const aantalLeerlingen = parsePublishedCount(row[`LEERLINGEN_${currentYear}`]);
    // Fase 3 is afgebakend tot regulier basisonderwijs. Kleine, afgeschermde
    // aantallen en historische nulregels zijn geen veilige veranderingsbasis.
    if (String(row.SOORT_VESTIGING || '').trim().toUpperCase() !== 'BO') continue;
    if (!LOCAL_CITIES.has(gemeente) || !Number.isInteger(aantalLeerlingen) || aantalLeerlingen <= 0) continue;
    const vestigingscode = String(row.VESTIGINGSCODE || '').trim().toUpperCase();
    if (!vestigingscode) throw new Error('DUO BO-record zonder VESTIGINGSCODE');
    const record = {
      sourceKey: `duo-leerlingen:bo:${vestigingscode}`,
      sector: 'bo',
      instellingCode: String(row.INSTELLINGSCODE || '').trim().toUpperCase(),
      vestigingscode,
      naam: String(row.NAAM_VESTIGING || '').trim(),
      gemeente,
      plaats: gemeente,
      peiljaar: currentYear,
      peildatum: `${currentYear}-10-01`,
      aantalLeerlingen,
      vorigPeiljaar: previousYear,
      vorigAantalLeerlingen: parsePublishedCount(row[`LEERLINGEN_${previousYear}`]),
      voorlopig: true,
      sourceUrl,
      sourcePageUrl: PO_PAGE_URL,
      sourceVersion: `BO ${currentYear}-${currentYear + 1} (voorlopig)`,
    };
    record.contentHash = hashRecord(record);
    records.push(record);
  }
  return records.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

function discoverVoFiles(html, baseUrl = VO_PAGE_URL) {
  const matches = [];
  const pattern = /href=["']([^"']*03\.-leerlingen-vo-per-vestiging-en-bestuur-[^"']*-(\d{4})\.csv)["']/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    matches.push({ year: Number(match[2]), url: new URL(match[1], baseUrl).href });
  }
  const unique = [...new Map(matches.map(item => [item.year, item])).values()]
    .sort((a, b) => b.year - a.year);
  if (unique.length < 2) {
    throw new Error('DUO VO-landingspagina bevat niet de nieuwste twee CSV-jaargangen');
  }
  return unique.slice(0, 2);
}

function normalizeVoRows(currentRows, previousRows, files) {
  validateFields(currentRows, VO_REQUIRED_FIELDS, 'VO');
  validateFields(previousRows, VO_REQUIRED_FIELDS, 'VO vorig jaar');
  const previousByCode = new Map(previousRows.map(row => [
    String(row.VESTIGINGSCODE || '').trim().toUpperCase(), row,
  ]));
  const records = [];
  for (const row of currentRows) {
    const gemeente = String(row.GEMEENTENAAM || '').trim().toUpperCase();
    const aantalLeerlingen = parsePublishedCount(row['AANTAL LEERLINGEN']);
    if (!LOCAL_CITIES.has(gemeente) || !Number.isInteger(aantalLeerlingen) || aantalLeerlingen <= 0) continue;
    const vestigingscode = String(row.VESTIGINGSCODE || '').trim().toUpperCase();
    if (!vestigingscode) throw new Error('DUO VO-record zonder VESTIGINGSCODE');
    const previous = previousByCode.get(vestigingscode);
    const record = {
      sourceKey: `duo-leerlingen:vo:${vestigingscode}`,
      sector: 'vo',
      instellingCode: String(row.INSTELLINGSCODE || '').trim().toUpperCase(),
      vestigingscode,
      naam: String(row['INSTELLINGSNAAM VESTIGING'] || '').trim(),
      gemeente,
      plaats: String(row.PLAATSNAAM || '').trim().toUpperCase(),
      peiljaar: files[0].year,
      peildatum: `${files[0].year}-10-01`,
      aantalLeerlingen,
      vorigPeiljaar: files[1].year,
      vorigAantalLeerlingen: parsePublishedCount(previous?.['AANTAL LEERLINGEN']),
      voorlopig: true,
      sourceUrl: files[0].url,
      sourcePageUrl: VO_PAGE_URL,
      sourceVersion: `VO ${files[0].year} (voorlopig)`,
    };
    record.contentHash = hashRecord(record);
    records.push(record);
  }
  return records.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

function assessEnrollmentChange(previous, current) {
  if (!previous || previous._removed) return null;
  const from = previous.aantalLeerlingen;
  const to = current.aantalLeerlingen;
  if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0 || from === to) return null;
  if (Number(current.peiljaar) < Number(previous.peiljaar)) return null;

  const absoluteChange = to - from;
  const relativeChange = absoluteChange / from;
  const absolute = Math.abs(absoluteChange);
  const relative = Math.abs(relativeChange);
  let thresholdBand = null;
  if (absolute >= 100) thresholdBand = 'minstens 100 leerlingen';
  else if (absolute >= 30 && relative >= 0.10) thresholdBand = 'minstens 30 leerlingen en 10 procent';
  else if (from < 100 && absolute >= 20 && relative >= 0.25) thresholdBand = 'kleine vestiging: minstens 20 leerlingen en 25 procent';
  if (!thresholdBand) return null;

  return {
    type: absoluteChange > 0 ? 'SCHOOL_ENROLLMENT_GROWTH' : 'SCHOOL_ENROLLMENT_DECLINE',
    from,
    to,
    absoluteChange,
    relativeChange,
    relativeChangePercent: Math.round(relativeChange * 1_000) / 10,
    thresholdBand,
  };
}

class DuoLeerlingaantallenAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.fetchImpl = config.fetchImpl || fetch;
    this.minimumRows = {
      po: MIN_PO_ROWS,
      vo: MIN_VO_ROWS,
      localPo: 40,
      localVo: 15,
      ...(config.minimumRows || {}),
    };
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
      args: [SOURCE_NAME, PO_PAGE_URL, PARSER_VERSION],
    });
    this.sourceId = Number(inserted.lastInsertRowid);
  }

  async _fetchText(url, label) {
    const response = await this.fetchImpl(url, {
      headers: { 'Accept': 'text/csv,text/html;q=0.9', 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`DUO ${label} ophalen mislukt: HTTP ${response.status}`);
    return response.text();
  }

  async _fetchRecords() {
    const [poText, voPage] = await Promise.all([
      this._fetchText(PO_CSV_URL, 'BO-leerlingbestand'),
      this._fetchText(VO_PAGE_URL, 'VO-landingspagina'),
    ]);
    const voFiles = discoverVoFiles(voPage);
    const [voCurrentText, voPreviousText] = await Promise.all([
      this._fetchText(voFiles[0].url, `VO ${voFiles[0].year}`),
      this._fetchText(voFiles[1].url, `VO ${voFiles[1].year}`),
    ]);
    const poRows = parseSemicolonCsv(poText);
    const voCurrentRows = parseSemicolonCsv(voCurrentText);
    const voPreviousRows = parseSemicolonCsv(voPreviousText);
    if (poRows.length < this.minimumRows.po) throw new Error(`DUO BO-bestand verdacht klein: ${poRows.length} records`);
    if (voCurrentRows.length < this.minimumRows.vo) throw new Error(`DUO VO-bestand verdacht klein: ${voCurrentRows.length} records`);
    if (voPreviousRows.length < this.minimumRows.vo) throw new Error(`DUO VO-bestand vorig jaar verdacht klein: ${voPreviousRows.length} records`);

    const poRecords = normalizePoRows(poRows);
    const voRecords = normalizeVoRows(voCurrentRows, voPreviousRows, voFiles);
    if (poRecords.length < this.minimumRows.localPo || voRecords.length < this.minimumRows.localVo) {
      throw new Error(`DUO lokale selectie verdacht klein: BO=${poRecords.length}, VO=${voRecords.length}`);
    }
    this.lastSourceInfo = {
      po: { year: poRecords[0]?.peiljaar, url: PO_CSV_URL, records: poRecords.length },
      vo: { year: voFiles[0].year, url: voFiles[0].url, records: voRecords.length },
    };
    return [...poRecords, ...voRecords];
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

  async _saveRecord(record, changeType, previousId = null) {
    if (this.dryRun) return;
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, previous_id, change_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [this.sourceId, record.sourceKey, JSON.stringify(record), record.contentHash,
        record.contentHash, previousId, changeType],
    });
  }

  async _markBaselineComplete(records) {
    if (this.dryRun) return;
    const sourceVersions = [...new Set(records.map(record => record.sourceVersion))].sort();
    const payload = { completedAt: new Date().toISOString(), sourceVersions, records: records.length };
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(sourceVersions)).digest('hex');
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, change_type)
            VALUES (?, ?, ?, ?, ?, 'added')`,
      args: [this.sourceId, BASELINE_KEY, JSON.stringify(payload), contentHash, contentHash],
    });
  }

  async _ensureEntity(record) {
    if (this.dryRun) return null;
    const schoolDataset = record.sector === 'bo' ? SCHOOL_DATASETS[0] : SCHOOL_DATASETS[1];
    const schoolIdentifier = `${schoolDataset.pageUrl}#${record.sector}:${record.vestigingscode}`;
    const ownIdentifier = `${record.sourcePageUrl}#${record.sector}:${record.vestigingscode}`;
    let found = await this.db.execute({
      sql: `SELECT entity_id FROM entity_identifiers
            WHERE identifier_type='website' AND value IN (?, ?) LIMIT 1`,
      args: [schoolIdentifier, ownIdentifier],
    });
    let entityId;
    if (found.rows.length > 0) {
      entityId = Number(found.rows[0].entity_id);
    } else {
      const inserted = await this.db.execute({
        sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
              VALUES ('organization', ?, ?)`,
        args: [record.naam, normalizeName(record.naam)],
      });
      entityId = Number(inserted.lastInsertRowid);
    }
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO entity_identifiers
            (entity_id, identifier_type, value, source_url, verified_at)
            VALUES (?, 'website', ?, ?, datetime('now'))`,
      args: [entityId, ownIdentifier, record.sourcePageUrl],
    });
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO kg_aliases
            (entity_id, alias, normalized_alias, match_mode, source, score_weight)
            VALUES (?, ?, ?, 'ci', 'DUO', 45)`,
      args: [entityId, record.naam, normalizeName(record.naam)],
    });
    return entityId;
  }

  async _emitEvent(change, record, previous, entityId) {
    if (this.dryRun) return false;
    const sourceIdentifier = `${record.sourceKey}:${record.sourceVersion}:${change.type}:${change.from}->${change.to}`;
    const existing = await this.db.execute({
      sql: `SELECT id FROM kg_events
            WHERE source_id=? AND source_identifier=? AND event_type=? LIMIT 1`,
      args: [this.sourceId, sourceIdentifier, change.type],
    });
    if (existing.rows.length > 0) return false;

    const richting = change.absoluteChange > 0 ? 'gegroeid' : 'gekrompen';
    const teken = change.absoluteChange > 0 ? '+' : '';
    const title = `Opvallende leerling${richting === 'gegroeid' ? 'groei' : 'krimp'}: ${record.naam}`;
    const summary = `${record.naam} (${record.sector.toUpperCase()}, ${record.vestigingscode}) is volgens DUO van ${change.from} naar ${change.to} leerlingen ${richting} (${teken}${change.absoluteChange}; ${teken}${change.relativeChangePercent}%). Peildatum ${record.peildatum}.`;
    const provenance = {
      source_name: SOURCE_NAME,
      source_class: 'MEASUREMENT',
      current: record,
      previous,
      absolute_change: change.absoluteChange,
      relative_change: change.relativeChange,
      threshold_band: change.thresholdBand,
      journalistically_relevant: true,
    };
    const inserted = await this.db.execute({
      sql: `INSERT INTO kg_events
            (event_type, title, summary, occurred_at, fetched_at, source_id,
             source_url, source_identifier, raw_object_hash, parser_version, provenance)
            VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
      args: [change.type, title, summary, `${record.peildatum}T00:00:00.000Z`, this.sourceId,
        record.sourceUrl, sourceIdentifier, record.contentHash, PARSER_VERSION, JSON.stringify(provenance)],
    });
    if (entityId) {
      await this.db.execute({
        sql: `INSERT OR IGNORE INTO event_entities
              (event_id, entity_id, role, evidence, confidence)
              VALUES (?, ?, 'subject', 'DUO vestigingscode en leerlingtelling', 1.0)`,
        args: [Number(inserted.lastInsertRowid), entityId],
      });
    }
    return true;
  }

  async run() {
    await this._ensureSource();
    const records = await this._fetchRecords();
    const state = await this._loadState();
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
      if (unchanged) continue;

      if (!old || old.changeType === 'removed') created++;
      else changed++;
      if (!baseline) {
        const change = assessEnrollmentChange(old?.record, record);
        if (change && await this._emitEvent(change, record, old.record, entityId)) events++;
      }
      await this._saveRecord(record, !old || old.changeType === 'removed' ? 'added' : 'changed', old?.id || null);
    }

    // Ontbrekende rijen worden wel als bronwijziging onthouden, maar niet als
    // sluiting geïnterpreteerd. Het DUO-adressenregister is daarvoor leidend.
    if (!baseline) {
      for (const [sourceKey, old] of state.records) {
        if (old.changeType === 'removed' || currentKeys.has(sourceKey)) continue;
        const tombstone = {
          ...old.record,
          sourceKey,
          _removed: true,
          removedFromVersion: this.lastSourceInfo,
        };
        tombstone.contentHash = crypto.createHash('sha256')
          .update(`${old.contentHash}:removed:${JSON.stringify(this.lastSourceInfo)}`)
          .digest('hex');
        await this._saveRecord(tombstone, 'removed', old.id);
        removed++;
      }
    }

    if (baseline) await this._markBaselineComplete(records);
    const result = { total: records.length, baseline, created: baseline ? 0 : created, changed: baseline ? 0 : changed, removed, events, sources: this.lastSourceInfo };
    console.log(`[DUO Leerlingen] ${baseline ? 'Nulmeting' : 'Run'}: ${JSON.stringify(result)}`);
    return result;
  }

  async health() {
    if (!this.lastSourceInfo) return { status: 'error', message: 'Nog geen geldige DUO-leerlingbestanden verwerkt' };
    return {
      status: 'ok',
      message: `Officiële DUO-bestanden geldig: BO ${this.lastSourceInfo.po.year} (${this.lastSourceInfo.po.records}), VO ${this.lastSourceInfo.vo.year} (${this.lastSourceInfo.vo.records})`,
      timestamp: new Date().toISOString(),
    };
  }
}

if (require.main === module) {
  const adapter = new DuoLeerlingaantallenAdapter({ dryRun: process.argv.includes('--dry-run') });
  adapter.run()
    .then(result => { console.log('[DUO Leerlingen] Resultaat:', JSON.stringify(result, null, 2)); process.exit(0); })
    .catch(error => { console.error('[DUO Leerlingen] Fatale fout:', error); process.exit(1); });
}

module.exports = {
  BASELINE_KEY,
  PO_CSV_URL,
  PO_PAGE_URL,
  SOURCE_NAME,
  VO_PAGE_URL,
  DuoLeerlingaantallenAdapter,
  assessEnrollmentChange,
  discoverVoFiles,
  hashRecord,
  latestPoYears,
  normalizePoRows,
  normalizeVoRows,
  parsePublishedCount,
  parseSemicolonCsv,
  validateFields,
};
