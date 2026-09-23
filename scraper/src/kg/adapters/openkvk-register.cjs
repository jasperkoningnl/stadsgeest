// OpenKvK via overheid.io — dagelijkse registerupdates voor Amersfoort en Leusden.
//
// Waarom geen runVersionedDataset: die verwacht een volledige dataset en markeert
// alles wat ontbreekt als verdwenen. overheid.io geeft per zoekopdracht hooguit
// tien pagina's, terwijl Amersfoort alleen al ruim 70.000 records heeft. Deze
// adapter leest daarom per dag alleen wat overheid.io die dag heeft bijgewerkt
// (filter updated_at) en behandelt elke dag als een incrementele feed.
//
// Beperkingen van de bron (getest 23 september 2026):
// - er is geen inschrijfdatum; "nieuw" betekent hier "voor het eerst gezien in de
//   dagelijkse wijzigingen", niet aantoonbaar een nieuwe inschrijving;
// - sorteren werkt niet (order[] wordt genegeerd, sort geeft HTTP 400);
// - pagina's tot 100 records, hooguit 10 pagina's per zoekopdracht;
// - er komen geen headers mee met het resterende tegoed.
//
// Abonnement Small: 2.500 API-calls. Per welke periode dat geldt staat nergens,
// dus deze adapter houdt een harde bovengrens per run aan (OPENKVK_MAX_CALLS_PER_RUN).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const {
  archiveSnapshot, changedFields, ensureOrganization, ensureSource, isLocalPlace, normalizeText, semanticHash,
} = require('../phase3-core.cjs');

const API_URL = 'https://api.overheid.io/v3/openkvk';
const PUBLIC_URL_PREFIX = 'https://www.kvk.nl/zoeken/?source=all&q=';
const VERSION = '1.0.0';
const PLACES = ['Amersfoort', 'Leusden'];
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const WARMUP_DAYS = 14;
const MAX_CATCHUP_DAYS = 7;
const CURSOR_KEY = '__openkvk_cursor__';
const FIELDS = [
  'kvknummer', 'vestigingsnummer', 'naam', 'huidigeNamen', 'actief', 'updated_at', 'rechtsvormCode',
  'rechtsvormOmschrijving', 'inschrijvingstype', 'vestiging', 'bezoeklocatie', 'activiteiten', 'slug',
];
const META = {
  name: 'OpenKvK — overheid.io registerupdates', url: 'https://overheid.io/documentatie/v3/openkvk',
  sourceClass: 'AUTHORITATIVE_REGISTER', version: VERSION, frequency: 'daily', category: 'registry',
  lastVerifiedAt: '2026-09-23', termsCheckedAt: '2026-09-23', ownerContact: 'overheid.io',
  manifest: {
    owner: 'overheid.io (afgeleid van het Handelsregister)', license: 'betaald abonnement Small',
    download: API_URL, format: 'JSON HAL', identity: 'kvknummer + vestigingsnummer',
    local_filter: 'exacte bezoeklocatie.plaats Amersfoort/Leusden', window: 'updated_at per kalenderdag',
    semantic_fields: ['name', 'active', 'legalForm', 'address', 'activityCodes'],
    warmup_days: WARMUP_DAYS, removal_semantics: 'actief=false, geen afwezigheid',
  },
};

// Rechtsvormen waarvan een nieuwe of opgeheven inschrijving redactioneel kan tellen.
// Eenmanszaken, vof's en BV's leveren te veel ruis op om zelfstandig een signaal te dragen.
const SIGNAL_LEGAL_FORM = /^(stichting|vereniging|co[oö]peratie|naamloze vennootschap|kerkgenootschap|onderlinge waarborgmaatschappij)/i;
const NOT_SIGNAL_LEGAL_FORM = /vereniging van eigenaars/i;
// Voor deze rechtsvormen maken we geen entiteit aan zolang niemand anders ze kent:
// de naam is vaak een persoonsnaam en ze vullen de graaf zonder journalistieke waarde.
const PERSONAL_LEGAL_FORM = /^(eenmanszaak|vennootschap onder firma|maatschap|commanditaire vennootschap)/i;

function isSignalLegalForm(legalForm) {
  return SIGNAL_LEGAL_FORM.test(legalForm || '') && !NOT_SIGNAL_LEGAL_FORM.test(legalForm || '');
}

