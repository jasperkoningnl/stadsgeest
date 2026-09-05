// Adapter: Landelijk Register Kinderopvang (LRK) — diff-detectie
// CSV: https://www.landelijkregisterkinderopvang.nl/opendata/export_opendata_lrk.csv
// Semikolon-gescheiden, twee keer per week bijgewerkt (ma+vr).
// Detecteert: nieuwe/verdwenen locaties, houderwissels, capaciteitswijzigingen.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Landelijk Register Kinderopvang';
const CSV_URL = 'https://www.landelijkregisterkinderopvang.nl/opendata/export_opendata_lrk.csv';
const FILTER_CITIES = ['amersfoort', 'leusden'];

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class LrkKinderopvangAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
  }

  async _ensureSource() {
    const existing = await this.db.execute({
      sql: `SELECT id FROM sources WHERE name = ?`,
      args: [SOURCE_NAME],
    });
    if (existing.rows.length > 0) {
      this.sourceId = existing.rows[0].id;
      return;
    }
    const result = await this.db.execute({
      sql: `INSERT INTO sources (name, url, source_type, reliability, category, scrape_frequency,
              is_active, created_at, source_class, adapter_version)
            VALUES (?, ?, 'api', 'primary', 'registry', 'weekly',
              1, datetime('now'), 'AUTHORITATIVE_REGISTER', '1.0')`,
      args: [SOURCE_NAME, CSV_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[LRK] Bron geregistreerd: id=${this.sourceId}`);
  }

  /** Download en parse de CSV. Filter op lokale gemeenten. */
  async _fetchAndParse() {
    console.log('[LRK] CSV downloaden...');
    const response = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`CSV download mislukt: ${response.status}`);

    const text = await response.text();
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(';').map(h => h.trim());
    console.log(`[LRK] ${lines.length - 1} regels, ${headers.length} kolommen`);

    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';');
      const row = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

      // Filter op lokale gemeente of woonplaats
      const gemeente = (row.verantwoordelijke_gemeente || '').toLowerCase();
      const woonplaats = (row.opvanglocatie_woonplaats || '').toLowerCase();
      if (FILTER_CITIES.some(c => gemeente.includes(c) || woonplaats.includes(c))) {
        records.push(row);
      }
    }
    console.log(`[LRK] ${records.length} lokale locaties gevonden`);
    return records;
  }

  /** Maak een semantische hash van de relevante velden. */
  _semanticHash(row) {
    return [
      row.lrk_id, row.actuele_naam_oko, row.status,
      row.aantal_kindplaatsen, row.naam_houder,
      row.kvk_nummer_houder, row.type_oko,
    ].join('::');
  }

  /** Haal het vorige snapshot op uit source_records. */
  async _getPreviousSnapshot() {
    try {
      const result = await this.db.execute({
        sql: `SELECT raw_data FROM source_records
              WHERE source_id = ? AND record_type = 'snapshot'
              ORDER BY fetched_at DESC LIMIT 1`,
        args: [this.sourceId],
      });
      if (result.rows.length > 0) {
        return JSON.parse(result.rows[0].raw_data);
      }
    } catch { /* source_records bestaat misschien nog niet */ }
    return null;
  }

  /** Sla het huidige snapshot op in source_records. */
  async _saveSnapshot(records) {
    if (this.dryRun) return;
    // Sla een compact snapshot op: lrk_id -> hash
    const snapshot = {};
    for (const row of records) {
      snapshot[row.lrk_id] = {
        hash: this._semanticHash(row),
        naam: row.actuele_naam_oko,
        houder: row.naam_houder,
        kvk: row.kvk_nummer_houder,
        plaatsen: row.aantal_kindplaatsen,
        status: row.status,
        type: row.type_oko,
        adres: row.opvanglocatie_adres,
        postcode: row.opvanglocatie_postcode,
      };
    }
    try {
      await this.db.execute({
        sql: `INSERT INTO source_records (source_id, record_type, record_key,
                fetched_at, raw_data, semantic_hash)
              VALUES (?, 'snapshot', 'lrk_full', datetime('now'), ?, ?)`,
        args: [this.sourceId, JSON.stringify(snapshot), String(records.length)],
      });
    } catch (err) {
      console.error(`[LRK] Snapshot opslaan mislukt: ${err.message}`);
    }
  }

  /** Vergelijk huidig met vorig snapshot en detecteer wijzigingen. */
  _diff(currentRecords, previousSnapshot) {
    const events = [];
    const currentMap = {};

    for (const row of currentRecords) {
      const id = row.lrk_id;
      currentMap[id] = row;

      if (!previousSnapshot || !previousSnapshot[id]) {
        // Nieuwe locatie
        events.push({ type: 'CHILDCARE_OPENED', lrkId: id, row });
        continue;
      }

      const prev = previousSnapshot[id];
      const currentHash = this._semanticHash(row);

      if (currentHash !== prev.hash) {
        // Wijziging detecteren
        if (row.naam_houder !== prev.houder || row.kvk_nummer_houder !== prev.kvk) {
          events.push({ type: 'CHILDCARE_HOLDER_CHANGED', lrkId: id, row, prev });
        }
        if (row.aantal_kindplaatsen !== prev.plaatsen) {
          events.push({ type: 'CHILDCARE_CAPACITY_CHANGED', lrkId: id, row, prev });
        }
        if (row.status !== prev.status) {
          if (row.status.toLowerCase().includes('uitgeschreven')) {
            events.push({ type: 'CHILDCARE_CLOSED', lrkId: id, row, prev });
          } else {
            events.push({ type: 'CHILDCARE_STATUS_CHANGED', lrkId: id, row, prev });
          }
        }
      }
    }

    // Verdwenen locaties (in vorige snapshot maar niet in huidige)
    if (previousSnapshot) {
      for (const id of Object.keys(previousSnapshot)) {
        if (!currentMap[id]) {
          events.push({
            type: 'CHILDCARE_CLOSED',
            lrkId: id,
            row: null,
            prev: previousSnapshot[id],
          });
        }
      }
    }

    return events;
  }

  /** Verwerk een gedetecteerd event. */
  async _processEvent(event) {
    const row = event.row || {};
    const prev = event.prev || {};
    const naam = row.actuele_naam_oko || prev.naam || 'Onbekend';
    const lrkId = event.lrkId;
    const lrkUrl = row.lrk_url || `https://www.landelijkregisterkinderopvang.nl/pp/#/inzien/oko/gegevens/${lrkId}`;

    let title, description;
    switch (event.type) {
      case 'CHILDCARE_OPENED':
        title = `Nieuwe kinderopvang: ${naam}`;
        description = `${naam} (${row.type_oko}) ingeschreven in LRK met ${row.aantal_kindplaatsen} plaatsen. Houder: ${row.naam_houder}. Adres: ${row.opvanglocatie_adres}, ${row.opvanglocatie_woonplaats}.`;
        break;
      case 'CHILDCARE_CLOSED':
        title = `Kinderopvang gesloten: ${naam}`;
        description = `${naam} is uitgeschreven uit het LRK.`;
        break;
      case 'CHILDCARE_HOLDER_CHANGED':
        title = `Houderwissel kinderopvang: ${naam}`;
        description = `Houder gewijzigd van ${prev.houder || '?'} naar ${row.naam_houder}. KVK: ${row.kvk_nummer_houder}.`;
        break;
      case 'CHILDCARE_CAPACITY_CHANGED':
        title = `Capaciteitswijziging: ${naam}`;
        description = `Kindplaatsen gewijzigd van ${prev.plaatsen || '?'} naar ${row.aantal_kindplaatsen}.`;
        break;
      default:
        title = `LRK-wijziging: ${naam}`;
        description = `Status gewijzigd van ${prev.status || '?'} naar ${row.status}.`;
    }

    if (this.dryRun) {
      console.log(`[LRK][DRY] ${event.type}: ${title}`);
      return;
    }

    // Sla op als raw_item
    try {
      await this.db.execute({
        sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary,
                scraped_at, content_hash, is_processed, published_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0, datetime('now'))`,
        args: [
          this.sourceId, lrkUrl, title,
          JSON.stringify({ event: event.type, current: row, previous: prev }),
          description, `${event.type}::${lrkId}`,
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[LRK] raw_item fout: ${err.message}`);
    }

    // Maak kg_event
    try {
      await this.db.execute({
        sql: `INSERT INTO kg_events (event_type, source_id, source_url, source_identifier,
                title, description, occurred_at, fetched_at, raw_data, created_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, datetime('now'))`,
        args: [
          event.type, this.sourceId, lrkUrl, lrkId,
          title, description, JSON.stringify({ current: row, previous: prev }),
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[LRK] kg_event fout: ${err.message}`);
    }
  }

  async health() {
    try {
      const response = await fetch(CSV_URL, { method: 'HEAD', headers: { 'User-Agent': 'Stadsgeest/1.0' } });
      return {
        status: response.ok ? 'ok' : 'error',
        message: `CSV ${response.ok ? 'bereikbaar' : 'onbereikbaar'} (${response.status})`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { status: 'error', message: err.message, timestamp: new Date().toISOString() };
    }
  }

  async run() {
    console.log('[LRK] Start run...');
    await this._ensureSource();

    const records = await this._fetchAndParse();
    const previousSnapshot = await this._getPreviousSnapshot();
    const events = this._diff(records, previousSnapshot);

    console.log(`[LRK] ${events.length} wijzigingen gedetecteerd${previousSnapshot ? '' : ' (eerste run, alles is nieuw)'}`);

    // Bij eerste run: niet alle 200+ locaties als "nieuw" signaleren
    if (!previousSnapshot && events.length > 20) {
      console.log(`[LRK] Eerste run — snapshot opslaan zonder events te genereren`);
      await this._saveSnapshot(records);
      return { total: records.length, events: 0, note: 'eerste snapshot opgeslagen' };
    }

    for (const event of events) {
      await this._processEvent(event);
    }

    await this._saveSnapshot(records);

    // Log fetch run
    if (!this.dryRun) {
      try {
        await this.db.execute({
          sql: `INSERT INTO fetch_runs (source_id, adapter_class, started_at, finished_at,
                  items_found, items_new, items_changed, status)
                VALUES (?, 'LrkKinderopvang', datetime('now'), datetime('now'),
                  ?, ?, 0, 'ok')`,
          args: [this.sourceId, records.length, events.length],
        });
      } catch { /* fetch_runs mag falen */ }
    }

    const summary = { total: records.length, events: events.length };
    console.log(`[LRK] Klaar: ${JSON.stringify(summary)}`);
    return summary;
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const adapter = new LrkKinderopvangAdapter({ dryRun });
  adapter.run()
    .then(r => { console.log('Resultaat:', r); process.exit(0); })
    .catch(err => { console.error('Fataal:', err); process.exit(1); });
}

module.exports = { LrkKinderopvangAdapter };
