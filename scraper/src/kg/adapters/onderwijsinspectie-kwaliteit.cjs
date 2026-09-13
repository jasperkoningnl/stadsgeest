const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { changedFields, fetchBuffer, normalizeText, runVersionedDataset } = require('../phase3-core.cjs');

const BASIS = 'https://toezichtresultaten.onderwijsinspectie.nl';
const SOURCE_URL = `${BASIS}/zoek`;
const VERSION = '1.0.0';
const PLACES = ['Amersfoort', 'Leusden'];
const META = { name: 'Onderwijsinspectie — kwaliteitsoordelen', url: SOURCE_URL, sourceClass: 'AUTHORITATIVE_EVENT',
  version: VERSION, frequency: 'weekly', category: 'data', lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13', ownerContact: null,
  manifest: { owner: 'Inspectie van het Onderwijs', license: 'openbare toezichtresultaten', identity: 'element-id',
    duo_link: 'BRIN + locatievolgnummer uit pseudocode/eigenschappen', local_filter: 'exact town Amersfoort/Leusden',
    semantic_fields: ['judgment', 'dimension', 'indicators', 'reports', 'expired'],
    threshold: 'alleen nieuw ernstig oordeel, ernstwisseling of inhoudelijk nieuw rapport bij onvoldoende/zeer zwak',
    missing_judgment: 'geen journalistieke verwijdering; alleen datakwaliteitsstatus', removal_confirmation_runs: 2 } };
const SEVERITY = new Map([['zeer zwak', 3], ['onvoldoende', 2], ['voldoende', 0], ['goed', 0]]);

function propertyMap(element) {
  return new Map((element?.eigenschappen?.eigenschappen || []).map(item => [item.code, normalizeText(item.waarde)]));
}
function duoBranchCode(element) {
  const properties = propertyMap(element); const brin = properties.get('BRIN') || normalizeText(element.pseudocode).split('|')[0];
  const location = properties.get('LOCATIENR') || normalizeText(element.pseudocode).split('|')[1] || '';
  return `${brin}${location}`.replace(/[^0-9A-Z]/gi, '').toUpperCase();
}
function normalizeJudgment(value) { return normalizeText(value).toLocaleLowerCase('nl-NL'); }
function judgmentSeverity(value) { return SEVERITY.get(normalizeJudgment(value)) ?? 1; }
function normalizeInspectionRecord(element, judgmentPayload, reports) {
  const judgment = normalizeText(judgmentPayload?.oordeel?.effectieveWaardeomschrijving);
  const dimension = normalizeText(judgmentPayload?.oordeel?.dimensieomschrijving);
  const indicators = Object.values(judgmentPayload?.indicatoren || {}).flatMap(value => Array.isArray(value) ? value : [value])
    .map(item => typeof item === 'object' ? normalizeText(item.effectieveWaardeomschrijving || item.waardeomschrijving || item.omschrijving) : normalizeText(item)).filter(Boolean).sort();
  const normalizedReports = reports.filter(report => report?.rapportnummer).map(report => ({ number: String(report.rapportnummer),
    type: normalizeText(report.publicatienaam), date: normalizeText(report.vaststellingsdatum),
    url: `${BASIS}/toezichtresultaat/${element.id}#rapport-${report.rapportnummer}` })).sort((a, b) => a.number.localeCompare(b.number));
  const record = { sourceKey: `onderwijsinspectie:${element.id}`, elementId: Number(element.id), name: normalizeText(element.naam),
    sector: normalizeText(element.sectorcode), place: normalizeText(element.town), street: normalizeText(element.street),
    houseNumber: normalizeText(element.houseNo) + normalizeText(element.houseNoAddition), postalCode: normalizeText(element.postalcode).replace(/\s/g, '').toUpperCase(),
    brinBranch: duoBranchCode(element), boardName: normalizeText(element.bevoegdGezag?.naam), judgment, dimension,
    judgmentHelp: normalizeText(judgmentPayload?.oordeel?.helptekst), indicators, reports: normalizedReports,
    expired: Boolean(element.vervallen), sourceUrl: `${BASIS}/toezichtresultaat/${element.id}` };
  record.semanticFields = { judgment, dimension, indicators, reports: normalizedReports, expired: record.expired };
  return record;
}

function assessInspectionChange(changeType, current, previous) {
  if (changeType === 'removed') return null;
  const currentSeverity = judgmentSeverity(current.judgment); const previousSeverity = previous ? judgmentSeverity(previous.judgment) : null;
  const previousReports = new Set((previous?.reports || []).map(report => report.number));
  const newReports = (current.reports || []).filter(report => !previousReports.has(report.number));
  const judgmentChanged = previous && normalizeJudgment(previous.judgment) !== normalizeJudgment(current.judgment) && current.judgment;
  const concerningNew = !previous && currentSeverity >= 2;
  if (!judgmentChanged && !concerningNew && !(newReports.length && currentSeverity >= 2)) return null;
  const direction = previousSeverity === null ? 'new' : currentSeverity > previousSeverity ? 'worse' : currentSeverity < previousSeverity ? 'better' : 'corrected';
  return { direction, currentSeverity, previousSeverity, newReports,
    eventType: judgmentChanged || concerningNew ? 'SCHOOL_INSPECTION_JUDGMENT_CHANGED' : 'SCHOOL_INSPECTION_REPORT_PUBLISHED' };
}
function eventForChange(changeType, record, previous, entityId) {
  const assessment = assessInspectionChange(changeType, record, previous); if (!assessment) return null;
  const fields = previous ? changedFields(previous, record, ['judgment', 'dimension', 'indicators', 'reports', 'expired']) : [];
  return { type: assessment.eventType, changeType, entityId, changedFields: fields,
    title: `Onderwijsinspectie: ${record.name} — ${record.judgment || 'nieuw inhoudelijk rapport'}`,
    summary: `${record.name} (${record.brinBranch}, ${record.place}): ${previous?.judgment || 'geen eerder oordeel'} → ${record.judgment || 'oordeel afgeschermd'}. ${assessment.newReports.length} nieuw(e) rapport(en).`,
    evidence: [record.judgment, record.dimension, record.judgmentHelp, ...record.indicators.slice(0, 3), ...assessment.newReports.map(report => `${report.number} ${report.date}`)],
    journalisticallyRelevant: true, uncertainty: !record.judgment ? 'Het actuele oordeel ontbreekt of is afgeschermd; dit is niet als verslechtering geïnterpreteerd.' : null,
    entityEvidence: `BRIN/vestigingscode ${record.brinBranch} uit de officiële Inspectiebron`, entityConfidence: 1 };
}