function isPersonalLegalForm(legalForm) {
  return PERSONAL_LEGAL_FORM.test(legalForm || '');
}

function dayString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return dayString(date);
}

// Welke dagen moet deze run ophalen? Nooit vandaag (nog niet compleet), hooguit
// MAX_CATCHUP_DAYS terug, en zonder cursor alleen gisteren: geen backfill.
function daysToFetch(cursorDay, today) {
  const yesterday = addDays(today, -1);
  const earliest = addDays(today, -MAX_CATCHUP_DAYS);
  let start = cursorDay ? addDays(cursorDay, 1) : yesterday;
  if (start < earliest) start = earliest;
  const days = [];
  for (let day = start; day <= yesterday; day = addDays(day, 1)) days.push(day);
  return days;
}

function buildUrl(place, day, page = 1) {
  const params = [
    `filters[bezoeklocatie.plaats]=${encodeURIComponent(place)}`,
    `filters[updated_at]=${day}`,
    `size=${PAGE_SIZE}`,
    `page=${page}`,
    ...FIELDS.map(field => `fields[]=${field}`),
  ];
  return `${API_URL}?${params.join('&')}`;
}

function parseResponse(json) {
  if (!json || typeof json !== 'object' || !Number.isFinite(Number(json.totalItemCount))) {
    throw new Error('OpenKvK: onverwacht antwoord, totalItemCount ontbreekt');
  }
  const total = Number(json.totalItemCount);
  const embedded = json._embedded || {};
  const items = Array.isArray(embedded.bedrijf) ? embedded.bedrijf : [];
  if (total > 0 && items.length === 0) throw new Error('OpenKvK: schemadrift, _embedded.bedrijf ontbreekt');
  return { total, pageCount: Number(json.pageCount) || 1, items };
}

