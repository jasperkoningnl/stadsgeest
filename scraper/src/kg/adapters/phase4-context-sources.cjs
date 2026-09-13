const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { load } = require('cheerio');
const {
  changedFields, ensureSource, fetchBuffer, normalizeText, runVersionedDataset, semanticHash,
} = require('../phase3-core.cjs');
const { BOUNDARY_URL, pointInGeometry } = require('./ndw-planning.cjs');
const { canonicalEventRecords, discoverLinks, exactLocality } = require('../phase4-core.cjs');

const VERIFIED = '2026-09-13';
const UIT_PAGE = 'https://www.tijdvooramersfoort.nl/nl/evenementen/volledige-uitagenda';
const CALENDAR_PAGE = 'https://www.amersfoort.nl/evenementenkalender';
const RIVM_API = 'https://api-samenmeten.rivm.nl/v1.0';
const GOVERNANCE_PAGES = [
  { organization: 'Stichting Portaal', url: 'https://www.portaal.nl/over-ons/governance/raad-van-commissarissen/', kind: 'TOEZICHTHOUDER' },
  { organization: 'Stichting de Alliantie', url: 'https://www.de-alliantie.nl/over-de-alliantie/wie-we-zijn/de-organisatie/raad-van-commissarissen/', kind: 'TOEZICHTHOUDER' },
];

const METAS = {
  uit: { name: 'Tijd voor Amersfoort — volledige UITagenda', url: UIT_PAGE, sourceClass: 'STRUCTURED_CONTEXT', version: '1.0.0', frequency: 'daily', category: 'data',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'Citymarketing Amersfoort', manifest: { owner: 'Citymarketing Amersfoort', license: 'openbaar raadpleegbare agenda; geen herpublicatie van beeld of volledige beschrijvingen', intended_frequency: 'dagelijks',
      identity: 'officiële agenda-ID + starttijd', local_filter: 'JSON-LD addressLocality exact Amersfoort/Leusden', semantic_fields: ['name','start','end','venue','locality','organizer'], horizon_days: 90, removal_confirmation_runs: 2,
      authority_limit: 'STRUCTURED_CONTEXT; nooit zelfstandig een harde claim' } },
  calendar: { name: 'Gemeente Amersfoort — evenementenkalender', url: CALENDAR_PAGE, sourceClass: 'STRUCTURED_CONTEXT', version: '1.0.0', frequency: 'weekly', category: 'data',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'evenementenvergunningen@amersfoort.nl', manifest: { owner: 'Gemeente Amersfoort', license: 'openbare overheidsinformatie', intended_frequency: 'wekelijks augustus-december, anders maandelijks',
      identity: 'naam + datum + locatie', local_filter: 'kalender is uitsluitend gemeente Amersfoort; Leusden heeft geen vergelijkbare openbare jaarkalender gevonden', semantic_fields: ['name','start','end','location'], removal_confirmation_runs: 2,
      authority_limit: 'registratie is nadrukkelijk geen verleende vergunning' } },
  rivm: { name: 'RIVM Samen Meten — experimenteel', url: RIVM_API, sourceClass: 'MEASUREMENT', version: '1.0.0', frequency: 'hourly', category: 'data',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: 'RIVM Samen Meten', manifest: { owner: 'RIVM / Samen Meten', license: 'open data', intended_frequency: 'ieder uur wanneer STADSGEEST_ENABLE_SAMEN_METEN=1',
      identity: 'SensorThings @iot.id + datastream-id', local_filter: 'punt-in-polygoon op officiële CBS-gemeentegrenzen GM0307/GM0327', semantic_fields: ['latestObservation','quality','phenomenon'],
      authority_limit: 'MEASUREMENT; kandidaat alleen bij >=3 sensoren, >=2 uur, voldoende dekking; altijd review' } },
  governance: { name: 'Openbare governancepagina’s — lokale ankerorganisaties', url: GOVERNANCE_PAGES[0].url, sourceClass: 'DECLARED_BY_ENTITY', version: '1.0.0', frequency: 'weekly', category: 'registry',
    lastVerifiedAt: VERIFIED, termsCheckedAt: VERIFIED, ownerContact: null, manifest: { owner: 'afzonderlijke lokale organisaties', license: 'openbare organisatiepagina’s; alleen feiten en korte bewijsfragmenten bewaren', intended_frequency: 'wekelijks',
      identity: 'organisatie-URL + persoonsnaam + rol', local_filter: 'alleen vooraf vastgelegde lokale ankerorganisaties met openbare bronpagina', semantic_fields: ['person','role','organization'], removal_confirmation_runs: 2,
      person_resolution: 'nooit op naam mergen; brongebonden identiteit en review bij cross-sourcekoppeling' } },
};

