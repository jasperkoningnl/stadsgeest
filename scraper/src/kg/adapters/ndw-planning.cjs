const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { XMLParser } = require('fast-xml-parser');
const { changedFields, fetchBuffer, normalizeText, runVersionedDataset } = require('../phase3-core.cjs');

const FEED_URL = 'https://opendata.ndw.nu/planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz';
const BOUNDARY_URL = 'https://api.pdok.nl/cbs/wijken-en-buurten-2026/ogc/v1/collections/gemeenten/items?f=json&limit=500';
const SOURCE_URL = 'https://opendata.ndw.nu/';
const VERSION = '1.0.0';
const META = { name: 'NDW — wegwerkzaamheden en evenementen', url: SOURCE_URL, sourceClass: 'AUTHORITATIVE_EVENT',
  version: VERSION, frequency: 'hourly', category: 'data', lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13', ownerContact: null,
  manifest: { owner: 'Nationaal Dataportaal Wegverkeer', license: 'open data', feed: FEED_URL, boundary: BOUNDARY_URL,
    identity: 'DATEX situation id + situationRecord id', local_filter: 'punt-in-polygoon op officiële CBS/BRK-gemeentegrens', horizon_days: 90, intended_frequency: 'elke 15 minuten',
    semantic_fields: ['versionTime', 'start', 'end', 'severity', 'type', 'comments', 'coordinates', 'status'], removal_confirmation_runs: 2 } };

function asArray(value) { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }
function findValues(value, key, found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [name, child] of Object.entries(value)) {
    if (name === key) found.push(child);
    if (typeof child === 'object') findValues(child, key, found);
  }
  return found;
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}
function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(polygon => pointInRing(point, polygon[0]) && !polygon.slice(1).some(hole => pointInRing(point, hole)));
}
function pointToSegmentKm(point, start, end) {
  const latitude = point[1] * Math.PI / 180; const scaleX = 111.32 * Math.cos(latitude); const scaleY = 110.57;
  const px = point[0] * scaleX, py = point[1] * scaleY, ax = start[0] * scaleX, ay = start[1] * scaleY, bx = end[0] * scaleX, by = end[1] * scaleY;
  const dx = bx - ax, dy = by - ay; const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function pointInGeometryBuffered(point, geometry, bufferKm = 1) {
  if (pointInGeometry(point, geometry)) return true;
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(polygon => polygon.some(ring => ring.some((coordinate, index) =>
    index > 0 && pointToSegmentKm(point, ring[index - 1], coordinate) <= bufferKm)));
}
function extractCoordinates(record) {
  const lats = findValues(record, 'latitude').map(Number).filter(Number.isFinite);
  const lons = findValues(record, 'longitude').map(Number).filter(Number.isFinite);
  return lats.map((lat, index) => ({ lat, lon: lons[index] })).filter(point => Number.isFinite(point.lon));
}
function textValues(record) {
  return findValues(record, 'value').flatMap(asArray).filter(value => typeof value === 'string').map(normalizeText);
}
function parseNdwXml(xml, boundaries, now = new Date()) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: true });
  const root = parser.parse(xml); const situations = asArray(root?.messageContainer?.payload?.situation);
  const horizon = new Date(now.getTime() + 90 * 86400000);
  const records = [];
  for (const situation of situations) {
    const situationId = normalizeText(situation.id); const situationSeverity = normalizeText(situation.overallSeverity);
    for (const record of asArray(situation.situationRecord)) {
      const coordinates = extractCoordinates(record);
      const boundary = boundaries.find(feature => coordinates.some(point => pointInGeometryBuffered([point.lon, point.lat], feature.geometry, 1)));
      if (!boundary) continue;
      const start = normalizeText(findValues(record, 'overallStartTime')[0]); const end = normalizeText(findValues(record, 'overallEndTime')[0]);
      if (start && new Date(start) > horizon) continue;
      if (end && new Date(end) < now) continue;
      const comments = textValues(record); const type = normalizeText(record.type || 'SituationRecord').replace(/^sit:/, '');
      const status = normalizeText(findValues(record, 'roadworkStatus')[0] || findValues(record, 'operatorActionStatus')[0]);
      const closure = /clos|afsluit|roadclosed/i.test([type, status, ...comments, ...findValues(record, 'roadOrCarriagewayOrLaneManagementType')].join(' '));
      const recordId = normalizeText(record.id);
      if (!situationId || !recordId) throw new Error('NDW schemadrift: situation- of situationRecord-id ontbreekt');
      const item = { sourceKey: `ndw:${situationId}:${recordId}`, situationId, recordId, version: Number(record.version) || 1,
        versionTime: normalizeText(record.situationRecordVersionTime || situation.situationVersionTime), start, end,
        severity: situationSeverity, type, status, closure, comments, coordinates, municipality: boundary.properties?.gm_naam || boundary.properties?.gemeentenaam || boundary.properties?.naam || '',
        municipalityCode: boundary.properties?.gm_code || boundary.properties?.gemeentecode || '', sourceUrl: FEED_URL, publishedAt: normalizeText(record.situationRecordVersionTime || situation.situationVersionTime),
        occurredAt: start || null };
      item.semanticFields = { versionTime: item.versionTime, start, end, severity: item.severity, type, status, closure, comments, coordinates };
      records.push(item);
    }
  }
  return records;
}
function eventForChange(changeType, record, previous) {
  const fields = previous ? changedFields(previous, record, ['start', 'end', 'severity', 'status', 'closure', 'comments', 'coordinates']) : [];
  const isEvent = /PublicEvent/i.test(record.type); const type = isEvent ? 'EVENT_TRAFFIC_MEASURE' :
    (changeType === 'changed' && (record.closure || fields.includes('closure')) ? 'ROAD_CLOSURE_CHANGED' : 'ROADWORK_PLANNED');
  const durationHours = record.start && record.end ? (new Date(record.end) - new Date(record.start)) / 3600000 : null;
  const critical = /station|centrum|ziekenhuis|meander|a1\b|a28\b/i.test(record.comments.join(' '));
  const material = record.closure || critical || durationHours >= 24 || ['high', 'highest'].includes(record.severity.toLowerCase());
  return { type, changeType, title: `${isEvent ? 'Verkeersmaatregel evenement' : 'Wegwerkzaamheid'} in ${record.municipality}: ${record.comments[0] || record.situationId}`,
    summary: `${record.start || 'start onbekend'} tot ${record.end || 'einde onbekend'}; ernst ${record.severity || 'onbekend'}; ${record.closure ? 'afsluiting' : 'geen volledige afsluiting vastgesteld'}.`,
    changedFields: fields, evidence: [record.situationId, record.comments[0], record.start, record.end], journalisticallyRelevant: material,
    uncertainty: 'Lokale relevantie is geometrisch vastgesteld; route-impact buiten de gemeentegrens is niet automatisch lokaal.' };
}

class NdwPlanningAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; }
  async run() {
    const [feed, boundary] = await Promise.all([
      fetchBuffer(FEED_URL, { fetchImpl: this.fetchImpl, label: 'NDW planningfeed', accept: 'application/xml', timeoutMs: 180_000 }),
      fetchBuffer(BOUNDARY_URL, { fetchImpl: this.fetchImpl, label: 'PDOK gemeentegrenzen', accept: 'application/geo+json', timeoutMs: 60_000 }),
    ]);
    const geojson = JSON.parse(boundary.buffer.toString('utf8'));
    geojson.features = (geojson.features || []).filter(feature => ['GM0307', 'GM0327'].includes(feature.properties?.gm_code || feature.properties?.gemeentecode));
    if (geojson.features.length !== 2) throw new Error(`PDOK gaf ${geojson.features.length} lokale gemeentegrenzen; verwacht 2`);
    const xml = zlib.gunzipSync(feed.buffer).toString('utf8');
    if (!xml.includes('SituationPublication')) throw new Error('NDW schemadrift: SituationPublication ontbreekt');
    const records = parseNdwXml(xml, geojson.features);
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records, fetched: feed, minimumRecords: 0, eventForChange });
    this.sourceId = result.sourceId; return { ...result, nationalBytes: feed.buffer.length, localRecords: records.length };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: 'NDW DATEX II en officiële gemeentegeometrie valide' }; }
}

module.exports = { BOUNDARY_URL, FEED_URL, META, NdwPlanningAdapter, eventForChange, extractCoordinates, parseNdwXml,
  pointInGeometry, pointInGeometryBuffered, pointInRing, pointToSegmentKm };