function normalizeItem(item) {
  const kvk = normalizeText(item.kvknummer).replace(/\s/g, '');
  if (!/^\d{8}$/.test(kvk)) return null;
  const address = item.bezoeklocatie || {};
  const place = normalizeText(address.plaats);
  if (!isLocalPlace(place)) return null;
  const branch = normalizeText(item.vestigingsnummer);
  const name = normalizeText(item.naam || (item.huidigeNamen || [])[0]);
  const activities = (Array.isArray(item.activiteiten) ? item.activiteiten : [])
    .map(activity => ({ code: normalizeText(activity.code), description: normalizeText(activity.omschrijving), main: Boolean(activity.hoofdactiviteit) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const record = {
    sourceKey: `openkvk:${kvk}:${branch || 'rp'}`,
    kvk, branchNumber: branch || null, name, active: item.actief !== false,
    legalForm: normalizeText(item.rechtsvormOmschrijving), legalFormCode: normalizeText(item.rechtsvormCode),
    registrationType: normalizeText(item.inschrijvingstype), isBranch: Boolean(item.vestiging),
    address: {
      street: normalizeText(address.straat), number: normalizeText(address.huisnummer),
      postcode: normalizeText(address.postcode).replace(/\s/g, '').toUpperCase(), place,
    },
    activities, updatedAt: normalizeText(item.updated_at) || null, slug: normalizeText(item.slug) || null,
    sourceUrl: `${PUBLIC_URL_PREFIX}${kvk}`,
  };
  record.occurredAt = record.updatedAt;
  record.semanticHash = semanticHash({
    name: record.name, active: record.active, legalForm: record.legalForm, address: record.address,
    activityCodes: activities.map(activity => activity.code),
  });
  return record;
}

function addressLine(record) {
  const a = record.address || {};
  return [`${a.street || ''} ${a.number || ''}`.trim(), a.postcode, a.place].filter(Boolean).join(', ');
}

// Bepaal het event voor één record. `knownElsewhere` betekent dat het KVK-nummer
// al via een andere bron in de kennisgraaf stond; dat maakt een wijziging
// redactioneel interessanter dan bij een willekeurige onbekende inschrijving.
function eventForRecord({ record, previous, knownElsewhere, warmup, entityId }) {
  const label = `${record.name} (${record.legalForm || 'onbekende rechtsvorm'}, KvK ${record.kvk})`;
  const base = { entityId, entityEvidence: `OpenKvK: exact KVK-nummer ${record.kvk}`, evidence: [label, addressLine(record)] };

  if (!record.active && (!previous || previous.active !== false)) {
    if (warmup && !knownElsewhere) return null;
    return {
      ...base, type: 'KVK_REGISTRATION_DISSOLVED', changeType: previous ? 'changed' : 'added',
      sourceIdentifier: `openkvk:${record.kvk}:dissolved`,
      title: `Inschrijving niet meer actief: ${record.name}`,
      summary: `${label} staat sinds ${record.updatedAt || 'kort'} als niet actief in het Handelsregister (via overheid.io). Adres: ${addressLine(record)}.`,
      journalisticallyRelevant: knownElsewhere || isSignalLegalForm(record.legalForm),
      uncertainty: 'overheid.io geeft geen reden of datum van uitschrijving; controleer op kvk.nl of het om opheffing, fusie of verhuizing gaat.',
    };
  }

  if (!previous && record.active) {
    if (warmup) return null;
    return {
      ...base, type: 'KVK_REGISTRATION_ADDED', changeType: 'added',
      sourceIdentifier: `openkvk:${record.kvk}:added`,
      title: `Voor het eerst gezien in KvK-wijzigingen: ${record.name}`,
      summary: `${label}, ${addressLine(record)}. Hoofdactiviteit: ${(record.activities.find(a => a.main) || record.activities[0] || {}).description || 'onbekend'}.`,
      // Een organisatie die we al uit een andere bron kennen is per definitie niet nieuw.
      journalisticallyRelevant: !knownElsewhere && isSignalLegalForm(record.legalForm),
      uncertainty: 'overheid.io heeft geen inschrijfdatum. Dit record is voor het eerst gezien in de dagelijkse wijzigingen; het kan ook een bestaande inschrijving met een wijziging zijn. Controleer de inschrijfdatum op kvk.nl.',
    };
  }

  if (previous && record.active) {
    const fields = changedFields(
      { name: previous.name, address: previous.address, legalForm: previous.legalForm },
      { name: record.name, address: record.address, legalForm: record.legalForm },
      ['name', 'address', 'legalForm'],
    );
    if (fields.length === 0) return null;
    return {
      ...base, type: 'KVK_REGISTRATION_CHANGED', changeType: 'changed', changedFields: fields,
      sourceIdentifier: `openkvk:${record.kvk}:${record.branchNumber || 'rp'}:changed:${record.semanticHash.slice(0, 16)}`,
      title: `KvK-inschrijving gewijzigd: ${record.name}`,
      summary: `${label}: gewijzigd ${fields.join(', ')}.${fields.includes('address') ? ` Was ${addressLine(previous)}, nu ${addressLine(record)}.` : ''}${fields.includes('name') ? ` Vorige naam: ${previous.name}.` : ''}`,
      journalisticallyRelevant: knownElsewhere,
    };
  }
  return null;
}

async function fetchJson(url, apiKey, fetchImpl) {
  // Eén herhaling, alleen bij netwerkfout of 5xx: elke poging kost tegoed.
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json', 'ovio-api-key': apiKey,
          'User-Agent': 'Stadsgeest/1.0 (journalistieke monitoring Amersfoort en Leusden)',
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const error = new Error(`OpenKvK: HTTP ${response.status}`);
        error.httpStatus = response.status;
        error.retry = response.status >= 500;
        throw error;
      }
      const text = await response.text();
      return { json: JSON.parse(text), buffer: Buffer.from(text), contentType: 'application/json' };
    } catch (error) {
      lastError = error;
      if (error.httpStatus && !error.retry) break;
    }
  }
  throw lastError;
}

class OpenKvkRegisterAdapter {
  constructor(config = {}) {
    this.db = config.db || createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    this.dryRun = config.dryRun || false;
    this.fetchImpl = config.fetchImpl || fetch;
    this.apiKey = config.apiKey ?? process.env.OVERHEID_IO_KEY;
    this.maxCalls = Number(config.maxCalls ?? process.env.OPENKVK_MAX_CALLS_PER_RUN ?? 12);
    this.now = config.now || (() => new Date());
    this.sourceId = null;
    this.calls = 0;
  }

