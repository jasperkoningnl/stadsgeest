const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { load } = require('cheerio');
const {
  archiveSnapshot, changedFields, ensureSource, fetchBuffer, normalizeText, parseDelimited,
  runVersionedDataset, semanticHash,
} = require('../phase3-core.cjs');
const {
  discoverLinks, loadLocalIdentity, localRowMatch, objectsFromSheet, parseOdsFiltered, parseXlsx,
  tabularLocalRecords, zipEntries,
} = require('../phase4-core.cjs');
const { BOUNDARY_URL, pointInGeometry } = require('./ndw-planning.cjs');

const VERIFIED = '2026-09-13';
const CARE_PAGE = 'https://www.jaarverantwoordingzorg.nl/over-de-jaarverantwoording/gegevens-bekijken/gegevens-per-boekjaar';
const DPI_PAGE = 'https://data.overheid.nl/dataset/prognose-informatie-woningcorporaties-dpi2025-hfd1-tm-hfd4';
const DPI_PREVIOUS_PAGE = 'https://data.overheid.nl/dataset/prognose-informatie-woningcorporaties-dpi2024-hfd1-tm-hfd4';
const MONUMENT_PAGE = 'https://www.cultureelerfgoed.nl/onderwerpen/r/rijksmonumentenregister/monumentendatabank';
const MONUMENT_API = 'https://api.pdok.nl/rce/beschermde-gebieden-cultuurhistorie/ogc/v1/collections/rce_inspire_points/items?f=json&bbox=5.1,52.0,5.6,52.3&limit=1000';
const SEVESO_PAGE = 'https://seveso-plus.nl/inspectieresultaten/seveso-inrichtingenlijst/';
const SEVESO_COMPLIANCE_PAGE = 'https://seveso-plus.nl/inspectieresultaten/nalevingslijst/';
const SEVESO_REGION_PAGE = 'https://seveso-plus.nl/inspectieresultaten/kies-regio/noord-holland/';

const METAS = {
  care: { name: 'Jaarverantwoording Zorg — openbare datasets', url: CARE_PAGE, sourceClass: 'AUTHORITATIVE_REGISTER', version: '1.0.0', frequency: 'weekly', category: 'data',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'info@jaarverantwoordingzorg.nl', manifest: { owner: 'CIBG / Ministerie van VWS', license: 'openbare overheidsinformatie; bronvermelding en zorgvuldige interpretatie', intended_frequency: 'jaarlijks; wekelijks in verantwoordingsseizoen',
      identity: 'boekjaar + harde KVK of stabiele rij-identiteit', local_filter: 'exacte gemeente/vestigingsplaats Amersfoort of Leusden, anders hard lokaal KVK', semantic_fields: 'alle openbare verantwoordingsvelden', removal_confirmation_runs: 2,
      caveat: 'CIBG controleert aangeleverde cijfers niet inhoudelijk; concernconsolidatie kan lokale interpretatie beperken' } },
  dpi: { name: 'Woningcorporaties — dPi', url: DPI_PAGE, sourceClass: 'AUTHORITATIVE_REGISTER', version: '1.0.0', frequency: 'weekly', category: 'data',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'Autoriteit woningcorporaties / ILT', manifest: { owner: 'Autoriteit woningcorporaties', license: 'CC0-1.0', intended_frequency: 'jaarlijks',
      identity: 'corporatie + gemeente + tabel/regel', local_filter: 'exacte gemeente of gemeentecode Amersfoort/Leusden', semantic_fields: 'plannen, aantallen en bedragen', removal_confirmation_runs: 2 } },
  monument: { name: 'Rijksmonumentenregister — Extract_MRS', url: MONUMENT_PAGE, sourceClass: 'AUTHORITATIVE_REGISTER', version: '1.0.0', frequency: 'weekly', category: 'registry',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'Rijksdienst voor het Cultureel Erfgoed / PDOK', manifest: { owner: 'Rijksdienst voor het Cultureel Erfgoed; ontsluiting PDOK', license: 'CC-BY-4.0', intended_frequency: 'wekelijks; bron dagelijks bijgewerkt',
      identity: 'monumentregister-citation/monumentnummer + INSPIRE localid', local_filter: 'punt-in-polygoon op officiële gemeentegrenzen GM0307/GM0327', semantic_fields: ['citation','localid','designation','legalfoundationdate','versionid','geometry'], removal_confirmation_runs: 2,
      route_note: 'machineleesbare OGC API gebruikt; Extract_MRS is alleen een 336 MB Microsoft Access-bestand' } },
  seveso: { name: 'SEVESO+ — inrichtingenlijst', url: SEVESO_PAGE, sourceClass: 'AUTHORITATIVE_REGISTER', version: '1.0.0', frequency: 'weekly', category: 'registry',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'Bureau SEVESO+', manifest: { owner: 'Samenwerkingsprogramma SEVESO+', license: 'openbare overheidsinformatie met bron-disclaimer', intended_frequency: 'maandelijkse goedkope scopecheck',
      identity: 'naam + exact adres', local_filter: 'exacte gemeente, plaats of postcode in Amersfoort/Leusden', semantic_fields: ['naam','drempel','adres','inspectiepartners'], removal_confirmation_runs: 2,
      caveat: 'lijst bevat ook vergunde, administratieve of gestopte locaties zonder actuele Seveso-activiteit',
      routes: ['maandelijkse inrichtingenlijst XLSX','maandelijkse nalevingslijst PDF','regionale index en lokale inspectiesamenvattingen'] } },
};

