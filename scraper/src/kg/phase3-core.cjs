const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const LOCAL_PLACES = new Set(['amersfoort', 'leusden']);
const SNAPSHOT_DIR = path.join(__dirname, '../../data/phase3-snapshots');
const BASELINE_KEY = '__baseline_complete__';

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizePlace(value) {
  return normalizeText(value).toLocaleLowerCase('nl-NL').replace(/^gemeente\s+/, '');
}

function isLocalPlace(value) {
  return LOCAL_PLACES.has(normalizePlace(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? normalizeText(value) : value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function semanticHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function isRecoveredUnconfirmed(old, currentHash) {
  return Boolean(old && old.changeType !== 'removed' && old.record?._missing && old.record._priorSemanticHash === currentHash);
}

function missingTransition(sourceKey, old) {
  const missingCount = Number(old.record._missingCount || 0) + 1;
  const priorHash = old.record._priorSemanticHash || old.hash;
  return { confirmed: missingCount >= 2, tombstone: { ...old.record, sourceKey, _missing: true, _missingCount: missingCount,
    _priorSemanticHash: priorHash, semanticHash: semanticHash({ prior: priorHash, missingCount }) } };
}

function rawHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function extractFirstZipEntry(buffer) {
  const eocdSignature = 0x06054b50; let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('ZIP: centraal register ontbreekt');
  const entries = buffer.readUInt16LE(eocd + 10); let central = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index++) {
    if (buffer.readUInt32LE(central) !== 0x02014b50) throw new Error('ZIP: ongeldig centraal record');
    const method = buffer.readUInt16LE(central + 10); const compressedSize = buffer.readUInt32LE(central + 20);
    const uncompressedSize = buffer.readUInt32LE(central + 24); const nameLength = buffer.readUInt16LE(central + 28);
    const extraLength = buffer.readUInt16LE(central + 30); const commentLength = buffer.readUInt16LE(central + 32);
    const localOffset = buffer.readUInt32LE(central + 42); const name = buffer.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    if (!name.endsWith('/')) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP: lokaal record ontbreekt');
      const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength; const compressed = buffer.subarray(start, start + compressedSize);
      const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
      if (!data) throw new Error(`ZIP: compressiemethode ${method} niet ondersteund`);
      if (data.length !== uncompressedSize) throw new Error(`ZIP: uitgepakte lengte klopt niet voor ${name}`);
      return { name, data };
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('ZIP: geen bestand aangetroffen');
}

function parseDelimited(text, delimiter = ';') {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => value !== '')) rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows.shift().map(normalizeText);
  if (new Set(headers).size !== headers.length) throw new Error('Dubbele kolomnamen in bronbestand');
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, normalizeText(values[index])])))
    .filter(record => Object.values(record).some(Boolean));
}

function requireColumns(rows, columns, label) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${label}: lege dataset`);
  const present = new Set(Object.keys(rows[0]));
  const missing = columns.filter(column => !present.has(column));
  if (missing.length) throw new Error(`${label}: schemadrift, ontbrekende kolommen: ${missing.join(', ')}`);
}

async function fetchBuffer(url, options = {}) {
  let lastError;
  const attempts = options.attempts || 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await (options.fetchImpl || fetch)(url, {
        headers: {
          Accept: options.accept || '*/*',
          'User-Agent': 'Stadsgeest/1.0 (journalistieke monitoring Amersfoort en Leusden)',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs || 90_000),
      });
      if (!response.ok) {
        const error = new Error(`${options.label || 'Bron'} ophalen mislukt: HTTP ${response.status}`);
        error.httpStatus = response.status;
        if (response.status === 429 || response.status >= 500) throw error;
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = String(response.headers?.get?.('content-type') || '');
      if (options.rejectHtml !== false && /text\/html/i.test(contentType) && !options.allowHtml) {
        throw new Error(`${options.label || 'Bron'} gaf HTML in plaats van data`);
      }
      if (buffer.length === 0 && !options.allowEmpty) throw new Error(`${options.label || 'Bron'} gaf een leeg antwoord`);
      return { buffer, url: response.url || url, contentType, etag: response.headers?.get?.('etag'), lastModified: response.headers?.get?.('last-modified') };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100)));
    }
  }
  throw lastError;
}

async function archiveSnapshot(db, sourceId, sourceName, fetched, dryRun) {
  const hash = rawHash(fetched.buffer);
  if (dryRun) return { hash, storageUri: null };
  const safeName = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const folder = path.join(SNAPSHOT_DIR, safeName);
  await fs.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(folder, `${stamp}-${hash.slice(0, 12)}.gz`);
  await fs.writeFile(file, zlib.gzipSync(fetched.buffer, { level: 9 }));
  const storageUri = path.relative(path.join(__dirname, '../..'), file).replace(/\\/g, '/');
  await db.execute({
    sql: `INSERT OR IGNORE INTO source_snapshots
          (source_id, fetched_at, source_url, storage_uri, content_hash, media_type, byte_length, etag, last_modified)
          VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
    args: [sourceId, fetched.url, storageUri, hash, fetched.contentType || null, fetched.buffer.length, fetched.etag || null, fetched.lastModified || null],
  });
  return { hash, storageUri };
}