  async latestRecord(sourceKey) {
    if (this.sourceId < 0) return null;
    const result = await this.db.execute({
      sql: `SELECT id, raw_object, semantic_hash, change_type FROM source_records
            WHERE source_id=? AND source_key=? ORDER BY id DESC LIMIT 1`,
      args: [this.sourceId, sourceKey],
    });
    const row = result.rows[0];
    return row ? { id: Number(row.id), record: JSON.parse(row.raw_object || '{}'), hash: row.semantic_hash } : null;
  }

  async warmupActive() {
    if (this.sourceId < 0) return true;
    const result = await this.db.execute({
      sql: `SELECT MIN(fetched_at) first_seen FROM source_records WHERE source_id=? AND source_key<>?`,
      args: [this.sourceId, CURSOR_KEY],
    });
    const first = result.rows[0]?.first_seen;
    if (!first) return true;
    const firstMs = Date.parse(String(first).replace(' ', 'T') + (String(first).includes('Z') ? '' : 'Z'));
    return !Number.isFinite(firstMs) || this.now().getTime() - firstMs < WARMUP_DAYS * 86400000;
  }

  async knownKvk(kvk) {
    const result = await this.db.execute({
      sql: `SELECT entity_id, source_url FROM entity_identifiers WHERE identifier_type='kvk' AND value=? LIMIT 1`,
      args: [kvk],
    });
    const row = result.rows[0];
    if (!row) return { entityId: null, knownElsewhere: false };
    return { entityId: Number(row.entity_id), knownElsewhere: !String(row.source_url || '').startsWith(PUBLIC_URL_PREFIX) };
  }