function dbClient(config) {
  return config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
}

function yearFromText(value) {
  return Number(/\b(20\d{2})\b/.exec(value)?.[1]) || null;
}

async function archiveParts(db, sourceId, meta, parts, dryRun) {
  const archived = [];
  for (const part of parts) archived.push(await archiveSnapshot(db, sourceId, meta.name, part.fetched, dryRun));
  return archived;
}

function aggregateFetch(parts, label) {
  const manifest = Buffer.from(JSON.stringify(parts.map(part => ({ url: part.fetched.url, hash: part.hash || null, bytes: part.fetched.buffer.length }))));
  return { buffer: manifest, url: label, contentType: 'application/json' };
}

function eventForCare(changeType, record, previous, entityId) {
  if (record.comparison?.kind === 'care-yoy') {
    const c = record.comparison;
    return { type: 'CARE_FINANCIAL_ANOMALY', changeType, title: `Materiële verandering zorgcijfer: ${c.organization}`,
      summary: `${c.metric}: ${c.previousYear} ${c.previousValue} naar ${c.currentYear} ${c.currentValue} (${Math.round(c.relativeChange * 100)}%).`,
      changedFields: [c.metric], entityId, entityConfidence: record.localMatch.method === 'hard_kvk' ? 1 : 0.85,
      entityEvidence: record.localMatch.evidence.join('; '), evidence: [record.sourceUrl, ...record.localMatch.evidence],
      journalisticallyRelevant: Math.abs(c.absoluteChange) >= 250000 && Math.abs(c.relativeChange) >= 0.15,
      absoluteChange: c.absoluteChange, relativeChange: c.relativeChange,
      uncertainty: 'Aangeleverde cijfers zijn niet inhoudelijk door CIBG gecontroleerd en kunnen geconsolideerd zijn.' };
  }
  const fields = previous ? changedFields(previous.data, record.data, Object.keys(record.data)) : [];
  return { type: 'CARE_FILING_CHANGED', changeType, title: `Zorgverantwoording gewijzigd: ${record.data.naam || record.data.handelsnaam || record.sourceKey}`,
    summary: `Openbare verantwoordingsgegevens zijn inhoudelijk gewijzigd (${fields.slice(0, 8).join(', ') || changeType}).`, changedFields: fields,
    entityId, entityConfidence: record.localMatch.method === 'hard_kvk' ? 1 : 0.95, entityEvidence: record.localMatch.evidence.join('; '),
    evidence: [record.sourceUrl, ...record.localMatch.evidence], journalisticallyRelevant: false,
    uncertainty: 'Aangeleverde cijfers zijn niet inhoudelijk door CIBG gecontroleerd en kunnen geconsolideerd zijn.' };
}

function eventForDpi(changeType, record, previous, entityId) {
  if (record.comparison?.kind === 'dpi-yoy') {
    const c = record.comparison;
    return { type: 'HOUSING_INVESTMENT_ANOMALY', changeType, title: `dPi-planverschuiving: ${c.organization}`,
      summary: `${c.metric} voor ${c.municipality}, doeljaar ${c.targetYear}: dPi ${c.previousYear} ${c.previousValue} naar dPi ${c.currentYear} ${c.currentValue}.`,
      changedFields: ['waarde'], entityId, entityConfidence: 0.95, entityEvidence: record.localMatch.evidence.join('; '),
      evidence: [record.sourceUrl, c.previousUrl, ...record.localMatch.evidence].filter(Boolean),
      journalisticallyRelevant: Math.abs(c.absoluteChange) >= 25 || (Math.abs(c.absoluteChange) >= 10 && Math.abs(c.relativeChange || 0) >= 0.20),
      absoluteChange: c.absoluteChange, relativeChange: c.relativeChange,
      uncertainty: 'dPi bevat door corporaties aangeleverde prognoses, geen gerealiseerde aantallen.' };
  }
  const fields = previous ? changedFields(previous.data, record.data, Object.keys(record.data)) : [];
  return { type: 'HOUSING_PLAN_CHANGED', changeType, title: `dPi-plan gewijzigd: ${record.data.corporatie || record.data.naam || record.sourceKey}`,
    summary: `Prognose-informatie voor ${record.localMatch.evidence.join(', ')} is inhoudelijk gewijzigd (${fields.slice(0, 8).join(', ') || changeType}).`,
    changedFields: fields, entityId, entityConfidence: 0.95, entityEvidence: record.localMatch.evidence.join('; '),
    evidence: [record.sourceUrl, ...record.localMatch.evidence], journalisticallyRelevant: fields.some(field => /nieuwbouw|sloop|verkoop|invest|verduur|woning/i.test(field)),
    uncertainty: 'dPi bevat door corporaties aangeleverde prognoses, geen gerealiseerde aantallen.' };
}

function numberValue(value) {
  const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized); return Number.isFinite(number) ? number : null;
}

function careComparisonKey(record, metric) {
  const data = record.data || {};
  const kvk = data._resolved_kvk || Object.entries(data).find(([key]) => /kvk|handelsregister/i.test(key))?.[1];
  const sourceIdentity = Object.entries(data).find(([key]) => /concerncode/i.test(key))?.[1];
  if (!kvk && !sourceIdentity) return null;
  const metricIdentity = metric.toLocaleLowerCase('nl-NL').replace(/20\d{2}/g, 'boekjaar').replace(/[^a-z0-9]+/g, '_');
  return semanticHash({ organization: kvk ? String(kvk).replace(/\D/g, '') : sourceIdentity, metric: metricIdentity });
}

