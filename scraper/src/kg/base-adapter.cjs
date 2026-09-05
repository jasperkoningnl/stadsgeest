// BaseAdapter — Stadsgeest 2.0 adaptercontract
// Elke bronadapter erft hiervan en implementeert minimaal discover() en fetch().
// De run()-methode orkestreert: discover → fetch → parse → normalize → diff → emit → health.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class BaseAdapter {
  constructor(config) {
    this.sourceId = config.sourceId;
    this.sourceName = config.sourceName;
    this.sourceClass = config.sourceClass; // AUTHORITATIVE_REGISTER, AUTHORITATIVE_EVENT, etc.
    this.version = config.version || '1.0.0';
    this.schedule = config.schedule || 'daily';
    this.expectedUpdateHours = config.expectedUpdateHours || 24;
    this.localFilters = config.localFilters || { places: ['Amersfoort', 'Leusden'] };
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
  }

  /**
   * Ontdek beschikbare bronrecords.
   * @param {string|null} cursor - Vervolg vanaf dit punt (paginering)
   * @param {object} window - Tijdvenster { from, to }
   * @returns {Promise<{references: SourceReference[], nextCursor: string|null}>}
   *
   * SourceReference: { sourceKey, url, etag?, lastModified?, metadata? }
   */
  async discover(cursor, window) {
    throw new Error('discover() moet worden geïmplementeerd door de adapter');
  }

  /**
   * Haal een enkel bronrecord op.
   * @param {SourceReference} reference
   * @param {object} conditionalHeaders - { etag, lastModified }
   * @returns {Promise<RawObject|null>} null bij 304 Not Modified
   *
   * RawObject: { sourceKey, body, contentHash, headers?, fetchedAt }
   */
  async fetch(reference, conditionalHeaders = {}) {
    throw new Error('fetch() moet worden geïmplementeerd door de adapter');
  }

  /**
   * Parseer een ruw object naar gestructureerde records.
   * Standaard: geeft het object ongewijzigd terug als array.
   */
  async parse(rawObject) {
    return [rawObject];
  }

  /**
   * Normaliseer een record naar canoniek formaat.
   * Standaard: trim whitespace in string-velden.
   */
  async normalize(record) {
    if (record && typeof record === 'object') {
      const out = { ...record };
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string') out[k] = v.trim();
      }
      return out;
    }
    return record;
  }

  /**
   * Vergelijk vorig en huidig record via semantic_hash.
   * @returns {Array<{type: 'added'|'changed'|'removed', record?, previous?, current?}>}
   */
  async diff(previous, current) {
    if (!previous) return [{ type: 'added', record: current }];
    if (!current) return [{ type: 'removed', record: previous }];
    if (previous.contentHash === current.contentHash) return [];
    return [{ type: 'changed', previous, current }];
  }

  /**
   * Genereer entity-kandidaten, relatie-kandidaten en events uit een wijziging.
   * Standaard: leeg. Adapter-specifieke implementaties vullen dit in.
   */
  async emit(change) {
    return { entities: [], relations: [], events: [] };
  }

  /**
   * Beoordeel de gezondheid van deze bron op basis van recente fetch_runs.
   */
  async health(fetchRunHistory) {
    const recent = (fetchRunHistory || []).slice(0, 12);
    if (recent.length === 0) return 'onbekend';
    const consecutiveEmpty = recent.findIndex(r => r.records_found > 0);
    if (consecutiveEmpty === -1 && recent.length >= 12) return 'dood';
    if (consecutiveEmpty >= 12) return 'dood';
    const errors = recent.filter(r => r.status === 'error').length;
    if (consecutiveEmpty >= 6 || errors >= 3) return 'verdacht';
    return 'ok';
  }

  /**
   * Haal het vorige source_record op voor diffing.
   */
  async _getPreviousRecord(sourceKey) {
    if (!this.db || this.dryRun) return null;
    const result = await this.db.execute({
      sql: `SELECT id, content_hash, semantic_hash, raw_object
            FROM source_records
            WHERE source_id = ? AND source_key = ?
            ORDER BY fetched_at DESC LIMIT 1`,
      args: [this.sourceId, sourceKey],
    });
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Sla een source_record op (snapshot voor diff).
   */
  async _saveRecord(sourceKey, rawObject, contentHash, semanticHash, changeType, previousId) {
    if (!this.db || this.dryRun) return;
    await this.db.execute({
      sql: `INSERT INTO source_records (source_id, source_key, raw_object, content_hash, semantic_hash, change_type, previous_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [this.sourceId, sourceKey, JSON.stringify(rawObject), contentHash, semanticHash || null, changeType, previousId || null],
    });
  }

  /**
   * Voer een volledige run uit: discover → fetch → parse → normalize → diff → emit.
   * Logt naar fetch_runs.
   */
  async run(options = {}) {
    const startedAt = new Date().toISOString();
    const window = options.window || {};
    let status = 'ok';
    let recordsFound = 0, recordsNew = 0, recordsChanged = 0, recordsRemoved = 0;
    let errorMessage = null;
    let httpStatus = null;
    const emitted = { entities: [], relations: [], events: [] };

    try {
      let cursor = null;
      do {
        const discovered = await this.discover(cursor, window);
        const references = discovered.references || [];
        cursor = discovered.nextCursor || null;

        for (const ref of references) {
          recordsFound++;
          try {
            const previous = await this._getPreviousRecord(ref.sourceKey);
            const raw = await this.fetch(ref, {
              etag: previous?.etag,
              lastModified: previous?.lastModified,
            });
            if (!raw) continue; // 304 Not Modified

            const records = await this.parse(raw);
            for (const rec of records) {
              const normalized = await this.normalize(rec);
              const changes = await this.diff(
                previous ? { contentHash: previous.content_hash, ...JSON.parse(previous.raw_object || '{}') } : null,
                normalized
              );

              for (const change of changes) {
                if (change.type === 'added') recordsNew++;
                if (change.type === 'changed') recordsChanged++;
                if (change.type === 'removed') recordsRemoved++;

                const result = await this.emit(change);
                if (result.entities) emitted.entities.push(...result.entities);
                if (result.relations) emitted.relations.push(...result.relations);
                if (result.events) emitted.events.push(...result.events);
              }

              // Sla snapshot op
              const changeType = changes.length > 0 ? changes[0].type : null;
              if (changeType) {
                await this._saveRecord(
                  ref.sourceKey, normalized, raw.contentHash,
                  normalized.semanticHash || null, changeType,
                  previous?.id || null
                );
              }
            }
          } catch (fetchErr) {
            console.error(`[${this.sourceName}] Fout bij ${ref.sourceKey}: ${fetchErr.message}`);
            // Ga door met de volgende reference
          }
        }
      } while (cursor);

      if (recordsFound === 0) status = 'empty';
    } catch (err) {
      status = 'error';
      errorMessage = err.message?.substring(0, 500);
      httpStatus = err.httpStatus || null;
    }

    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt) - new Date(startedAt);

    // Log naar fetch_runs
    if (this.db && !this.dryRun) {
      try {
        await this.db.execute({
          sql: `INSERT INTO fetch_runs (source_id, adapter_version, started_at, finished_at, status,
                records_found, records_new, records_changed, records_removed, error_message, http_status, duration_ms)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [this.sourceId, this.version, startedAt, finishedAt,
                 status, recordsFound, recordsNew, recordsChanged, recordsRemoved,
                 errorMessage, httpStatus, durationMs],
        });
      } catch (logErr) {
        console.error(`[${this.sourceName}] Kon fetch_run niet loggen: ${logErr.message}`);
      }
    }

    const result = {
      status, recordsFound, recordsNew, recordsChanged, recordsRemoved,
      errorMessage, durationMs, emitted,
    };
    console.log(`[${this.sourceName}] ${status}: ${recordsFound} gevonden, ${recordsNew} nieuw, ${recordsChanged} gewijzigd (${durationMs}ms)`);
    return result;
  }
}

module.exports = { BaseAdapter, createDb };