function dbClient(config) { return config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN }); }

function eventForAgenda(changeType, record, previous) {
  const fields = previous ? changedFields(previous, record, ['name','start','end','venue','organizer']) : [];
  return { type: record.participants?.length ? 'SPEAKER_APPEARANCE' : changeType === 'changed' ? 'PUBLIC_EVENT_CHANGED' : 'PUBLIC_EVENT_SCHEDULED', changeType,
    title: `Agenda: ${record.name}`, summary: `${record.start}${record.venue ? ` bij ${record.venue}` : ''} in ${record.locality}.`,
    changedFields: fields, evidence: [record.sourceUrl, `${record.venue}, ${record.locality}`, ...(record.participants || [])], journalisticallyRelevant: false,
    uncertainty: 'Agenda-informatie is zachte context en bewijst geen vergunning, doorgang of bijzondere betekenis.' };
}

class UitAgendaAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.maxPages = config.maxPages || 8; this.sourceId = null; this.stats = null; }
  async run() {
    const detailLinks = new Map(); const listingParts = []; const detailParts = [];
    for (let page = 1; page <= this.maxPages; page++) {
      const url = `${UIT_PAGE}?order=asc&page=${page}&sort=calendar`;
      const fetched = await fetchBuffer(url, { fetchImpl: this.fetchImpl, label: `UITagenda pagina ${page}`, accept: 'text/html', allowHtml: true });
      listingParts.push({ url: fetched.url, html: fetched.buffer.toString('utf8') });
      const links = discoverLinks(fetched.buffer.toString('utf8'), url, item => /\/nl\/evenementen\/uitagenda\/\d+\//.test(item.href));
      links.forEach(link => detailLinks.set(link.href, link));
      if (!links.length) break;
    }
    if (detailLinks.size < 20) throw new Error(`UITagenda schemadrift: slechts ${detailLinks.size} detail-URL's`);
    const now = Date.now(); const horizon = now + 90 * 86400000; const records = [];
    for (const link of detailLinks.values()) {
      const fetched = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: 'UITagenda detail', accept: 'text/html', allowHtml: true });
      detailParts.push({ url: fetched.url, html: fetched.buffer.toString('utf8') });
      records.push(...canonicalEventRecords(fetched.buffer.toString('utf8'), fetched.url).filter(record => {
        const time = Date.parse(record.start); return Number.isFinite(time) && time >= now - 86400000 && time <= horizon;
      }));
    }
    const unique = [...new Map(records.map(record => [record.sourceKey, record])).values()];
    if (unique.length < 10) throw new Error(`UITagenda lokale 90-dagenselectie verdacht klein: ${unique.length}`);
    const fetched = { buffer: Buffer.from(JSON.stringify({ listings: listingParts, details: detailParts })), url: UIT_PAGE, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.uit, records: unique, fetched, minimumRecords: 10,
      ensureEntity: async record => {
        if (!record.participants?.length || this.dryRun) return null;
        const found = await this.db.execute({ sql: `SELECT DISTINCT ke.id FROM kg_entities ke
          LEFT JOIN kg_relations kr ON kr.subject_id=ke.id
          LEFT JOIN entity_locations el ON el.entity_id=ke.id
          LEFT JOIN locations l ON l.id=el.location_id
          WHERE ke.entity_type='person' AND lower(ke.canonical_name)=lower(?)
            AND ((kr.id IS NOT NULL AND (kr.valid_until IS NULL OR kr.valid_until>datetime('now'))) OR l.city IN ('Amersfoort','Leusden')) LIMIT 1`, args: [record.participants[0]] });
        return found.rows.length ? Number(found.rows[0].id) : null;
      }, eventForChange: eventForAgenda });
    this.sourceId = result.sourceId; this.stats = { local: unique.length, detailPages: detailLinks.size }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.local >= 10 ? { status: 'ok', message: `${this.stats.local} lokale agenda-optredens via JSON-LD; alleen zachte context` } : { status: 'error', message: 'UITagenda niet valide' }; }
}