function buildCareComparisons(recordsByYear) {
  const years = [...recordsByYear.keys()].sort((a, b) => b - a); if (years.length < 2) return [];
  const [currentYear, previousYear] = years;
  const collect = records => { const result = new Map(); for (const record of records || []) for (const [metric, value] of Object.entries(record.data || {})) {
    if (/kvk|rsin|postcode|huisnummer|boekjaar|datum|concerncode|organizationid|(^|_)id($|_)/i.test(metric)) continue;
    const context = `${record.sheet} ${metric}`;
    if (!/omzet|resultaat|baten|lasten|opbreng|kosten|vermogen|bezoldig|inkomen|wnt|continu|financ|liquid|schuld|verlies|winst/i.test(context)) continue;
    const numeric = numberValue(value); const key = careComparisonKey(record, metric); if (numeric === null || !key) continue;
    result.set(key, [...(result.get(key) || []), { record, metric, numeric }]);
  } return result; };
  const previous = collect(recordsByYear.get(previousYear)); const current = collect(recordsByYear.get(currentYear)); const comparisons = [];
  for (const [key, currentMatches] of current) {
    const previousMatches = previous.get(key); if (currentMatches.length !== 1 || previousMatches?.length !== 1 || previousMatches[0].numeric === 0) continue;
    const { record, metric, numeric } = currentMatches[0]; const old = previousMatches[0];
    const absoluteChange = numeric - old.numeric; const relativeChange = absoluteChange / Math.abs(old.numeric);
    const kvk = record.data._resolved_kvk || Object.entries(record.data).find(([name]) => /kvk|handelsregister/i.test(name))?.[1];
    const organization = record.data._resolved_name || record.data.naam || record.data.handelsnaam || Object.entries(record.data).find(([name]) => /(^|_)naam(_|$)|naam_name/i.test(name))?.[1] || `KVK ${kvk}`;
    const comparison = { kind: 'care-yoy', organization, metric, previousYear, currentYear, previousValue: old.numeric,
      currentValue: numeric, absoluteChange, relativeChange };
    comparisons.push({ ...record, sourceKey: `care:yoy:${key}`, comparison, semanticFields: comparison });
  }
  return comparisons;
}

function careOrganization(record) {
  const data = record.data || {}; const kvk = data._resolved_kvk || Object.entries(data).find(([key]) => /kvk|handelsregister/i.test(key) && data[key])?.[1];
  const name = data._resolved_name || data.naam || data.handelsnaam || Object.entries(data).find(([key]) => /(^|_)naam(_|$)|naam_name/i.test(key) && data[key])?.[1] || `Zorgaanbieder KVK ${kvk}`;
  return { name, kvk, sourceUrl: record.sourceUrl, sourceKey: record.sourceKey };
}

function rememberCareIdentity(identityMap, record) {
  const data = record.data || {};
  const sourceIdentity = Object.entries(data).find(([key]) => /concerncode/i.test(key))?.[1];
  const kvk = Object.entries(data).find(([key]) => /kvk|handelsregister/i.test(key))?.[1];
  const name = data.naam_name || data.handelsnaam || Object.entries(data)
    .find(([key]) => /naam van de organisatie.*geregistreerd/i.test(key))?.[1];
  if (!sourceIdentity || !kvk || !name || identityMap.has(sourceIdentity)) return false;
  identityMap.set(sourceIdentity, { kvk: String(kvk).replace(/\D/g, ''), name: String(name) });
  return true;
}

function dpiIdentity(record) {
  const d = record.data || {}; return semanticHash({ kvk: d.kvk_nummer, institutionType: d.soort_instelling, daeb: d.daeb_indicatie, targetYear: d.jaar,
    metric: d.omschrijving, type: d.type_veld, municipality: d.gemeente });
}

function buildDpiComparisons(previousRecords, currentRecords, previousYear, currentYear) {
  const group = records => { const result = new Map(); for (const record of records) { const key = dpiIdentity(record); result.set(key, [...(result.get(key) || []), record]); } return result; };
  const previous = group(previousRecords); const current = group(currentRecords);
  return currentRecords.flatMap(record => {
    const key = dpiIdentity(record); if (current.get(key)?.[0] !== record || current.get(key)?.length !== 1 || previous.get(key)?.length !== 1) return [];
    const old = previous.get(key)[0]; const currentValue = numberValue(record.data?.waarde); const previousValue = numberValue(old?.data?.waarde);
    if (!old || currentValue === null || previousValue === null) return [];
    const absoluteChange = currentValue - previousValue; const relativeChange = previousValue === 0 ? null : absoluteChange / Math.abs(previousValue);
    const comparison = { kind: 'dpi-yoy', organization: `KVK ${record.data.kvk_nummer}`, municipality: record.data.gemeente,
      metric: record.data.omschrijving, targetYear: record.data.jaar, previousYear, currentYear, previousValue, currentValue,
      absoluteChange, relativeChange, previousUrl: old.sourceUrl };
    return [{ ...record, sourceKey: `dpi:yoy:${dpiIdentity(record)}`, comparison, semanticFields: comparison }];
  });
}

