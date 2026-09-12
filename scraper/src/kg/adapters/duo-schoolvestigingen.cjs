// Adapter: DUO Open Onderwijsdata — schoolvestigingen BO en VO.
// Eerste productierun legt alleen een nulmeting vast. Latere runs maken events
// voor nieuwe, verdwenen of inhoudelijk gewijzigde lokale vestigingen.

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const API_URL = 'https://onderwijsdata.duo.nl/api/3/action/datastore_search';
const SOURCE_NAME = 'DUO — schoolvestigingen BO en VO';
const LOCAL_CITIES = new Set(['AMERSFOORT', 'LEUSDEN']);
const REQUIRED_FIELDS = [
  'INSTELLINGSCODE', 'VESTIGINGSCODE', 'VESTIGINGSNAAM',
  'STRAATNAAM', 'HUISNUMMER-TOEVOEGING', 'POSTCODE',
  'PLAATSNAAM', 'GEMEENTENAAM', 'BEVOEGD GEZAG NUMMER', 'DENOMINATIE',
];
const DATASETS = [
  {
    sector: 'bo',
    resourceId: 'dcc9c9a5-6d01-410b-967f-810557588ba4',
    pageUrl: 'https://onderwijsdata.duo.nl/datasets/adressen_bo/resources/dcc9c9a5-6d01-410b-967f-810557588ba4',
  },
  {
    sector: 'vo',
    resourceId: '5187f8d5-ff9c-4284-8e06-4311f0354956',
    pageUrl: 'https://onderwijsdata.duo.nl/datasets/adressen_vo/resources/5187f8d5-ff9c-4284-8e06-4311f0354956',
  },
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

function validateResponse(payload) {
  if (!payload?.success || !payload.result || !Array.isArray(payload.result.records)) {
    throw new Error('DUO API gaf geen geldige CKAN datastore-response');
  }
  const fieldNames = new Set((payload.result.fields || []).map(field => field.id));
  const missing = REQUIRED_FIELDS.filter(field => !fieldNames.has(field));
  if (missing.length > 0) {
    throw new Error(`DUO schema gewijzigd; ontbrekende velden: ${missing.join(', ')}`);
  }
  return payload.result;
}

function isLocalRecord(row) {
  return LOCAL_CITIES.has(String(row?.GEMEENTENAAM || '').trim().toUpperCase());
}

function normalizeDuoRecord(row, dataset) {
  if (!row?.VESTIGINGSCODE) throw new Error('DUO-record zonder VESTIGINGSCODE');
  const sector = dataset.sector;
  const vestigingscode = String(row.VESTIGINGSCODE).trim();
  const normalized = {
    sourceKey: `duo:${sector}:${vestigingscode}`,
    sector,
    instellingCode: String(row.INSTELLINGSCODE || '').trim(),
    vestigingscode,
    naam: String(row.VESTIGINGSNAAM || '').trim(),
    bevoegdGezagNummer: String(row['BEVOEGD GEZAG NUMMER'] || '').trim(),
    straat: String(row.STRAATNAAM || '').trim(),
    huisnummer: String(row['HUISNUMMER-TOEVOEGING'] || '').trim(),
    postcode: String(row.POSTCODE || '').replace(/\s+/g, '').toUpperCase(),
    plaats: String(row.PLAATSNAAM || '').trim().toUpperCase(),
    gemeente: String(row.GEMEENTENAAM || '').trim().toUpperCase(),
    denominatie: String(row.DENOMINATIE || '').trim(),
    onderwijsstructuur: String(row.ONDERWIJSSTRUCTUUR || '').trim(),
    sourceUrl: dataset.pageUrl,
  };
  normalized.contentHash = crypto.createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
  return normalized;
}

function diffRecord(previous, current) {
  if (!previous || previous._removed) return [{ type: 'SCHOOL_OPENED', field: null }];
  const changes = [];
  if (previous.naam !== current.naam) changes.push({ type: 'SCHOOL_RENAMED', field: 'naam', from: previous.naam, to: current.naam });
  if ([previous.straat, previous.huisnummer, previous.postcode, previous.plaats].join('|') !==
      [current.straat, current.huisnummer, current.postcode, current.plaats].join('|')) {
    changes.push({ type: 'SCHOOL_ADDRESS_CHANGED', field: 'adres' });
  }
  if (previous.bevoegdGezagNummer !== current.bevoegdGezagNummer) {
    changes.push({ type: 'SCHOOL_BOARD_CHANGED', field: 'bevoegdGezagNummer', from: previous.bevoegdGezagNummer, to: current.bevoegdGezagNummer });
  }
  if (previous.denominatie !== current.denominatie) {
    changes.push({ type: 'SCHOOL_DENOMINATION_CHANGED', field: 'denominatie', from: previous.denominatie, to: current.denominatie });
  }
  if (previous.onderwijsstructuur !== current.onderwijsstructuur) {
    changes.push({ type: 'SCHOOL_PROGRAMME_CHANGED', field: 'onderwijsstructuur', from: previous.onderwijsstructuur, to: current.onderwijsstructuur });
  }
  return changes;
}

class DuoSchoolvestigingenAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
  }

  async _ensureSource() {
    const existing = await this.db.execute({ sql: 'SELECT id FROM sources WHERE name=?', args: [SOURCE_NAME] });
    if (existing.rows.length > 0) {
      this.sourceId = existing.rows[0].id;
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
            VALUES (?, ?, 'api', 'primary', 'registry', 'daily',
                    1, datetime('now'), 'AUTHORITATIVE_REGISTER', '1.0')`,
      args: [SOURCE_NAME, DATASETS[0].pageUrl],
    });
    this.sourceId = Number(inserted.lastInsertRowid);
  }

  async _fetchDataset(dataset) {
    const records = [];
    for (const city of LOCAL_CITIES) {
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const params = new URLSearchParams({
          resource_id: dataset.resourceId,
          limit: '100',
          offset: String(offset),
          filters: JSON.stringify({ GEMEENTENAAM: city }),
        });
        const response = await fetch(`${API_URL}?${params}`, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
        });
        if (!response.ok) throw new Error(`DUO ${dataset.sector} API-fout ${response.status} voor ${city}`);
        const result = validateResponse(await response.json());
        total = Number(result.total || 0);
        records.push(...result.records.filter(isLocalRecord));
        if (result.records.length === 0) break;
        offset += result.records.length;
      }
    }
    const unique = new Map();
    for (const row of records) {
      const record = normalizeDuoRecord(row, dataset);
      unique.set(record.sourceKey, record);
    }
    return [...unique.values()];
  }

  async _loadPrevious() {
    if (this.sourceId < 0) return new Map();
    const result = await this.db.execute({
      sql: `SELECT sr.id, sr.source_key, sr.raw_object, sr.content_hash, sr.semantic_hash, sr.change_type
            FROM source_records sr
            JOIN (
              SELECT source_key, MAX(id) AS latest_id
              FROM source_records WHERE source_id=? GROUP BY source_key
            ) latest ON latest.latest_id=sr.id`,
      args: [this.sourceId],
    });
    return new Map(result.rows.map(row => [row.source_key, {
      id: row.id,
      record: JSON.parse(row.raw_object || '{}'),
      contentHash: row.semantic_hash || row.content_hash,
      changeType: row.change_type,
    }]));
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
      args: [this.sourceId, record.sourceKey, JSON.stringify(record), storageHash, record.contentHash, previousId, changeType],
    });
  }

  async _ensureEntity(record) {
    if (this.dryRun) return null;
    // Het bestaande schema kent geen apart DUO-identifiertype. Gebruik daarom
    // een stabiele, brongebonden URL als website-identificatie.
    const identifierValue = `${record.sourceUrl}#${record.sector}:${record.vestigingscode}`;
    let found = await this.db.execute({
      sql: `SELECT entity_id FROM entity_identifiers WHERE identifier_type='website' AND value=?`,
      args: [identifierValue],
    });
    let entityId;
    if (found.rows.length > 0) {
      entityId = Number(found.rows[0].entity_id);
      await this.db.execute({
        sql: `UPDATE kg_entities SET canonical_name=?, normalized_name=?, updated_at=datetime('now') WHERE id=?`,
        args: [record.naam, normalizeName(record.naam), entityId],
      });
    } else {
      const inserted = await this.db.execute({
        sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name) VALUES ('organization', ?, ?)`,
        args: [record.naam, normalizeName(record.naam)],
      });
      entityId = Number(inserted.lastInsertRowid);
      await this.db.execute({
        sql: `INSERT INTO entity_identifiers (entity_id, identifier_type, value, source_url, verified_at)
              VALUES (?, 'website', ?, ?, datetime('now'))`,
        args: [entityId, identifierValue, record.sourceUrl],
      });
    }
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO kg_aliases
            (entity_id, alias, normalized_alias, match_mode, source, score_weight)
            VALUES (?, ?, ?, 'ci', 'DUO', 45)`,
      args: [entityId, record.naam, normalizeName(record.naam)],
    });

    let location = await this.db.execute({
      sql: `SELECT id FROM locations
            WHERE postal_code=? AND street=? AND house_number=? AND city=? LIMIT 1`,
      args: [record.postcode, record.straat, record.huisnummer, record.plaats],
    });
    let locationId;
    if (location.rows.length > 0) {
      locationId = Number(location.rows[0].id);
    } else {
      const inserted = await this.db.execute({
        sql: `INSERT INTO locations (label, street, house_number, postal_code, city, municipality)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [`${record.straat} ${record.huisnummer}, ${record.plaats}`, record.straat, record.huisnummer, record.postcode, record.plaats, record.gemeente],
      });
      locationId = Number(inserted.lastInsertRowid);
    }
    await this.db.execute({
      sql: `UPDATE entity_locations SET valid_until=datetime('now')
            WHERE entity_id=? AND relation_type='vestiging' AND valid_until IS NULL AND location_id!=?`,
      args: [entityId, locationId],
    });
    await this.db.execute({
      sql: `UPDATE entity_locations SET valid_until=NULL, source_url=?
            WHERE entity_id=? AND location_id=? AND relation_type='vestiging'`,
      args: [record.sourceUrl, entityId, locationId],
    });
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO entity_locations
            (entity_id, location_id, relation_type, valid_from, source_url)
            VALUES (?, ?, 'vestiging', datetime('now'), ?)`,
      args: [entityId, locationId, record.sourceUrl],
    });
    return entityId;
  }

  async _emitEvent(type, record, previous, entityId) {
    if (this.dryRun) return;
    const existing = await this.db.execute({
      sql: `SELECT id FROM kg_events
            WHERE source_id=? AND source_identifier=? AND event_type=? AND raw_object_hash=? LIMIT 1`,
      args: [this.sourceId, record.sourceKey, type, record.contentHash],
    });
    if (existing.rows.length > 0) return;
    const labels = {
      SCHOOL_OPENED: 'Nieuwe schoolvestiging',
      SCHOOL_CLOSED: 'Schoolvestiging verdwenen uit DUO-register',
      SCHOOL_RENAMED: 'Schoolvestiging hernoemd',
      SCHOOL_ADDRESS_CHANGED: 'Adreswijziging schoolvestiging',
      SCHOOL_BOARD_CHANGED: 'Bestuurswijziging schoolvestiging',
      SCHOOL_DENOMINATION_CHANGED: 'Denominatiewijziging schoolvestiging',
      SCHOOL_PROGRAMME_CHANGED: 'Onderwijsaanbod schoolvestiging gewijzigd',
    };
    const title = `${labels[type] || 'DUO-registerwijziging'}: ${record.naam}`;
    const summary = `${record.naam} (${record.sector.toUpperCase()}, ${record.vestigingscode}) — ${record.straat} ${record.huisnummer}, ${record.plaats}.`;
    const inserted = await this.db.execute({
      sql: `INSERT INTO kg_events
            (event_type, title, summary, occurred_at, fetched_at, source_id,
             source_url, source_identifier, raw_object_hash, parser_version, provenance)
            VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, '1.0', ?)`,
      args: [type, title, summary, this.sourceId, record.sourceUrl, record.sourceKey,
        record.contentHash, JSON.stringify({ source_name: SOURCE_NAME, source_class: 'AUTHORITATIVE_REGISTER', current: record, previous })],
    });
    if (entityId) {
      await this.db.execute({
        sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
              VALUES (?, ?, 'subject', 'DUO vestigingscode', 1.0)`,
        args: [Number(inserted.lastInsertRowid), entityId],
      });
    }
  }

  async run() {
    await this._ensureSource();
    const records = (await Promise.all(DATASETS.map(dataset => this._fetchDataset(dataset)))).flat();
    const previous = await this._loadPrevious();
    const baseline = previous.size === 0;
    let created = 0, changed = 0, removed = 0, events = 0;
    const currentKeys = new Set();

    for (const record of records) {
      currentKeys.add(record.sourceKey);
      const old = previous.get(record.sourceKey);
      const unchanged = old && old.changeType !== 'removed' && old.contentHash === record.contentHash;
      const entityId = await this._ensureEntity(record);
      if (unchanged) continue;
      const changes = baseline ? [] : diffRecord(old?.record, record);
      for (const change of changes) {
        await this._emitEvent(change.type, record, old?.record || null, entityId);
        events++;
      }
      if (!baseline) {
        if (!old || old.changeType === 'removed') created++;
        else changed++;
      }
      await this._saveRecord(record, baseline ? 'added' : (!old || old.changeType === 'removed' ? 'added' : 'changed'), old?.id || null);
    }

    if (!baseline) {
      for (const [sourceKey, old] of previous) {
        if (old.changeType === 'removed' || currentKeys.has(sourceKey)) continue;
        const record = { ...old.record, _removed: true };
        record.contentHash = crypto.createHash('sha256').update(`${old.contentHash}:removed`).digest('hex');
        const entityId = await this._ensureEntity(old.record);
        await this._emitEvent('SCHOOL_CLOSED', old.record, old.record, entityId);
        await this._saveRecord(record, 'removed', old.id || null);
        removed++;
        events++;
      }
    }

    const result = { total: records.length, baseline, created, changed, removed, events };
    console.log(`[DUO] ${baseline ? 'Nulmeting' : 'Run'}: ${JSON.stringify(result)}`);
    return result;
  }
}

if (require.main === module) {
  const adapter = new DuoSchoolvestigingenAdapter({ dryRun: process.argv.includes('--dry-run') });
  adapter.run()
    .then(result => { console.log('[DUO] Resultaat:', JSON.stringify(result, null, 2)); process.exit(0); })
    .catch(error => { console.error('[DUO] Fatale fout:', error); process.exit(1); });
}

module.exports = {
  DATASETS,
  DuoSchoolvestigingenAdapter,
  diffRecord,
  isLocalRecord,
  normalizeDuoRecord,
  validateResponse,
};