async function pdfLines(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const lines = [];
  for (let page = 1; page <= document.numPages; page++) {
    const text = await (await document.getPage(page)).getTextContent(); let line = '';
    for (const item of text.items) { line += `${item.str || ''} `; if (item.hasEOL) { if (normalizeText(line)) lines.push(normalizeText(line)); line = ''; } }
    if (normalizeText(line)) lines.push(normalizeText(line));
  }
  return lines;
}

const MONTHS = { januari:1, februari:2, maart:3, april:4, mei:5, juni:6, juli:7, augustus:8, september:9, oktober:10, november:11, december:12 };
function parseMunicipalCalendar(lines, year, sourceUrl) {
  const text = normalizeText(lines.join(' ')); const monthPattern = Object.keys(MONTHS).join('|');
  const pattern = new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(\\d{1,2})\\s+(${monthPattern})(?:\\s*-\\s*(${monthPattern}))?\\s+(.+?)(?=\\s+\\d{1,2}\\s+\\d{1,2}\\s+(?:${monthPattern})|$)`, 'gi');
  const records = [];
  for (const match of text.matchAll(pattern)) {
    const startDay = Number(match[1]); const endDay = Number(match[2]); const startMonth = MONTHS[match[3].toLowerCase()]; const endMonth = MONTHS[(match[4] || match[3]).toLowerCase()];
    const remainder = normalizeText(match[5]); const chunks = remainder.split(/\s{2,}|\s+[|•]\s+/); const name = chunks[0]; const location = chunks.slice(1).join(' ') || null;
    if (!name || startDay > 31 || endDay > 31) continue;
    const start = new Date(Date.UTC(year, startMonth - 1, startDay)).toISOString(); const end = new Date(Date.UTC(year, endMonth - 1, endDay, 23, 59, 59)).toISOString();
    const record = { sourceKey: `event-calendar:${semanticHash({ name, start, location }).slice(0, 24)}`, name, start, end, location, locality: 'Amersfoort', sourceUrl,
      permitStatus: 'not_granted_by_calendar' };
    record.semanticFields = { name, start, end, location, permitStatus: record.permitStatus }; records.push(record);
  }
  return records;
}

function eventForCalendar(changeType, record, previous) {
  return { type: changeType === 'changed' ? 'EVENT_CALENDAR_CHANGED' : 'EVENT_REGISTERED', changeType, title: `Aangemeld evenement: ${record.name}`,
    summary: `${record.start.slice(0, 10)}${record.location ? `, ${record.location}` : ''}. Opname op de kalender is geen vergunningverlening.`,
    changedFields: previous ? changedFields(previous, record, ['name','start','end','location']) : [], evidence: [record.sourceUrl, 'Gemeente Amersfoort: kalenderregistratie, geen vergunning'],
    journalisticallyRelevant: false, uncertainty: 'EVENT_REGISTERED is geen PERMIT_GRANTED; doorgang en vergunning moeten apart worden bevestigd.' };
}

class MunicipalEventsAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; this.stats = null; }
  async run() {
    const page = await fetchBuffer(CALENDAR_PAGE, { fetchImpl: this.fetchImpl, label: 'Evenementenkalender pagina', accept: 'text/html', allowHtml: true });
    const link = discoverLinks(page.buffer.toString('utf8'), CALENDAR_PAGE, item => /evenementenkalender.*\.pdf(?:\?|$)/i.test(item.href))[0];
    if (!link) throw new Error('Evenementenkalender schemadrift: PDF-link ontbreekt');
    const year = Number(/\b(20\d{2})\b/.exec(`${link.text} ${link.href}`)?.[1]); if (!year) throw new Error('Evenementenkalender jaar ontbreekt');
    const fetched = await fetchBuffer(link.href, { fetchImpl: this.fetchImpl, label: 'Evenementenkalender PDF', accept: 'application/pdf', timeoutMs: 120_000 });
    const lines = await pdfLines(fetched.buffer); const records = parseMunicipalCalendar(lines, year, fetched.url);
    if (records.length < 20) throw new Error(`Evenementenkalender extractie verdacht klein: ${records.length}`);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.calendar, records, fetched, minimumRecords: 20, eventForChange: eventForCalendar });
    this.sourceId = result.sourceId; this.stats = { local: records.length, year }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.local >= 20 ? { status: 'ok', message: `${this.stats.local} aangemelde evenementen ${this.stats.year}; expliciet geen vergunningclaims` } : { status: 'error', message: 'Evenementenkalender niet valide' }; }
}

function extractGovernanceFacts(html, config) {
  const $ = load(String(html)); $('script,style,nav,footer,header').remove(); const records = [];
  const candidates = new Map();
  $('li, h2, h3, h4, td').each((_, element) => {
    const text = normalizeText($(element).text());
    if (!text || text.length > 180 || !/[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+\s+(?:van\s+|de\s+|der\s+|den\s+|ten\s+|[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)/.test(text)) return;
    if (!/voorzitter|commissaris|raad van toezicht|raad van commissarissen|bestuurder|lid raad/i.test(text) && element.tagName === 'li') return;
    const cleaned = text.replace(/^(meneer|mevrouw|dhr\.?|mw\.?)\s+/i, '').replace(/\s*\([^)]*\).*$/, '').replace(/\s*[-–|].*$/, '').trim();
    const name = cleaned.match(/(?:[A-ZÀ-ÖØ-Ý][\p{L}.''’-]+(?:\s+(?:van|de|der|den|ten|ter|het))?){1,5}\s+[A-ZÀ-ÖØ-Ý][\p{L}.''’-]+/u)?.[0];
    if (name && name.length >= 5 && name.split(/\s+/).length >= 2) candidates.set(name, text);
  });
  for (const [person, evidence] of candidates) {
    const role = /voorzitter/i.test(evidence) ? `voorzitter ${config.kind === 'TOEZICHTHOUDER' ? 'toezicht' : 'bestuur'}` : config.kind === 'TOEZICHTHOUDER' ? 'toezichthouder/commissaris' : 'bestuurder';
    const record = { sourceKey: `governance:${semanticHash({ url: config.url, person, role }).slice(0, 24)}`, person, role, organization: config.organization, sourceUrl: config.url,
      evidence: evidence.slice(0, 240), sourceClass: 'DECLARED_BY_ENTITY', confidence: 0.9 };
    record.semanticFields = { person, role, organization: config.organization, evidence: record.evidence }; records.push(record);
  }
  return records;
}

async function ensureGovernanceRelation(db, record, sourceId, dryRun) {
  if (dryRun) return;
  let org = await db.execute({ sql: `SELECT id FROM kg_entities WHERE entity_type='organization' AND lower(canonical_name)=lower(?) LIMIT 1`, args: [record.organization] });
  if (!org.rows.length) org = await db.execute({ sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization',?,lower(?)) RETURNING id`, args: [record.organization, record.organization] });
  const orgId = Number(org.rows[0].id);
  const identifier = `${record.sourceUrl}#${encodeURIComponent(record.person.toLocaleLowerCase('nl-NL'))}`;
  let person = await db.execute({ sql: `SELECT entity_id id FROM entity_identifiers WHERE identifier_type='website' AND value=?`, args: [identifier] });
  if (!person.rows.length) {
    person = await db.execute({ sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('person',?,lower(?)) RETURNING id`, args: [record.person, record.person] });
    await db.execute({ sql: `INSERT INTO entity_identifiers(entity_id,identifier_type,value,source_url,verified_at) VALUES (?,'website',?,?,datetime('now'))`, args: [Number(person.rows[0].id), identifier, record.sourceUrl] });
  }
  const personId = Number(person.rows[0].id);
  const predicate = record.role.includes('toezicht') || record.role.includes('commissaris') ? 'TOEZICHTHOUDER' : 'BESTUURDER';
  const exists = await db.execute({ sql: `SELECT id FROM kg_relations WHERE subject_id=? AND predicate=? AND object_id=? AND source_url=? AND valid_until IS NULL`, args: [personId, predicate, orgId, record.sourceUrl] });
  if (!exists.rows.length) await db.execute({ sql: `INSERT INTO kg_relations(subject_id,predicate,object_id,role_title,source_url,evidence,confidence) VALUES (?,?,?,?,?,?,?)`, args: [personId, predicate, orgId, record.role, record.sourceUrl, record.evidence, record.confidence] });
  await db.execute({ sql: `INSERT OR IGNORE INTO kg_aliases(entity_id,alias,normalized_alias,source,score_weight) VALUES (?,?,lower(?),?,25)`, args: [personId, record.person, record.person, `governance:${sourceId}`] });
}

async function expireConfirmedGovernanceRelations(db, sourceId, dryRun) {
  if (dryRun) return 0;
  const removed = await db.execute({ sql: `SELECT sr.raw_object FROM source_records sr JOIN
    (SELECT source_key,MAX(id) id FROM source_records WHERE source_id=? GROUP BY source_key) latest ON latest.id=sr.id
    WHERE sr.change_type='removed'`, args: [sourceId] });
  let expired = 0;
  for (const row of removed.rows) {
    let record; try { record = JSON.parse(row.raw_object || '{}'); } catch { continue; }
    const identifier = `${record.sourceUrl}#${encodeURIComponent(String(record.person || '').toLocaleLowerCase('nl-NL'))}`;
    const person = await db.execute({ sql: `SELECT entity_id FROM entity_identifiers WHERE identifier_type='website' AND value=?`, args: [identifier] });
    if (!person.rows.length) continue;
    const result = await db.execute({ sql: `UPDATE kg_relations SET valid_until=datetime('now') WHERE subject_id=? AND source_url=? AND valid_until IS NULL`, args: [Number(person.rows[0].entity_id), record.sourceUrl] });
    expired += Number(result.rowsAffected || 0);
  }
  return expired;
}

class GovernanceAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.pages = config.pages || GOVERNANCE_PAGES; this.sourceId = null; this.stats = null; }
  async run() {
    const records = []; const parts = [];
    for (const config of this.pages) {
      const fetched = await fetchBuffer(config.url, { fetchImpl: this.fetchImpl, label: `Governance ${config.organization}`, accept: 'text/html', allowHtml: true });
      const extracted = extractGovernanceFacts(fetched.buffer.toString('utf8'), config); if (extracted.length < 2) throw new Error(`Governance-extractie verdacht klein voor ${config.organization}: ${extracted.length}`);
      records.push(...extracted); parts.push({ url: fetched.url, html: fetched.buffer.toString('utf8') });
    }
    const fetched = { buffer: Buffer.from(JSON.stringify(parts)), url: METAS.governance.url, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.governance, records, fetched, minimumRecords: this.pages.length * 2,
      eventForChange: (changeType, record, previous) => ({ type: changeType === 'added' ? 'BOARD_APPOINTMENT' : 'ROLE_CHANGED', changeType, title: `${record.person}: ${record.role} bij ${record.organization}`,
        summary: record.evidence, evidence: [record.sourceUrl, record.evidence], journalisticallyRelevant: false,
        uncertainty: 'Door de organisatie zelf verklaarde rol; cross-source persoonskoppeling vereist afzonderlijke corroboratie en review.' }) });
    for (const record of records) await ensureGovernanceRelation(this.db, record, result.sourceId, this.dryRun);
    const expiredRelations = await expireConfirmedGovernanceRelations(this.db, result.sourceId, this.dryRun);
    this.sourceId = result.sourceId; this.stats = { facts: records.length, pages: this.pages.length, expiredRelations }; return { ...result, ...this.stats };
  }
  async health() { return this.stats?.facts >= this.pages.length * 2 ? { status: 'ok', message: `${this.stats.facts} openbare governancefeiten; brongebonden persoonsidentiteit` } : { status: 'error', message: 'Governancepagina’s niet valide' }; }
}