async function recordBacktest(db, dryRun, testName, periodFrom, periodTo, detectorVersion, comparisons, qualifies) {
  const signals = comparisons.filter(qualifies).length;
  const metrics = { periodFrom, periodTo, comparisons: comparisons.length, signals, suppressed: comparisons.length - signals };
  if (!dryRun) await db.execute({ sql: `INSERT INTO phase4_backtests
    (test_name,period_from,period_to,detector_version,input_count,signal_count,suppressed_count,metrics_json)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(test_name,period_from,period_to,detector_version) DO UPDATE SET
    input_count=excluded.input_count,signal_count=excluded.signal_count,suppressed_count=excluded.suppressed_count,metrics_json=excluded.metrics_json`,
    args: [testName, String(periodFrom), String(periodTo), detectorVersion, comparisons.length, signals, comparisons.length - signals, JSON.stringify(metrics)] });
  return metrics;
}

function eventForMonument(changeType, record, previous) {
  const data = record.data || {};
  const monument = data.monumentnummer || data.monument_nummer || data.rijksmonumentnummer || record.sourceKey;
  const type = changeType === 'added' ? 'MONUMENT_ADDED' : changeType === 'removed' ? 'MONUMENT_REMOVED' : 'MONUMENT_RECORD_CHANGED';
  return { type, changeType, title: `Rijksmonument ${changeType === 'added' ? 'toegevoegd' : changeType === 'removed' ? 'afgevoerd' : 'gewijzigd'}: ${monument}`,
    summary: `${data.straat || data.adres || ''} ${data.huisnummer || ''}, ${data.plaats || data.woonplaats || data.gemeente || ''}`.trim(),
    changedFields: previous ? changedFields(previous.data, data, Object.keys(data)) : [], evidence: [record.sourceUrl, ...record.localMatch.evidence],
    journalisticallyRelevant: true, uncertainty: changeType === 'removed' ? 'Afvoering is pas na twee volledige succesvolle extracts bevestigd.' : null };
}

function eventForSeveso(changeType, record, previous, entityId) {
  const data = record.data || {};
  if (record.kind === 'inspection') return { type: 'SEVESO_INSPECTION_PUBLISHED', changeType,
    title: `SEVESO-inspectiesamenvatting: ${data.naam}`, summary: `${data.inspectiedatum}; openbare samenvatting bij de lokale inrichting.`,
    changedFields: [], entityId, entityConfidence: 1, entityEvidence: record.localMatch.evidence.join('; '),
    evidence: [record.sourceUrl, data.detail_url], journalisticallyRelevant: true,
    uncertainty: 'De openbare samenvatting verschijnt na een zienswijzeprocedure en kan weken na de inspectie volgen.' };
  if (record.kind === 'compliance') return { type: 'SEVESO_VIOLATION_RECORDED', changeType,
    title: `SEVESO-nalevingslijst gewijzigd: ${data.naam}`, summary: data.regel,
    changedFields: previous ? ['regel'] : [], entityId, entityConfidence: 1, entityEvidence: record.localMatch.evidence.join('; '),
    evidence: [record.sourceUrl, data.regel], journalisticallyRelevant: true,
    uncertainty: 'De lijst kan meerdere inspecties optellen; lege velden betekenen dat nog geen inspectieresultaten beschikbaar zijn.' };
  const type = changeType === 'added' ? 'SEVESO_SITE_ADDED' : 'SEVESO_SITE_CHANGED';
  return { type, changeType, title: `SEVESO-inrichting ${changeType === 'added' ? 'in lokale lijst' : 'gewijzigd'}: ${data.naam_inrichting || data.naam || record.sourceKey}`,
    summary: `${data.verplichting || data.ld_hd || 'drempel onbekend'}; ${data.straat || ''} ${data.nr || data.huisnummer || ''}, ${data.plaats || data.gemeente || ''}`,
    changedFields: previous ? changedFields(previous.data, data, Object.keys(data)) : [], entityId, entityConfidence: 0.95,
    entityEvidence: record.localMatch.evidence.join('; '), evidence: [record.sourceUrl, ...record.localMatch.evidence], journalisticallyRelevant: true,
    uncertainty: 'Vermelding kan een vergunde, administratieve of gestopte locatie zonder actuele Seveso-activiteit betreffen.' };
}

async function pdfTextLines(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  for (let page = 1; page <= document.numPages; page++) {
    const content = await (await document.getPage(page)).getTextContent(); let line = '';
    for (const item of content.items) { line += `${item.str || ''} `; if (item.hasEOL) { if (normalizeText(line)) lines.push(normalizeText(line)); line = ''; } }
    if (normalizeText(line)) lines.push(normalizeText(line));
  }
  return lines;
}

function findName(data) { return data.naam_inrichting || data.naam || data.inrichting || Object.entries(data).find(([key]) => /naam.*inrichting/i.test(key))?.[1]; }
function siteNameMatches(left, right) {
  const tokens = value => new Set(normalizeText(value).toLocaleLowerCase('nl-NL').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(token => token.length > 1 && !['bv','nv'].includes(token)));
  const a = tokens(left); const b = tokens(right); const overlap = [...a].filter(token => b.has(token)).length;
  return overlap >= 2 && overlap / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
}

