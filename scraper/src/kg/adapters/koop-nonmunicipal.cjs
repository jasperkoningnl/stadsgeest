const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { fetchBuffer, normalizeText, runVersionedDataset } = require('../phase3-core.cjs');

const SRU = 'https://repository.overheid.nl/sru';
const SOURCE_URL = 'https://data.overheid.nl/dataset/officiele-bekendmakingen';
const VERSION = '1.0.0';
const PUBLICATIONS = ['Staatscourant', 'Provinciaal blad', 'Waterschapsblad', 'Blad gemeenschappelijke regeling'];
const META = { name: 'KOOP — niet-gemeentelijke officiële publicaties', url: SOURCE_URL, sourceClass: 'AUTHORITATIVE_EVENT',
  version: VERSION, frequency: 'daily', category: 'government', lastVerifiedAt: '2026-09-13', termsCheckedAt: '2026-09-13', ownerContact: 'oep@koop.overheid.nl',
  manifest: { owner: 'KOOP', license: 'CC0 1.0', collection: 'officielepublicaties', overlap_days: 2,
    identity: 'officiële dcterms:identifier', local_filter: 'metadata/fulltext Amersfoort of Leusden plus publicatieblad',
    deduplication: 'officiële identifier over alle KOOP-ingangen', audit_decision: 'afzonderlijke SRU-adapter wegens onvoldoende aantoonbare dekking' } };

function decodeXml(value) { return normalizeText(String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
}
function tag(block, names) { for (const name of names) { const escaped = name.replace('.', '\\.'); const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
    if (match) return decodeXml(match[1].replace(/<[^>]+>/g, ' ')); } return ''; }
function parseSru(xml, publication) {
  if (/diagnostics/i.test(xml) && !/<sru:record>/i.test(xml)) throw new Error(`KOOP SRU-diagnostic voor ${publication}`);
  const records = [];
  for (const match of xml.matchAll(/<sru:record>[\s\S]*?<\/sru:record>/gi)) {
    const block = match[0]; const identifier = tag(block, ['dcterms:identifier', 'identifier']); if (!identifier) continue;
    const title = tag(block, ['dcterms:title', 'title']); const description = tag(block, ['dcterms:description', 'description']);
    const creator = tag(block, ['dcterms:creator', 'creator']); const spatial = tag(block, ['dcterms:spatial', 'spatial']);
    const modified = tag(block, ['dcterms:modified', 'dcterms:date', 'date']); const preferred = tag(block, ['gzd:preferredUrl']);
    const localEvidence = [title, description, spatial].join(' ').match(/\b(Amersfoort|Leusden)\b/i)?.[0];
    if (!localEvidence) continue;
    const record = { sourceKey: `koop:${identifier}`, identifier, publication, title, description, creator, spatial, modified,
      localEvidence, sourceUrl: preferred || `https://zoek.officielebekendmakingen.nl/${identifier}.html`, publishedAt: modified || null };
    record.semanticFields = { title, description, creator, spatial, publication, modified }; records.push(record);
  }
  return records;
}
function classify(record) {
  const text = `${record.title} ${record.description}`.toLowerCase();
  if (/watervergunning|waterschap/.test(text)) return 'WATER_PERMIT';
  if (/provinc/.test(record.publication.toLowerCase())) return 'PROVINCIAL_DECISION';
  if (/gemeenschappelijke regeling/.test(record.publication.toLowerCase())) return 'JOINT_AUTHORITY_DECISION';
  return 'NATIONAL_DECISION';
}
function eventForChange(changeType, record, previous) {
  if (changeType === 'removed') return null;
  return { type: classify(record), changeType, title: record.title || `${record.publication}: ${record.identifier}`,
    summary: [record.creator, record.publication, record.description].filter(Boolean).join(' — '), evidence: [record.identifier, record.localEvidence, record.publication],
    journalisticallyRelevant: true, uncertainty: 'Lokale relevantie volgt uit KOOP-metadata/tekst; inhoudelijke impact vereist redactionele beoordeling.' };
}
function sinceDate(days = 2) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

class KoopNonMunicipalAdapter {
  constructor(config = {}) { this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false; this.fetchImpl = config.fetchImpl || fetch; this.sourceId = null; }
  async run() {
    const records = []; const parts = []; const since = sinceDate(2);
    for (const publication of PUBLICATIONS) {
      const query = `c.product-area==officielepublicaties AND w.publicatienaam=="${publication}" AND dt.modified>="${since}" AND cql.textAndIndexes any "Amersfoort Leusden"`;
      const url = `${SRU}?operation=searchRetrieve&version=2.0&maximumRecords=100&startRecord=1&query=${encodeURIComponent(query)}`;
      const fetched = await fetchBuffer(url, { fetchImpl: this.fetchImpl, label: `KOOP ${publication}`, accept: 'application/xml', timeoutMs: 60_000 });
      parts.push(fetched.buffer.toString('base64')); records.push(...parseSru(fetched.buffer.toString('utf8'), publication));
    }
    const unique = new Map(records.map(record => [record.sourceKey, record]));
    const fetched = { buffer: Buffer.from(JSON.stringify(parts)), url: SRU, contentType: 'application/json' };
    const result = await runVersionedDataset({ db: this.db, dryRun: this.dryRun, meta: META, records: [...unique.values()], fetched,
      minimumRecords: 0, eventForChange }); this.sourceId = result.sourceId; return { ...result, publications: PUBLICATIONS.length };
  }
  async health() { return { status: this.sourceId ? 'ok' : 'error', message: 'Vier niet-gemeentelijke KOOP-publicatiebladen gecontroleerd' }; }
}

module.exports = { KoopNonMunicipalAdapter, META, PUBLICATIONS, SRU, classify, eventForChange, parseSru, sinceDate };