  async save(record, hash, changeType, previousId) {
    if (this.dryRun) return;
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO source_records (source_id,source_key,raw_object,content_hash,semantic_hash,previous_id,change_type)
            VALUES (?,?,?,?,?,?,?)`,
      args: [this.sourceId, record.sourceKey, JSON.stringify(record),
        semanticHash({ hash, changeType, previousId: previousId || 0 }), hash, previousId || null, changeType],
    });
  }

  async emit(record, previous, event, snapshot) {
    if (!event || this.dryRun) return false;
    const exists = await this.db.execute({
      sql: 'SELECT id FROM kg_events WHERE source_id=? AND source_identifier=? AND event_type=? LIMIT 1',
      args: [this.sourceId, event.sourceIdentifier, event.type],
    });
    if (exists.rows.length) return false;
    const provenance = {
      source_name: META.name, source_class: META.sourceClass, source_identifier: record.sourceKey,
      source_url: record.sourceUrl, fetched_at: new Date().toISOString(), occurred_at: record.occurredAt,
      adapter_version: VERSION, raw_object_hash: snapshot.hash, raw_storage_uri: snapshot.storageUri,
      semantic_hash: record.semanticHash, change_type: event.changeType, current: record, previous: previous || null,
      changed_fields: event.changedFields || [], evidence: event.evidence || [],
      journalistically_relevant: event.journalisticallyRelevant !== false, uncertainty: event.uncertainty || null,
    };
    const inserted = await this.db.execute({
      sql: `INSERT INTO kg_events (event_type,title,summary,occurred_at,published_at,fetched_at,source_id,source_url,
            source_identifier,raw_object_hash,parser_version,detection_rule,provenance)
            VALUES (?,?,?,?,NULL,datetime('now'),?,?,?,?,?,NULL,?)`,
      args: [event.type, event.title, event.summary || '', record.occurredAt, this.sourceId, record.sourceUrl,
        event.sourceIdentifier, snapshot.hash, VERSION, JSON.stringify(provenance)],
    });
    if (event.entityId) await this.db.execute({
      sql: `INSERT OR IGNORE INTO event_entities(event_id,entity_id,role,evidence,confidence) VALUES (?,?,'subject',?,1)`,
      args: [Number(inserted.lastInsertRowid), event.entityId, event.entityEvidence],
    });
    return true;
  }

  async fetchDay(place, day) {
    const items = []; const buffers = [];
    let page = 1; let pageCount = 1; let total = 0;
    do {
      if (this.calls >= this.maxCalls) return null;
      this.calls++;
      const response = await fetchJson(buildUrl(place, day, page), this.apiKey, this.fetchImpl);
      const parsed = parseResponse(response.json);
      total = parsed.total; pageCount = Math.min(parsed.pageCount, MAX_PAGES);
      items.push(...parsed.items); buffers.push(response.buffer);
      page++;
    } while (page <= pageCount);
    const truncated = total > items.length;
    if (truncated) console.warn(`[OpenKvK] ${place} ${day}: ${total} updates, maar slechts ${items.length} op te halen (limiet ${MAX_PAGES} pagina's)`);
    return { items, total, truncated, buffer: Buffer.concat(buffers) };
  }

  async processRecord(record, warmup, snapshot, counts) {
    const old = await this.latestRecord(record.sourceKey);
    if (old && old.hash === record.semanticHash) { counts.unchanged++; return; }
    const previous = old?.record || null;
    const { entityId: knownId, knownElsewhere } = await this.knownKvk(record.kvk);
    let entityId = knownId;
    if (!this.dryRun && (knownId || !isPersonalLegalForm(record.legalForm))) {
      entityId = await ensureOrganization(this.db, record, this.sourceId, record.sourceKey, false);
    }
    const event = eventForRecord({ record, previous, knownElsewhere, warmup, entityId });
    if (await this.emit(record, previous, event, snapshot)) counts.events++;
    if (old) counts.changed++; else counts.created++;
    await this.save(record, record.semanticHash, old ? 'changed' : 'added', old?.id);
  }

  async run() {
    if (!this.apiKey) throw new Error('OVERHEID_IO_KEY ontbreekt in scraper/.env');
    this.calls = 0;
    this.sourceId = await ensureSource(this.db, META, this.dryRun);
    const cursor = await this.latestRecord(CURSOR_KEY);
    const days = daysToFetch(cursor?.record?.day || null, dayString(this.now()));
    const warmup = await this.warmupActive();
    const counts = { total: 0, created: 0, changed: 0, unchanged: 0, events: 0, skippedNonLocal: 0, truncatedDays: [] };
    const completedDays = [];

    for (const day of days) {
      const fetched = [];
      for (const place of PLACES) {
        const result = await this.fetchDay(place, day);
        if (!result) break;
        fetched.push({ place, ...result });
      }
      if (fetched.length < PLACES.length) break; // belbudget op: deze dag de volgende run opnieuw
      const buffer = Buffer.concat(fetched.map(item => item.buffer));
      const snapshot = await archiveSnapshot(this.db, this.sourceId, META.name,
        { buffer, url: `${API_URL}?updated_at=${day}`, contentType: 'application/json' }, this.dryRun);
      const seen = new Set();
      for (const { place, items, truncated } of fetched) {
        if (truncated) counts.truncatedDays.push(`${place}:${day}`);
        for (const item of items) {
          const record = normalizeItem(item);
          if (!record) { counts.skippedNonLocal++; continue; }
          if (seen.has(record.sourceKey)) continue;
          seen.add(record.sourceKey);
          counts.total++;
          await this.processRecord(record, warmup, snapshot, counts);
        }
      }
      completedDays.push(day);
      const cursorRecord = { sourceKey: CURSOR_KEY, day };
      await this.save(cursorRecord, semanticHash(cursorRecord), 'changed', cursor?.id);
    }

    const result = { sourceId: this.sourceId, warmup, days: completedDays, requestedDays: days, calls: this.calls, ...counts };
    console.log(`[OpenKvK] ${JSON.stringify(result)}`);
    this.lastResult = result;
    return result;
  }

  async health() {
    const r = this.lastResult;
    if (!r) return { status: 'error', message: 'Geen geldige OpenKvK-run' };
    if (r.requestedDays.length && r.days.length < r.requestedDays.length) {
      return { status: 'suspect', message: `Belbudget op: ${r.days.length} van ${r.requestedDays.length} dagen opgehaald` };
    }
    if (r.truncatedDays.length) return { status: 'suspect', message: `Afgekapt door paginalimiet: ${r.truncatedDays.join(', ')}` };
    return { status: 'ok', message: `${r.days.length} dag(en), ${r.calls} calls, ${r.total} records` };
  }
}

module.exports = {
  OpenKvkRegisterAdapter, META, API_URL, CURSOR_KEY, WARMUP_DAYS, buildUrl, daysToFetch, eventForRecord,
  isPersonalLegalForm, isSignalLegalForm, normalizeItem, parseResponse,
};