async function ensureSource(db, meta, dryRun = false) {
  const found = await db.execute({ sql: 'SELECT id FROM sources WHERE name=? LIMIT 1', args: [meta.name] });
  if (found.rows.length) {
    const id = Number(found.rows[0].id);
    if (!dryRun) await db.execute({
      sql: `UPDATE sources SET url=?, source_class=?, adapter_version=?, source_manifest=?,
            is_active=1, last_verified_at=?, terms_checked_at=?, owner_contact=? WHERE id=?`,
      args: [meta.url, meta.sourceClass, meta.version, JSON.stringify(meta.manifest), meta.lastVerifiedAt, meta.termsCheckedAt, meta.ownerContact || null, id],
    });
    return id;
  }
  if (dryRun) return -1;
  const inserted = await db.execute({
    sql: `INSERT INTO sources
          (name,url,source_type,reliability,category,scrape_frequency,is_active,created_at,
           source_class,adapter_version,source_manifest,last_verified_at,terms_checked_at,owner_contact)
          VALUES (?,?,'api','primary',?,?,1,datetime('now'),?,?,?,?,?,?)`,
    args: [meta.name, meta.url, meta.category || 'data', meta.frequency, meta.sourceClass, meta.version,
      JSON.stringify(meta.manifest), meta.lastVerifiedAt, meta.termsCheckedAt, meta.ownerContact || null],
  });
  return Number(inserted.lastInsertRowid);
}

async function ensureOrganization(db, record, sourceId, identifierValue, dryRun = false) {
  if (dryRun) return null;
  const hardIdentifiers = [
    ['kvk', record.kvk], ['rsin', record.rsin], ['lei', record.lei],
  ].filter(([, value]) => value);
  for (const [type, value] of hardIdentifiers) {
    const found = await db.execute({
      sql: 'SELECT entity_id FROM entity_identifiers WHERE identifier_type=? AND value=? LIMIT 1',
      args: [type, String(value).replace(/\s/g, '')],
    });
    if (found.rows.length) return Number(found.rows[0].entity_id);
  }
  const sourceIdentifier = `${record.sourceUrl || ''}#${identifierValue || record.sourceKey}`;
  const sourceMatch = await db.execute({
    sql: `SELECT entity_id FROM entity_identifiers WHERE identifier_type='website' AND value=? LIMIT 1`,
    args: [sourceIdentifier],
  });
  let entityId = sourceMatch.rows.length ? Number(sourceMatch.rows[0].entity_id) : null;
  if (!entityId) {
    const inserted = await db.execute({
      sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name)
            VALUES ('organization',?,?)`,
      args: [record.name, normalizeText(record.name).toLocaleLowerCase('nl-NL')],
    });
    entityId = Number(inserted.lastInsertRowid);
  }
  for (const [type, value] of [...hardIdentifiers, ['website', sourceIdentifier]]) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO entity_identifiers(entity_id,identifier_type,value,source_url,verified_at)
            VALUES (?,?,?,?,datetime('now'))`,
      args: [entityId, type, String(value).replace(/\s/g, ''), record.sourceUrl || null],
    });
  }
  const aliases = [record.name, ...(record.aliases || [])].map(normalizeText).filter(value => value.length >= 3);
  for (const alias of new Set(aliases)) await db.execute({
    sql: `INSERT OR IGNORE INTO kg_aliases(entity_id,alias,normalized_alias,source,score_weight)
          VALUES (?,?,?,?,35)`,
    args: [entityId, alias, alias.toLocaleLowerCase('nl-NL'), `source:${sourceId}`],
  });
  return entityId;
}