function observationValue(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function summarizeSensorThings(payload, boundaries) {
  const records = [];
  for (const thing of payload.value || []) {
    const locations = thing.Locations || thing.locations || []; const location = locations[0]; const coordinates = location?.location?.coordinates;
    const boundary = Array.isArray(coordinates) && boundaries.find(feature => pointInGeometry(coordinates, feature.geometry)); if (!boundary) continue;
    for (const stream of thing.Datastreams || thing.datastreams || []) {
      const observations = (stream.Observations || stream.observations || []).filter(item => observationValue(item.result) !== null);
      const record = { sourceKey: `samenmeten:${thing['@iot.id']}:${stream['@iot.id']}`, thingId: thing['@iot.id'], datastreamId: stream['@iot.id'], name: normalizeText(thing.name),
        phenomenon: normalizeText(stream.name || stream.ObservedProperty?.name), unit: normalizeText(stream.unitOfMeasurement?.symbol), municipality: boundary.properties?.gm_naam,
        coordinates, observations: observations.map(item => ({ time: item.phenomenonTime, value: observationValue(item.result), quality: item.resultQuality || null })), sourceUrl: `${RIVM_API}/Datastreams(${stream['@iot.id']})` };
      // Meetwaarden blijven in het reproduceerbare bronrecord, maar zijn geen
      // semantische wijziging: fase 4 inventariseert meetstromen en alarmeert niet.
      record.semanticFields = { phenomenon: record.phenomenon, unit: record.unit, municipality: record.municipality, coordinates }; records.push(record);
    }
  }
  return records;
}

class SamenMetenAdapter {
  constructor(config = {}) { this.db = dbClient(config); this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.enabled = config.enabled ?? process.env.STADSGEEST_ENABLE_SAMEN_METEN === '1'; this.sourceId = null; this.stats = null; }
  async run() {
    if (!this.enabled) return { disabled: true, reason: 'STADSGEEST_ENABLE_SAMEN_METEN is niet 1', total: 0 };
    const boundaryFetch = await fetchBuffer(BOUNDARY_URL, { fetchImpl: this.fetchImpl, label: 'PDOK gemeentegrenzen Samen Meten', accept: 'application/geo+json' });
    const geojson = JSON.parse(boundaryFetch.buffer.toString('utf8')); const boundaries = (geojson.features || []).filter(feature => ['GM0307','GM0327'].includes(feature.properties?.gm_code));
    if (boundaries.length !== 2) throw new Error(`Samen Meten: ${boundaries.length} lokale gemeentegrenzen, verwacht 2`);
    const filter = encodeURIComponent("geo.distance(Locations/location, geography'SRID=4326;POINT(5.387 52.156)') le 0.2");
    let url = `${RIVM_API}/Things?$filter=${filter}&$expand=Locations,Datastreams($expand=ObservedProperty)&$top=200`; const sourcePayloads = []; const localThings = new Map();
    for (let page = 0; url && page < 20; page++) {
      const fetched = await fetchBuffer(url, { fetchImpl: this.fetchImpl, label: `Samen Meten Things ${page + 1}`, accept: 'application/json', timeoutMs: 60_000 });
      const payload = JSON.parse(fetched.buffer.toString('utf8')); if (!Array.isArray(payload.value)) throw new Error('Samen Meten Things-schemadrift: value ontbreekt');
      sourcePayloads.push(payload);
      for (const thing of payload.value) {
        const boundary = boundaries.find(feature => (thing.Locations || []).some(location => pointInGeometry(location.location?.coordinates, feature.geometry))); if (!boundary) continue;
        localThings.set(thing['@iot.id'], thing);
      }
      url = payload['@iot.nextLink'] || null;
    }
    if (url) throw new Error('Samen Meten locatiepaginering overschrijdt veiligheidslimiet');
    const scopedThings = new Map([...localThings].filter(([, thing]) => ['307', '327'].includes(String(thing.properties?.codegemeente || '').replace(/^0+/, ''))));
    if (!scopedThings.size || scopedThings.size > 250) throw new Error(`Samen Meten lokaal Thing-volume verdacht: polygoon=${localThings.size}, actuele gemeentecode=${scopedThings.size}`);
    const things = [...scopedThings.values()];
    const streams = things.flatMap(thing => thing.Datastreams || []).filter(stream => /pm\s*2[.,]?5|pm\s*10|fijnstof/i.test(`${stream.name || ''} ${stream.ObservedProperty?.name || ''}`));
    const since = new Date(Date.now() - 3 * 3600000).toISOString(); let observationFailures = 0;
    for (let offset = 0; offset < streams.length; offset += 6) {
      const batch = streams.slice(offset, offset + 6);
      const settled = await Promise.allSettled(batch.map(async stream => {
        const observationFilter = encodeURIComponent(`phenomenonTime ge ${since}`);
        const observationUrl = `${RIVM_API}/Datastreams(${stream['@iot.id']})/Observations?$filter=${observationFilter}&$orderby=phenomenonTime%20desc&$top=12`;
        const fetched = await fetchBuffer(observationUrl, { fetchImpl: this.fetchImpl, label: `Samen Meten datastream ${stream['@iot.id']}`, accept: 'application/json', timeoutMs: 60_000, attempts: 2 });
        const payload = JSON.parse(fetched.buffer.toString('utf8')); if (!Array.isArray(payload.value)) throw new Error('Samen Meten observaties-schemadrift: value ontbreekt');
        stream.Observations = payload.value; return payload;
      }));
      for (const outcome of settled) { if (outcome.status === 'fulfilled') sourcePayloads.push(outcome.value); else observationFailures++; }
    }
    if (observationFailures > Math.max(2, Math.floor(streams.length * 0.2))) throw new Error(`Samen Meten foutisolatiegrens overschreden: ${observationFailures}/${streams.length} datastreams mislukt`);
    const records = summarizeSensorThings({ value: things }, boundaries); if (!records.length) throw new Error('Samen Meten: geen lokale datastreams');
    const dataFetch = { buffer: Buffer.from(JSON.stringify(sourcePayloads)), url: `${RIVM_API}/Things`, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: METAS.rivm, records, fetched: dataFetch, minimumRecords: 1,
      eventForChange: () => null });
    this.sourceId = result.sourceId; this.stats = { streams: records.length, things: new Set(records.map(record => record.thingId)).size, observationFailures }; return { ...result, ...this.stats };
  }
  async health() { if (!this.enabled) return { status: 'disabled', message: 'Experimentele bron staat veilig uit' }; return this.stats?.streams ? { status: 'ok', message: `${this.stats.streams} lokale datastreams; geen harde signalen` } : { status: 'error', message: 'Samen Meten niet valide' }; }
}

module.exports = {
  CALENDAR_PAGE, GOVERNANCE_PAGES, METAS, RIVM_API, UIT_PAGE, GovernanceAdapter, MunicipalEventsAdapter, SamenMetenAdapter, UitAgendaAdapter,
  ensureGovernanceRelation, eventForAgenda, eventForCalendar, expireConfirmedGovernanceRelations, extractGovernanceFacts, observationValue, parseMunicipalCalendar, pdfLines, summarizeSensorThings,
};
