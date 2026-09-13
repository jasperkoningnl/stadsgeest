const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const {
  changedFields, ensureOrganization, fetchBuffer, normalizeText, parseDelimited,
  requireColumns, runVersionedDataset,
} = require('../phase3-core.cjs');
const { BOUNDARY_URL, pointInGeometry } = require('./ndw-planning.cjs');

const SOURCE_URL = 'https://projecten.rvo.nl/nl';
const CSV_URL = 'https://projecten.rvo.nl/sites/default/files/exported_projects_nl.csv';
const VERSION = '1.0.0';
const META = {
  name: 'RVO — Projectendatabase', url: SOURCE_URL, sourceClass: 'AUTHORITATIVE_REGISTER', version: VERSION,
  frequency: 'weekly', category: 'registry', lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13', ownerContact: null,
  manifest: { owner: 'Rijksdienst voor Ondernemend Nederland', license: 'openbare projectendatabase', discovery_page: SOURCE_URL,
    identity: 'Projectnummer', local_filter: 'coördinaten binnen doelgebied of expliciete plaats in projectvelden',
    semantic_fields: ['title', 'description', 'applicant', 'scheme', 'status', 'budget', 'partners'], removal_confirmation_runs: 2 },
};

function numberNl(value) {
  const normalized = normalizeText(value).replace(/^="?/, '').replace(/"?$/, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const number = Number(normalized); return Number.isFinite(number) ? number : null;
}

function isLocalProject(row, boundaries = [], watchlist = new Set(), graphNames = null) {
  const lat = numberNl(row.Latitude), lon = numberNl(row.Longitude);
  const inBounds = lat !== null && lon !== null && boundaries.some(feature => pointInGeometry([lon, lat], feature.geometry));
  const explicit = /\b(amersfoort|leusden)\b/i.test([row.Projecttitel, row.Projectbeschrijving, row.Aanvrager, row.Partners].join(' '));
  const applicant = normalizeText(row.Aanvrager); const partners = normalizeText(row.Partners);
  const kvk = applicant.split('|')[0].replace(/\s/g, '');
  const names = graphNames || [...watchlist].filter(value => value.startsWith('name:')).map(value => value.slice(5));
  const graphMatch = (kvk && watchlist.has(`kvk:${kvk}`)) || names.some(name =>
    [applicant, partners].some(text => text.toLocaleLowerCase('nl-NL').includes(name)));
  return inBounds || explicit || graphMatch;
}

function parseRvoCsv(text, boundaries = [], watchlist = new Set()) {
  const rows = parseDelimited(text, ';');
  requireColumns(rows, ['Projectnummer', 'Projecttitel', 'Projectbeschrijving', 'Aanvrager', 'SubsidieRegeling', 'Status', 'Budget', 'Latitude', 'Longitude', 'Partners', 'Gewijzigd', 'URL alias'], 'RVO-projecten');
  const graphNames = [...watchlist].filter(value => value.startsWith('name:')).map(value => value.slice(5));
  return rows.filter(row => isLocalProject(row, boundaries, watchlist, graphNames)).map(row => {
    const [kvkCandidate, ...nameParts] = normalizeText(row.Aanvrager).split('|');
    const kvk = /^\d{8}$/.test(kvkCandidate) ? kvkCandidate : '';
    const applicant = kvk ? nameParts.join('|') : normalizeText(row.Aanvrager);
    const alias = normalizeText(row['URL alias']);
    const sourceUrl = alias ? new URL(alias, SOURCE_URL).href : SOURCE_URL;
    const record = { sourceKey: `rvo:${normalizeText(row.Projectnummer)}`, projectNumber: normalizeText(row.Projectnummer),
      name: applicant || normalizeText(row.Projecttitel), applicant, kvk, aliases: [], title: normalizeText(row.Projecttitel),
      description: normalizeText(row.Projectbeschrijving), scheme: normalizeText(row.SubsidieRegeling), status: normalizeText(row.Status),
      budget: numberNl(row.Budget), currency: normalizeText(row.BudgetValuta) || 'EUR', latitude: numberNl(row.Latitude),
      longitude: numberNl(row.Longitude), partners: normalizeText(row.Partners), year: Number(row.Jaar) || null,
      publishedAt: normalizeText(row.Publicatiedatum), modifiedAt: normalizeText(row.Gewijzigd), sourceUrl };
    record.semanticFields = { title: record.title, description: record.description, applicant: record.applicant, kvk: record.kvk,
      scheme: record.scheme, status: record.status, budget: record.budget, partners: record.partners };
    return record;
  });
}

async function loadLocalOrganizationWatchlist(db) {
  const result = await db.execute(`SELECT DISTINCT ka.normalized_alias value
    FROM kg_aliases ka JOIN kg_entities ke ON ke.id=ka.entity_id
    WHERE ke.entity_type='organization' AND length(ka.normalized_alias)>=5 AND (
      ke.source_org_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM entity_locations el JOIN locations l ON l.id=el.location_id
        WHERE el.entity_id=ke.id AND lower(l.city) IN ('amersfoort','leusden')))`);
  const identifiers = await db.execute(`SELECT DISTINCT ei.identifier_type,ei.value
    FROM entity_identifiers ei JOIN kg_entities ke ON ke.id=ei.entity_id
    WHERE ei.identifier_type='kvk' AND (ke.source_org_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM entity_locations el JOIN locations l ON l.id=el.location_id
      WHERE el.entity_id=ke.id AND lower(l.city) IN ('amersfoort','leusden')))`);
  return new Set([...result.rows.map(row => `name:${normalizeText(row.value).toLocaleLowerCase('nl-NL')}`),
    ...identifiers.rows.map(row => `kvk:${String(row.value).replace(/\s/g, '')}`)]);
}

function eventForChange(changeType, record, previous, entityId) {
  const fields = previous ? changedFields(previous, record, ['title', 'description', 'applicant', 'scheme', 'status', 'budget', 'partners']) : [];
  return { type: ({ added: 'RVO_PROJECT_ADDED', changed: fields.includes('budget') ? 'RVO_FUNDING_CHANGED' : 'RVO_PROJECT_CHANGED', removed: 'RVO_PROJECT_REMOVED' })[changeType],
    changeType, entityId, changedFields: fields,
    title: `RVO-project ${changeType === 'added' ? 'toegevoegd' : changeType === 'removed' ? 'verdwenen na bevestiging' : 'gewijzigd'}: ${record.title}`,
    summary: `${record.applicant}; ${record.scheme}; budget ${record.budget ?? 'onbekend'} ${record.currency}.${fields.length ? ` Gewijzigd: ${fields.join(', ')}.` : ''}`,
    evidence: [record.projectNumber, record.applicant, record.scheme, String(record.budget ?? '')],
    journalisticallyRelevant: changeType !== 'removed' && (record.budget === null || record.budget >= 100000 || fields.includes('status')),
    uncertainty: 'Projectlocatie volgt uit broncoördinaten of expliciete plaatsvermelding; landelijke consortia vereisen redactionele controle.',
    entityEvidence: record.kvk ? 'RVO-aanvrager met openbaar KVK-nummer' : 'RVO-aanvrager; naamkoppeling niet automatisch samengevoegd' };
}

class RvoProjectenAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; }
  async run() {
    const [page, boundary] = await Promise.all([
      fetchBuffer(SOURCE_URL, { fetchImpl: this.fetchImpl, label: 'RVO projectpagina', allowHtml: true, rejectHtml: false, timeoutMs: 45_000 }),
      fetchBuffer(BOUNDARY_URL, { fetchImpl: this.fetchImpl, label: 'PDOK gemeentegrenzen', accept: 'application/geo+json', timeoutMs: 60_000 }),
    ]);
    const geojson = JSON.parse(boundary.buffer.toString('utf8'));
    geojson.features = (geojson.features || []).filter(feature => ['GM0307', 'GM0327'].includes(feature.properties?.gm_code || feature.properties?.gemeentecode));
    if (geojson.features.length !== 2) throw new Error(`PDOK gaf ${geojson.features.length} lokale gemeentegrenzen; verwacht 2`);
    const html = page.buffer.toString('utf8');
    const discovered = html.match(/href=["']([^"']*exported_projects[^"']*\.csv[^"']*)/i);
    const downloadUrl = discovered ? new URL(discovered[1].replace(/&amp;/g, '&'), SOURCE_URL).href : CSV_URL;
    const fetched = await fetchBuffer(downloadUrl, { fetchImpl: this.fetchImpl, label: 'RVO projecten-CSV', accept: 'text/csv', timeoutMs: 180_000 });
    const text = fetched.buffer.toString('utf8'); const nationalRows = parseDelimited(text, ';').length;
    if (nationalRows < 50000) throw new Error(`RVO-export verdacht klein: ${nationalRows} rijen`);
    const watchlist = await loadLocalOrganizationWatchlist(this.db);
    const records = parseRvoCsv(text, geojson.features, watchlist);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records, fetched, minimumRecords: 20,
      eventForChange, ensureEntity: (record, sourceId) => ensureOrganization(this.db, record, sourceId, record.projectNumber, this.dryRun) });
    this.sourceId = result.sourceId; return { ...result, nationalRows, downloadUrl };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: 'RVO-export via actuele projectpagina ontdekt en gevalideerd' }; }
}

module.exports = { CSV_URL, META, RvoProjectenAdapter, eventForChange, isLocalProject, loadLocalOrganizationWatchlist, numberNl, parseRvoCsv };