async function ensureSchoolEntity(db, record, dryRun) {
  if (dryRun) return null;
  const suffix = `${record.sector.toLowerCase()}:${record.brinBranch}`;
  const found = await db.execute({ sql: `SELECT entity_id FROM entity_identifiers WHERE identifier_type='website' AND value LIKE ? LIMIT 1`, args: [`%#${suffix}`] });
  if (found.rows.length) return Number(found.rows[0].entity_id);
  const exact = await db.execute({ sql: `SELECT id FROM kg_entities WHERE entity_type='organization' AND normalized_name=? LIMIT 1`,
    args: [record.name.toLocaleLowerCase('nl-NL')] });
  if (exact.rows.length) return Number(exact.rows[0].id);
  const inserted = await db.execute({ sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization',?,?)`,
    args: [record.name, record.name.toLocaleLowerCase('nl-NL')] });
  const entityId = Number(inserted.lastInsertRowid); const identifier = `${record.sourceUrl}#inspectie:${record.brinBranch || record.elementId}`;
  await db.execute({ sql: `INSERT OR IGNORE INTO entity_identifiers(entity_id,identifier_type,value,source_url,verified_at) VALUES (?,'website',?,?,datetime('now'))`,
    args: [entityId, identifier, record.sourceUrl] });
  await db.execute({ sql: `INSERT OR IGNORE INTO kg_aliases(entity_id,alias,normalized_alias,source,score_weight) VALUES (?,?,?,'Onderwijsinspectie',45)`,
    args: [entityId, record.name, record.name.toLocaleLowerCase('nl-NL')] });
  return entityId;
}

async function json(url, fetchImpl, emptyValue) { const fetched = await fetchBuffer(url, { fetchImpl, label: `Onderwijsinspectie ${new URL(url).pathname}`, accept: 'application/json', timeoutMs: 45_000, allowEmpty: emptyValue !== undefined });
  return { fetched, data: fetched.buffer.length ? JSON.parse(fetched.buffer.toString('utf8')) : emptyValue }; }

class OnderwijsinspectieKwaliteitAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; }
  async run() {
    const elements = new Map(); const rawParts = [];
    for (const place of PLACES) {
      let page = 0, totalPages = 1;
      while (page < totalPages) {
        const response = await json(`${BASIS}/api/zoek/elementen?search=${encodeURIComponent(place)}&page=${page}&sector=&oordeel=&oordeelGemeente=&predicaat=`, this.fetchImpl);
        rawParts.push(response.fetched.buffer); const payload = response.data;
        if (!Array.isArray(payload.content)) throw new Error('Onderwijsinspectie schemadrift: content ontbreekt');
        for (const element of payload.content.filter(item => normalizeText(item.town).toLowerCase() === place.toLowerCase())) elements.set(Number(element.id), element);
        totalPages = Number(payload.totalPages || 1); page++;
      }
    }
    if (elements.size < 100) throw new Error(`Onderwijsinspectie lokale selectie verdacht klein: ${elements.size}`);
    const records = [];
    for (const element of elements.values()) {
      const judgment = await json(`${BASIS}/api/ws/vigerend-oordeel/${element.id}?expanded=false`, this.fetchImpl, {}); rawParts.push(judgment.fetched.buffer);
      const reports = [];
      for (const researchId of judgment.data?.onderzoekenVoorRapporten || []) {
        const response = await json(`${BASIS}/api/detail/rapporten-bij-onderzoeken/${researchId}`, this.fetchImpl, []); rawParts.push(response.fetched.buffer);
        if (!Array.isArray(response.data)) throw new Error('Onderwijsinspectie schemadrift: rapportenlijst is geen array'); reports.push(...response.data);
      }
      records.push(normalizeInspectionRecord(element, judgment.data, reports));
    }
    const fetched = { buffer: Buffer.from(JSON.stringify(rawParts.map(part => part.toString('base64')))), url: SOURCE_URL, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records, fetched, minimumRecords: 100, eventForChange,
      ensureEntity: record => ensureSchoolEntity(this.db, record, this.dryRun) });
    this.sourceId = result.sourceId; return { ...result, institutions: elements.size };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: 'Inspectie-elementen exact lokaal en via BRIN gekoppeld' }; }
}

module.exports = { BASIS, META, OnderwijsinspectieKwaliteitAdapter, assessInspectionChange, duoBranchCode, eventForChange,
  judgmentSeverity, normalizeInspectionRecord, normalizeJudgment, propertyMap };