async function ensureSevesoEntity(db, record, sourceId, dryRun) {
  if (dryRun) return null; const data = record.data || {}; const name = data.naam || findName(data) || record.sourceKey;
  const entityId = await require('../phase3-core.cjs').ensureOrganization(db, { name, sourceUrl: record.sourceUrl, sourceKey: record.sourceKey }, sourceId, record.sourceKey, false);
  const city = data.plaats || data.gemeente; if (!/^(amersfoort|leusden)$/i.test(normalizeText(city))) return entityId;
  const street = data.straat || data.adres || ''; const house = data.nr || data.huisnummer || ''; const postal = normalizeText(data.postcode).replace(/\s/g, '').toUpperCase();
  let location = await db.execute({ sql: `SELECT id FROM locations WHERE city=? AND street=? AND house_number=? LIMIT 1`, args: [city, street, house] });
  if (!location.rows.length) location = await db.execute({ sql: `INSERT INTO locations(label,street,house_number,postal_code,city,municipality) VALUES (?,?,?,?,?,?) RETURNING id`,
    args: [`${street} ${house}, ${city}`.trim(), street, house, postal, city, city] });
  await db.execute({ sql: `INSERT OR IGNORE INTO entity_locations(entity_id,location_id,relation_type,valid_from,source_url) VALUES (?,?,'vestiging',datetime('now'),?)`,
    args: [entityId, Number(location.rows[0].id), record.sourceUrl] });
  return entityId;
}

class CareAccountabilityAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; this.stats = null; }
  async run() {
    const landing = await fetchBuffer(CARE_PAGE, { fetchImpl: this.fetchImpl, label: 'Jaarverantwoording Zorg landingspagina', accept: 'text/html', allowHtml: true });
    const allYearLinks = discoverLinks(landing.buffer.toString('utf8'), CARE_PAGE, link => /definitieve dataset.*\b20\d{2}\b/i.test(link.text));
    const latestYears = [...new Set(allYearLinks.map(link => yearFromText(link.text)).filter(Boolean))].sort((a, b) => b - a).slice(0, 2);
    if (latestYears.length < 2) throw new Error('Jaarverantwoording Zorg schemadrift: twee definitieve boekjaren ontbreken');
    const yearLinks = allYearLinks.filter(link => latestYears.includes(yearFromText(link.text)));
    if (yearLinks.length < 2) throw new Error('Jaarverantwoording Zorg schemadrift: definitieve datasets 2024/2023 ontbreken');
    const downloadLinks = [];
    for (const link of yearLinks) {
      const detail = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: `Jaarverantwoording ${link.text}`, accept: 'text/html', allowHtml: true });
      const files = discoverLinks(detail.buffer.toString('utf8'), link.href, item => /download/i.test(item.text) && /\.ods(?:\?|$)/i.test(item.href));
      if (!files.length) throw new Error(`Jaarverantwoording Zorg schemadrift: geen ODS-download voor ${link.text}`);
      files.forEach(file => downloadLinks.push({ ...file, year: yearFromText(link.text) }));
    }
    // Lees het nieuwste boekjaar eerst: de identificatietabel daarvan levert de
    // concerncodes waarmee financiële tabellen (ook historisch) hard gekoppeld worden.
    downloadLinks.sort((left, right) => right.year - left.year || left.text.localeCompare(right.text, 'nl'));
    const identity = await loadLocalIdentity(this.db); const localSourceIds = new Set();
    const parts = []; const sourceIdentityMap = new Map();
    let nationalRows = 0;
    const records = []; const recordsByYear = new Map();
    for (const link of downloadLinks) {
      const fetched = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: `Jaarverantwoording Zorg ${link.year}`, accept: 'application/vnd.oasis.opendocument.spreadsheet', timeoutMs: 240_000 });
      const sheets = await parseOdsFiltered(fetched.buffer, { localKvks: identity.kvks, localSourceIds }); nationalRows += sheets.totalRows || sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
      const local = tabularLocalRecords(sheets, { prefix: `care:${link.year}`, sourceUrl: fetched.url, localKvks: identity.kvks, localSourceIds });
      for (const record of local) { const kvk = Object.entries(record.data || {}).find(([key]) => /kvk|handelsregister/i.test(key))?.[1]; if (kvk) identity.kvks.add(String(kvk).replace(/\D/g, '')); }
      for (const record of local) rememberCareIdentity(sourceIdentityMap, record);
      for (const record of local) {
        const sourceIdentity = Object.entries(record.data || {}).find(([key]) => /concerncode/i.test(key))?.[1]; const resolved = sourceIdentityMap.get(sourceIdentity);
        if (resolved) { record.data._resolved_kvk = resolved.kvk; record.data._resolved_name = resolved.name; record.semanticFields = record.data; }
      }
      records.push(...local); recordsByYear.set(link.year, [...(recordsByYear.get(link.year) || []), ...local]); parts.push({ fetched, year: link.year });
    }
    const comparisons = buildCareComparisons(recordsByYear); records.push(...comparisons);
    if (nationalRows < 1000) throw new Error(`Jaarverantwoording Zorg verdacht klein: ${nationalRows} tabelrijen`);
    const sourceId = await ensureSource(this.db, METAS.care, this.dryRun); await archiveParts(this.db, sourceId, METAS.care, parts, this.dryRun);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.care, records, fetched: aggregateFetch(parts, CARE_PAGE), minimumRecords: 1,
      ensureEntity: record => require('../phase3-core.cjs').ensureOrganization(this.db, careOrganization(record), sourceId, record.sourceKey, false),
      eventForChange: eventForCare });
    if (result.baseline && !this.dryRun) for (const record of new Map(records.filter(record => careOrganization(record).kvk).map(record => [careOrganization(record).kvk, record])).values())
      await require('../phase3-core.cjs').ensureOrganization(this.db, careOrganization(record), sourceId, record.sourceKey, false);
    const backtest = await recordBacktest(this.db, this.dryRun, 'zorg-r15', latestYears[1], latestYears[0], 'R15-1.0.0', comparisons,
      record => Math.abs(record.comparison.absoluteChange) >= 250000 && Math.abs(record.comparison.relativeChange) >= 0.15);
    this.sourceId = result.sourceId; this.stats = { nationalRows, local: records.length - comparisons.length, comparisons: comparisons.length, sourceIdentities: localSourceIds.size, files: parts.length, backtest }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.local > 0 ? { status: 'ok', message: `${this.stats.local} lokale zorgregels uit ${this.stats.files} officiële ODS-bestanden` } : { status: 'error', message: 'Geen lokale zorgregels na harde plaats/KVK-filtering' }; }
}

class DpiHousingAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; this.stats = null; }
  async run() {
    const datasets = [];
    for (const [year, pageUrl] of [[2024, DPI_PREVIOUS_PAGE], [2025, DPI_PAGE]]) {
      const page = await fetchBuffer(pageUrl, { fetchImpl: this.fetchImpl, label: `dPi ${year} datasetcatalogus`, accept: 'text/html', allowHtml: true });
      const link = discoverLinks(page.buffer.toString('utf8'), pageUrl, item => /\.xlsx(?:\?|$)/i.test(item.href))[0];
      if (!link) throw new Error(`dPi schemadrift: XLSX-download ${year} ontbreekt`);
      const fetched = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: `dPi ${year} XLSX`, accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', timeoutMs: 180_000 });
      const sheets = parseXlsx(fetched.buffer); const records = tabularLocalRecords(sheets, { prefix: `dpi:${year}`, sourceUrl: fetched.url });
      datasets.push({ year, fetched, sheets, records });
    }
    const previous = datasets[0]; const current = datasets[1];
    const comparisons = buildDpiComparisons(previous.records, current.records, previous.year, current.year);
    const records = [...previous.records, ...current.records, ...comparisons]; const fetched = aggregateFetch(datasets, DPI_PAGE);
    const sheets = current.sheets;
    const nationalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    if (nationalRows < 100) throw new Error(`dPi verdacht klein: ${nationalRows} tabelrijen`);
    const sourceId = await ensureSource(this.db, METAS.dpi, this.dryRun); await archiveParts(this.db, sourceId, METAS.dpi, datasets, this.dryRun);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.dpi, records, fetched, minimumRecords: 1,
      ensureEntity: record => require('../phase3-core.cjs').ensureOrganization(this.db, { name: record.comparison?.organization || `Woningcorporatie KVK ${record.data.kvk_nummer}`,
        kvk: record.data.kvk_nummer, sourceUrl: record.sourceUrl, sourceKey: record.sourceKey }, sourceId, record.sourceKey, false),
      eventForChange: eventForDpi });
    if (result.baseline && !this.dryRun) for (const record of new Map(current.records.map(record => [record.data.kvk_nummer, record])).values())
      await require('../phase3-core.cjs').ensureOrganization(this.db, { name: `Woningcorporatie KVK ${record.data.kvk_nummer}`, kvk: record.data.kvk_nummer,
        sourceUrl: record.sourceUrl, sourceKey: record.sourceKey }, sourceId, record.sourceKey, false);
    const backtest = await recordBacktest(this.db, this.dryRun, 'dpi-r16', previous.year, current.year, 'R16-1.0.0', comparisons,
      record => Math.abs(record.comparison.absoluteChange) >= 25 || (Math.abs(record.comparison.absoluteChange) >= 10 && Math.abs(record.comparison.relativeChange || 0) >= 0.20));
    this.sourceId = result.sourceId; this.stats = { nationalRows, local: current.records.length, historicalLocal: previous.records.length, comparisons: comparisons.length, sheets: sheets.length, backtest }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.local > 0 ? { status: 'ok', message: `${this.stats.local} lokale dPi-regels, exact op gemeente/code` } : { status: 'error', message: 'Geen lokale dPi-regels na exact gemeentefilter' }; }
}

function rowsFromMonumentZip(buffer, sourceUrl) {
  const entries = zipEntries(buffer); const records = [];
  for (const [name, data] of entries) {
    if (/\.csv$/i.test(name)) {
      for (const delimiter of [';', ',', '\t']) {
        try {
          const rows = parseDelimited(data.toString('utf8'), delimiter);
          if (!rows.length) continue;
          rows.forEach((row, index) => { const match = localRowMatch(row); if (match.local) records.push({ sourceKey: `monument:${row.monumentnummer || row.Monumentnummer || semanticHash(row).slice(0, 20)}`, data: row, row: index + 1, localMatch: match, sourceUrl, semanticFields: row }); });
          break;
        } catch { /* probeer volgende delimiter */ }
      }
    }
  }
  if (records.length) return records;
  const xmlFiles = [...entries].filter(([name]) => /\.xml$/i.test(name));
  for (const [, data] of xmlFiles) {
    const $ = load(data.toString('utf8'), { xmlMode: true });
    $('Monument,monument,MonumentRecord,record').each((index, element) => {
      const row = {}; $(element).find('*').each((_, child) => { const key = child.name?.replace(/^.*:/, ''); if (key && !row[key]) row[key] = normalizeText($(child).text()); });
      const match = localRowMatch(row); if (!match.local) return;
      const number = row.Monumentnummer || row.monumentnummer || row.MonumentNr || semanticHash(row).slice(0, 20);
      records.push({ sourceKey: `monument:${number}`, data: row, row: index + 1, localMatch: match, sourceUrl, semanticFields: row });
    });
  }
  return records;
}

class RijksmonumentenAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; this.stats = null; }
  async run() {
    const boundaryFetch = await fetchBuffer(BOUNDARY_URL, { fetchImpl: this.fetchImpl, label: 'PDOK gemeentegrenzen monumenten', accept: 'application/geo+json' });
    const boundaryJson = JSON.parse(boundaryFetch.buffer.toString('utf8')); const boundaries = (boundaryJson.features || []).filter(feature => ['GM0307','GM0327'].includes(feature.properties?.gm_code));
    if (boundaries.length !== 2) throw new Error(`Rijksmonumenten: ${boundaries.length} lokale gemeentegrenzen, verwacht 2`);
    const pages = []; const features = []; let nextUrl = MONUMENT_API;
    for (let page = 0; nextUrl && page < 20; page++) {
      const fetchedPage = await fetchBuffer(nextUrl, { fetchImpl: this.fetchImpl, label: `Rijksmonumenten OGC pagina ${page + 1}`, accept: 'application/geo+json' });
      const payload = JSON.parse(fetchedPage.buffer.toString('utf8')); if (!Array.isArray(payload.features)) throw new Error('Rijksmonumenten OGC-schemadrift: features ontbreekt');
      features.push(...payload.features); pages.push(fetchedPage); nextUrl = payload.links?.find(link => link.rel === 'next')?.href || null;
    }
    if (nextUrl) throw new Error('Rijksmonumenten OGC-paginering overschrijdt veiligheidslimiet');
    const records = features.filter(feature => feature.properties?.namespace === 'nlps-rijksmonumenten')
      .map(feature => ({ feature, boundary: boundaries.find(boundary => pointInGeometry(feature.geometry?.coordinates, boundary.geometry)) })).filter(item => item.boundary)
      .map(({ feature, boundary }) => { const p = feature.properties || {}; const monument = /\/monumenten\/(\d+)/.exec(p.ci_citation || '')?.[1] || p.localid;
        const record = { sourceKey: `monument:${monument}`, data: { monumentnummer: monument, citation: p.ci_citation, localid: p.localid, designation: p.designation,
          legalfoundationdate: p.legalfoundationdate, versionid: p.versionid, geometry: feature.geometry, municipality: boundary.properties?.gm_naam },
          localMatch: { method: 'official_polygon', evidence: [`gemeente=${boundary.properties?.gm_naam}`, `monument=${monument}`] }, sourceUrl: p.ci_citation || MONUMENT_PAGE };
        record.semanticFields = record.data; return record; });
    if (records.length < 100) throw new Error(`Rijksmonumentenregister lokale selectie verdacht klein: ${records.length}`);
    const sourceId = await ensureSource(this.db, METAS.monument, this.dryRun); await archiveParts(this.db, sourceId, METAS.monument, pages.map(fetched => ({ fetched })), this.dryRun);
    const aggregate = { buffer: Buffer.from(JSON.stringify({ pages: pages.map(page => page.url), features: features.length })), url: MONUMENT_API, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.monument, records, fetched: aggregate, minimumRecords: 100, eventForChange: eventForMonument });
    this.sourceId = result.sourceId; this.stats = { local: records.length, nationalWindow: features.length, pages: pages.length }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.local >= 100 ? { status: 'ok', message: `${this.stats.local} lokale rijksmonumenten met officiële identiteit` } : { status: 'error', message: 'Rijksmonumentenextract niet valide' }; }
}

class SevesoScopeAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; this.stats = null; }
  async run() {
    const page = await fetchBuffer(SEVESO_PAGE, { fetchImpl: this.fetchImpl, label: 'SEVESO+ inrichtingenpagina', accept: 'text/html', allowHtml: true });
    const link = discoverLinks(page.buffer.toString('utf8'), SEVESO_PAGE, item => /\.xlsx(?:\?|$)/i.test(item.href))[0];
    if (!link) throw new Error('SEVESO+ schemadrift: actuele XLSX-link ontbreekt');
    const fetched = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: 'SEVESO+ inrichtingenlijst', accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const sheets = parseXlsx(fetched.buffer); const nationalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    const siteRecords = tabularLocalRecords(sheets, { prefix: 'seveso', sourceUrl: fetched.url }).map(record => {
      const data = { ...record.data };
      if (/^\d+$/.test(data.naam_inrichting || '') && data._kolom_1) { data.volgnummer = data.naam_inrichting; data.naam_inrichting = data._kolom_1; delete data._kolom_1; }
      const sourceKey = `seveso:${semanticHash({ name: data.naam_inrichting, address: data.adres || data.straat, number: data.nr, postal: data.postcode }).slice(0, 24)}`;
      return { ...record, sourceKey, data, semanticFields: data };
    }); const records = [...siteRecords]; const rawParts = [{ fetched }];
    if (nationalRows < 400) throw new Error(`SEVESO+ landelijke lijst verdacht klein: ${nationalRows} rijen`);
    if (siteRecords.length) {
      const compliancePage = await fetchBuffer(SEVESO_COMPLIANCE_PAGE, { fetchImpl: this.fetchImpl, label: 'SEVESO+ nalevingspagina', accept: 'text/html', allowHtml: true }); rawParts.push({ fetched: compliancePage });
      const complianceLink = discoverLinks(compliancePage.buffer.toString('utf8'), SEVESO_COMPLIANCE_PAGE, item => /nalevingslijst.*\.pdf(?:\?|$)/i.test(item.href))[0];
      if (!complianceLink) throw new Error('SEVESO+ schemadrift: nalevingslijst-PDF ontbreekt');
      const compliancePdf = await fetchBuffer(complianceLink.href, { fetchImpl: this.fetchImpl, label: 'SEVESO+ nalevingslijst PDF', accept: 'application/pdf' }); rawParts.push({ fetched: compliancePdf });
      const complianceLines = await pdfTextLines(compliancePdf.buffer);
      for (const site of siteRecords) { const name = normalizeText(findName(site.data)); const line = complianceLines.find(value => siteNameMatches(value, name));
        if (line) { const comparison = { naam: name, regel: line, gemeente: site.data.gemeente || site.data.plaats };
          records.push({ ...site, kind: 'compliance', sourceKey: `seveso:compliance:${semanticHash(name).slice(0, 20)}`, data: comparison, sourceUrl: compliancePdf.url, semanticFields: comparison }); } }
      const detailLinks = new Map();
      for (let page = 0; page < 6; page++) { const regionUrl = page ? `${SEVESO_REGION_PAGE}?pager_page=${page}` : SEVESO_REGION_PAGE;
        const region = await fetchBuffer(regionUrl, { fetchImpl: this.fetchImpl, label: `SEVESO+ regio-index ${page + 1}`, accept: 'text/html', allowHtml: true }); rawParts.push({ fetched: region });
        for (const item of discoverLinks(region.buffer.toString('utf8'), regionUrl)) if (siteRecords.some(site => siteNameMatches(item.text, findName(site.data)))) detailLinks.set(item.href, item);
      }
      for (const item of detailLinks.values()) { const detail = await fetchBuffer(item.href, { fetchImpl: this.fetchImpl, label: `SEVESO+ detail ${item.text}`, accept: 'text/html', allowHtml: true }); rawParts.push({ fetched: detail });
        const inspectionLinks = discoverLinks(detail.buffer.toString('utf8'), item.href, linkItem => /20\d{2}/.test(linkItem.text) && /\.pdf(?:\?|$)/i.test(linkItem.href));
        for (const inspection of inspectionLinks) { const pdf = await fetchBuffer(inspection.href, { fetchImpl: this.fetchImpl, label: `SEVESO+ inspectie ${inspection.text}`, accept: 'application/pdf' }); rawParts.push({ fetched: pdf });
          const lines = await pdfTextLines(pdf.buffer); const date = normalizeText(inspection.text).replace(/\s*\(.*$/, ''); const site = siteRecords.find(record => siteNameMatches(item.text, findName(record.data))) || siteRecords[0];
          const data = { naam: normalizeText(item.text), inspectiedatum: date, detail_url: item.href, gemeente: site.data.gemeente || site.data.plaats, samenvatting: lines.join(' ').slice(0, 12000) };
          records.push({ ...site, kind: 'inspection', sourceKey: `seveso:inspection:${semanticHash(inspection.href).slice(0, 24)}`, data, sourceUrl: pdf.url, semanticFields: data }); }
      }
    }
    const sourceId = await ensureSource(this.db, METAS.seveso, this.dryRun); await archiveParts(this.db, sourceId, METAS.seveso, rawParts, this.dryRun);
    const aggregate = aggregateFetch(rawParts, SEVESO_PAGE);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.seveso, records, fetched: aggregate, minimumRecords: 0,
      ensureEntity: record => ensureSevesoEntity(this.db, record, sourceId, this.dryRun), eventForChange: eventForSeveso });
    if (result.baseline && !this.dryRun) for (const record of siteRecords) await ensureSevesoEntity(this.db, record, sourceId, false);
    this.sourceId = result.sourceId; this.stats = { nationalRows, local: siteRecords.length, compliance: records.filter(record => record.kind === 'compliance').length,
      inspections: records.filter(record => record.kind === 'inspection').length, scope: siteRecords.length ? 'local-sites' : 'monthly-scope-check-only' }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.nationalRows >= 400 ? { status: 'ok', message: this.stats.local ? `${this.stats.local} lokale SEVESO-locaties` : 'Volledige maandlijst valide; geen lokale inrichting, goedkope scopecheck actief' } : { status: 'error', message: 'SEVESO+ landelijke lijst niet valide' }; }
}

module.exports = {
  CARE_PAGE, DPI_PAGE, DPI_PREVIOUS_PAGE, METAS, MONUMENT_API, MONUMENT_PAGE, SEVESO_COMPLIANCE_PAGE, SEVESO_PAGE, SEVESO_REGION_PAGE,
  CareAccountabilityAdapter, DpiHousingAdapter, RijksmonumentenAdapter, SevesoScopeAdapter,
  buildCareComparisons, buildDpiComparisons, careOrganization, ensureSevesoEntity, eventForCare, eventForDpi, eventForMonument, eventForSeveso, numberValue, pdfTextLines, recordBacktest, rememberCareIdentity, rowsFromMonumentZip, siteNameMatches, yearFromText,
};