async function currentRecords(db, sourceId) {
  if (sourceId < 0) return { baseline: false, records: new Map() };
  const result = await db.execute({
    sql: `SELECT sr.id,sr.source_key,sr.raw_object,sr.semantic_hash,sr.content_hash,sr.change_type
          FROM source_records sr JOIN (
            SELECT source_key,MAX(id) latest_id FROM source_records WHERE source_id=? GROUP BY source_key
          ) latest ON latest.latest_id=sr.id`, args: [sourceId],
  });
  const records = new Map();
  let baseline = false;
  for (const row of result.rows) {
    if (row.source_key === BASELINE_KEY) { baseline = true; continue; }
    records.set(String(row.source_key), {
      id: Number(row.id), record: JSON.parse(row.raw_object || '{}'),
      hash: row.semantic_hash || row.content_hash, changeType: row.change_type,
    });
  }
  return { baseline, records };
}

async function saveRecord(db, sourceId, record, hash, changeType, previousId, rawContentHash, dryRun) {
  if (dryRun) return;
  const storageHash = semanticHash({ hash, changeType, previousId: previousId || 0, rawContentHash });
  await db.execute({
    sql: `INSERT OR IGNORE INTO source_records
          (source_id,source_key,raw_object,content_hash,semantic_hash,previous_id,change_type)
          VALUES (?,?,?,?,?,?,?)`,
    args: [sourceId, record.sourceKey, JSON.stringify(record), storageHash, hash, previousId || null, changeType],
  });
}

async function emitEvent(db, sourceId, meta, record, previous, event, snapshot, dryRun) {
  if (!event || dryRun) return false;
  const sourceIdentifier = event.sourceIdentifier || `${record.sourceKey}:${event.type}:${record.semanticHash}`;
  const exists = await db.execute({
    sql: 'SELECT id FROM kg_events WHERE source_id=? AND source_identifier=? AND event_type=? LIMIT 1',
    args: [sourceId, sourceIdentifier, event.type],
  });
  if (exists.rows.length) return false;
  const provenance = {
    source_name: meta.name, source_class: meta.sourceClass, source_identifier: record.sourceKey,
    source_url: record.sourceUrl || meta.url, fetched_at: new Date().toISOString(),
    published_at: record.publishedAt || null, occurred_at: record.occurredAt || null,
    adapter_version: meta.version, raw_object_hash: snapshot.hash, raw_storage_uri: snapshot.storageUri,
    semantic_hash: record.semanticHash, change_type: event.changeType,
    current: record, previous: previous || null, changed_fields: event.changedFields || [],
    evidence: event.evidence || [], journalistically_relevant: event.journalisticallyRelevant !== false,
    uncertainty: event.uncertainty || null,
    absolute_change: event.absoluteChange ?? null, relative_change: event.relativeChange ?? null,
  };
  const inserted = await db.execute({
    sql: `INSERT INTO kg_events
          (event_type,title,summary,occurred_at,published_at,fetched_at,source_id,source_url,
           source_identifier,raw_object_hash,parser_version,detection_rule,provenance)
          VALUES (?,?,?,?,?,datetime('now'),?,?,?,?,?,?,?)`,
    args: [event.type, event.title, event.summary || '', record.occurredAt || null, record.publishedAt || null,
      sourceId, record.sourceUrl || meta.url, sourceIdentifier, snapshot.hash, meta.version,
      event.detectionRule || null, JSON.stringify(provenance)],
  });
  if (event.entityId) await db.execute({
    sql: `INSERT OR IGNORE INTO event_entities(event_id,entity_id,role,evidence,confidence)
          VALUES (?,?,'subject',?,?)`,
    args: [Number(inserted.lastInsertRowid), event.entityId, event.entityEvidence || record.sourceKey, event.entityConfidence || 1],
  });
  return true;
}

async function completeBaseline(db, sourceId, meta, count, snapshot, dryRun) {
  if (dryRun) return;
  const record = { sourceKey: BASELINE_KEY, completedAt: new Date().toISOString(), count, rawObjectHash: snapshot.hash };
  await saveRecord(db, sourceId, record, semanticHash(record), 'added', null, snapshot.hash, false);
}

async function runVersionedDataset(options) {
  const { db, dryRun = false, meta, records, fetched, minimumRecords = 1, eventForChange, ensureEntity } = options;
  if (!Array.isArray(records) || records.length < minimumRecords) {
    throw new Error(`${meta.name}: verdacht volume ${records?.length || 0}, minimum ${minimumRecords}`);
  }
  const keys = records.map(record => record.sourceKey);
  if (keys.some(key => !key) || new Set(keys).size !== keys.length) throw new Error(`${meta.name}: ontbrekende of dubbele bronsleutel`);
  const sourceId = await ensureSource(db, meta, dryRun);
  const snapshot = await archiveSnapshot(db, sourceId, meta.name, fetched, dryRun);
  const state = await currentRecords(db, sourceId);
  const baseline = !state.baseline;
  const currentKeys = new Set(keys);
  let created = 0, changed = 0, removed = 0, events = 0, unchanged = 0;

  for (const input of records) {
    const record = { ...input };
    record.semanticHash ||= semanticHash(record.semanticFields || record);
    delete record.semanticFields;
    const old = state.records.get(record.sourceKey);
    if (isRecoveredUnconfirmed(old, record.semanticHash)) {
      unchanged++;
      await saveRecord(db, sourceId, record, record.semanticHash, 'changed', old.id, snapshot.hash, dryRun);
      continue;
    }
    if (old && old.changeType !== 'removed' && old.hash === record.semanticHash) { unchanged++; continue; }
    const changeType = !old || old.changeType === 'removed' ? 'added' : 'changed';
    if (changeType === 'added') created++; else changed++;
    let entityId = null;
    if (!baseline && ensureEntity) entityId = await ensureEntity(record, sourceId);
    if (!baseline && eventForChange) {
      const event = await eventForChange(changeType, record, old?.record || null, entityId);
      if (await emitEvent(db, sourceId, meta, record, old?.record || null, event, snapshot, dryRun)) events++;
    }
    await saveRecord(db, sourceId, record, record.semanticHash, changeType, old?.id, snapshot.hash, dryRun);
  }

  if (!baseline) for (const [sourceKey, old] of state.records) {
    if (old.changeType === 'removed' || currentKeys.has(sourceKey)) continue;
    const { tombstone, confirmed } = missingTransition(sourceKey, old);
    if (confirmed) {
      removed++;
      let entityId = null;
      if (ensureEntity) entityId = await ensureEntity(old.record, sourceId);
      if (eventForChange) {
        const event = await eventForChange('removed', tombstone, old.record, entityId);
        if (await emitEvent(db, sourceId, meta, tombstone, old.record, event, snapshot, dryRun)) events++;
      }
    }
    await saveRecord(db, sourceId, tombstone, tombstone.semanticHash, confirmed ? 'removed' : 'changed', old.id, snapshot.hash, dryRun);
  }
  if (baseline) await completeBaseline(db, sourceId, meta, records.length, snapshot, dryRun);
  return { sourceId, baseline, total: records.length, created: baseline ? 0 : created, changed: baseline ? 0 : changed,
    removed, unchanged, events, snapshotHash: snapshot.hash, snapshotUri: snapshot.storageUri };
}

function changedFields(previous, current, fields) {
  return fields.filter(field => semanticHash(previous?.[field]) !== semanticHash(current?.[field]));
}

module.exports = {
  BASELINE_KEY, LOCAL_PLACES, archiveSnapshot, canonicalize, changedFields, ensureSource, extractFirstZipEntry,
  ensureOrganization, fetchBuffer, isLocalPlace, isRecoveredUnconfirmed, missingTransition, normalizePlace, normalizeText, parseDelimited, rawHash,
  requireColumns, runVersionedDataset, semanticHash,
};
