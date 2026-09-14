// Adapter: ANBI-register — Belastingdienst open data
// Bron: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/open_data_anbi
// Gecomprimeerd Excelbestand, wekelijks (dinsdag).
// Detecteert: nieuwe/verdwenen ANBI's, naamswijzigingen, websitewijzigingen.
// Identifier: RSIN (namespace RSIN).

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');
const { load } = require('cheerio');
const { parseXlsx } = require('../phase4-core.cjs');
const { normalizeText, semanticHash } = require('../phase3-core.cjs');

const SOURCE_NAME = 'ANBI-register — Belastingdienst open data';
const LANDING_URL = 'https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/open_data_anbi';
const FILTER_CITIES = new Set(['amersfoort', 'leusden']);

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

/**
 * Normaliseer een plaatsnaam voor vergelijking.
 * Verwijdert witruimte, converteert naar kleine letters.
 */
function normalizePlace(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Zoek de downloadlink voor het gecomprimeerde Excelbestand op de landingspagina.
 */
function discoverDownloadUrl(html) {
  const $ = load(html);
  let downloadUrl = null;

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const text = $(element).text() || '';
    // Zoek naar een link naar een ZIP/gecomprimeerd bestand met ANBI-data
    if (/\.(zip|xlsx)(\?|$)/i.test(href) || /download|gecomprimeerd|excel/i.test(text)) {
      if (/anbi/i.test(href) || /anbi/i.test(text)) {
        downloadUrl = href.startsWith('http') ? href : new URL(href, LANDING_URL).href;
      }
    }
  });

  // Fallback: zoek naar elke ZIP-link op de pagina
  if (!downloadUrl) {
    $('a[href*=".zip"], a[href*=".xlsx"]').each((_, element) => {
      const href = $(element).attr('href') || '';
      downloadUrl = downloadUrl || (href.startsWith('http') ? href : new URL(href, LANDING_URL).href);
    });
  }

  return downloadUrl;
}

/**
 * Parse de ANBI Excel-data naar records.
 * Verwachte kolommen: RSIN, dossiernummer, naam, vestigingsplaats, website, etc.
 * Kolomnamen kunnen variëren; we matchen flexibel.
 */
function parseAnbiRecords(sheets) {
  const records = [];
  for (const sheet of sheets) {
    if (sheet.rows.length < 2) continue;

    // Zoek de headerrij: de rij met kolommen die we herkennen
    let headerIndex = -1;
    let headers = [];
    for (let i = 0; i < Math.min(10, sheet.rows.length); i++) {
      const row = sheet.rows[i];
      const normalized = row.map(cell => normalizeText(String(cell || '')).toLowerCase());
      if (normalized.some(h => /rsin/.test(h)) || normalized.some(h => /dossiernummer/.test(h))) {
        headerIndex = i;
        headers = normalized;
        break;
      }
    }
    if (headerIndex < 0) continue;

    // Map kolomindexen
    const colMap = {};
    const patterns = {
      rsin: /rsin/,
      dossiernummer: /dossier/,
      naam: /^naam$|^naam_/,
      vestigingsplaats: /vestigings?\s*plaats/,
      website: /website|url/,
      ingangsdatum: /ingangs?\s*datum/,
      ophefdatum: /ophef|eind/,
      beschikking: /beschikking/,
      activiteit: /activiteit|doel/,
      type: /type|soort/,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const idx = headers.findIndex(h => pattern.test(h));
      if (idx >= 0) colMap[key] = idx;
    }

    if (colMap.rsin === undefined && colMap.dossiernummer === undefined) {
      // Geen bruikbare identifier-kolom gevonden
      continue;
    }

    // Parse rijen
    for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const record = {};
      for (const [key, idx] of Object.entries(colMap)) {
        record[key] = normalizeText(String(row[idx] ?? ''));
      }
      if (record.rsin || record.dossiernummer) {
        records.push(record);
      }
    }
  }
  return records;
}

/**
 * Filter records op lokale vestigingsplaats.
 */
function filterLocal(records) {
  return records.filter(record => {
    const plaats = normalizePlace(record.vestigingsplaats);
    return FILTER_CITIES.has(plaats);
  });
}

/**
 * Maak de unieke sleutel voor een ANBI-record.
 * Voorkeur RSIN; fallback dossiernummer.
 */
function recordKey(record) {
  return record.rsin || record.dossiernummer || '';
}

/**
 * Maak een semantische hash van de relevante velden.
 */
function anbiSemanticHash(record) {
  return [
    record.rsin || '',
    record.dossiernummer || '',
    record.naam || '',
    record.vestigingsplaats || '',
    record.website || '',
  ].join('::');
}

class AnbiRegisterAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
    // Optionele injectie voor testen
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
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
      args: [SOURCE_NAME, LANDING_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[ANBI] Bron geregistreerd: id=${this.sourceId}`);
  }

  /**
   * Download en parse het ANBI-register.
   * Stap 1: landingspagina ophalen voor downloadlink.
   * Stap 2: ZIP/Excel downloaden.
   * Stap 3: Excel parsen, lokaal filteren.
   */
  async _fetchAndParse() {
    console.log('[ANBI] Landingspagina ophalen...');
    const landingResponse = await this.fetchImpl(LANDING_URL, {
      headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!landingResponse.ok) throw new Error(`Landingspagina mislukt: ${landingResponse.status}`);
    const html = await landingResponse.text();

    const downloadUrl = discoverDownloadUrl(html);
    if (!downloadUrl) throw new Error('ANBI schemadrift: downloadlink niet gevonden op landingspagina');
    console.log(`[ANBI] Downloadlink: ${downloadUrl}`);

    console.log('[ANBI] Bestand downloaden...');
    const fileResponse = await this.fetchImpl(downloadUrl, {
      headers: {
        'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
        Accept: 'application/zip, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*',
      },
    });
    if (!fileResponse.ok) throw new Error(`Download mislukt: ${fileResponse.status}`);
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    console.log(`[ANBI] ${buffer.length} bytes ontvangen`);

    // Parse: probeer eerst als ZIP (gecomprimeerd Excel), dan als directe XLSX
    let sheets;
    try {
      sheets = parseXlsx(buffer);
    } catch {
      // Mogelijk een ZIP met daarin een XLSX
      const zlib = require('zlib');
      const { zipEntries } = require('../phase4-core.cjs');
      const entries = zipEntries(buffer);
      const xlsxEntry = [...entries.entries()].find(([name]) => /\.xlsx$/i.test(name));
      if (!xlsxEntry) throw new Error('ANBI schemadrift: geen XLSX gevonden in ZIP');
      sheets = parseXlsx(xlsxEntry[1]);
    }

    // Parse rijen uit de sheets
    const allRecords = parseAnbiRecords(sheets);
    console.log(`[ANBI] ${allRecords.length} records totaal geparsed`);

    const localRecords = filterLocal(allRecords);
    console.log(`[ANBI] ${localRecords.length} lokale ANBI's (Amersfoort/Leusden)`);

    return { allRecords, localRecords, downloadUrl };
  }

  /** Haal het vorige snapshot op uit source_records. */
  async _getPreviousSnapshot() {
    const result = await this.db.execute({
      sql: `SELECT id, raw_object, semantic_hash FROM source_records
            WHERE source_id = ? AND source_key = 'anbi_full'
            ORDER BY id DESC LIMIT 1`,
      args: [this.sourceId],
    });
    if (result.rows.length > 0) {
      return {
        id: Number(result.rows[0].id),
        snapshot: JSON.parse(result.rows[0].raw_object || '{}'),
        semanticHash: result.rows[0].semantic_hash,
      };
    }
    return null;
  }

  /** Sla het huidige snapshot op in source_records. */
  async _saveSnapshot(records, previousState = null) {
    if (this.dryRun) return;
    const snapshot = {};
    for (const record of records) {
      const key = recordKey(record);
      if (!key) continue;
      snapshot[key] = {
        hash: anbiSemanticHash(record),
        rsin: record.rsin || '',
        dossiernummer: record.dossiernummer || '',
        naam: record.naam || '',
        vestigingsplaats: record.vestigingsplaats || '',
        website: record.website || '',
      };
    }
    // Voeg pending removals toe zodat de volgende run ze herkent
    if (this._pendingRemovals) {
      for (const [key, pending] of Object.entries(this._pendingRemovals)) {
        if (!snapshot[key]) {
          snapshot[key] = pending;
        }
      }
    }
    const rawObject = JSON.stringify(snapshot);
    const newSemanticHash = crypto.createHash('sha256').update(rawObject).digest('hex');
    if (previousState?.semanticHash === newSemanticHash) return;
    const contentHash = crypto.createHash('sha256')
      .update(`${newSemanticHash}:${previousState?.id || 0}`)
      .digest('hex');
    await this.db.execute({
      sql: `INSERT INTO source_records
            (source_id, source_key, raw_object, content_hash, semantic_hash, previous_id, change_type)
            VALUES (?, 'anbi_full', ?, ?, ?, ?, ?)`,
      args: [this.sourceId, rawObject, contentHash, newSemanticHash,
        previousState?.id || null, previousState ? 'changed' : 'added'],
    });
  }

  /** Vergelijk huidig met vorig snapshot en detecteer wijzigingen. */
  _diff(currentRecords, previousSnapshot) {
    const events = [];
    const currentMap = {};
    this._pendingRemovals = {}; // wordt opgeslagen in snapshot

    for (const record of currentRecords) {
      const key = recordKey(record);
      if (!key) continue;
      currentMap[key] = record;

      if (!previousSnapshot || !previousSnapshot[key]) {
        events.push({ type: 'ANBI_ADDED', key, record });
        continue;
      }

      const prev = previousSnapshot[key];
      const currentHash = anbiSemanticHash(record);

      if (currentHash !== prev.hash) {
        if ((record.naam || '') !== (prev.naam || '')) {
          events.push({ type: 'ANBI_NAME_CHANGED', key, record, prev });
        }
        if ((record.website || '') !== (prev.website || '')) {
          events.push({ type: 'ANBI_WEBSITE_CHANGED', key, record, prev });
        }
      }
    }

    // Verdwenen ANBI's: tweerunsbevestiging.
    // Bij de eerste afwezigheid markeren we als kandidaat (_pending_removal = 1).
    // Pas als het record in twee opeenvolgende snapshots ontbreekt, melden we ANBI_REMOVED.
    if (previousSnapshot) {
      for (const key of Object.keys(previousSnapshot)) {
        if (!currentMap[key]) {
          const prev = previousSnapshot[key];
          if (prev._pending_removal) {
            // Tweede keer afwezig: bevestigd verwijderd — definitief uit snapshot
            events.push({
              type: 'ANBI_REMOVED',
              key,
              record: null,
              prev,
            });
            // NIET in _pendingRemovals opnemen: entry verdwijnt uit snapshot
          } else {
            // Eerste keer afwezig: markeer als pending voor volgende run
            console.log(`[ANBI] ${prev.naam || key} afwezig — wacht op bevestiging volgende run`);
            this._pendingRemovals[key] = { ...prev, _pending_removal: true };
          }
        }
      }
    }

    return events;
  }

  /** Verwerk een gedetecteerd event. */
  async _processEvent(event) {
    const record = event.record || {};
    const prev = event.prev || {};
    const naam = record.naam || prev.naam || 'Onbekend';
    const rsin = record.rsin || prev.rsin || event.key;
    const sourceUrl = LANDING_URL;

    let title, description;
    switch (event.type) {
      case 'ANBI_ADDED':
        title = `Nieuwe ANBI: ${naam}`;
        description = `${naam} (RSIN ${rsin}) is toegevoegd aan het ANBI-register. Vestigingsplaats: ${record.vestigingsplaats || '?'}. Website: ${record.website || 'geen'}.`;
        break;
      case 'ANBI_REMOVED':
        title = `ANBI-status verloren: ${naam}`;
        description = `${naam} (RSIN ${prev.rsin || rsin}) is verdwenen uit het ANBI-register.`;
        break;
      case 'ANBI_NAME_CHANGED':
        title = `ANBI naamswijziging: ${prev.naam || '?'} → ${naam}`;
        description = `De ANBI met RSIN ${rsin} heeft een naamswijziging: van "${prev.naam || '?'}" naar "${naam}".`;
        break;
      case 'ANBI_WEBSITE_CHANGED':
        title = `ANBI website gewijzigd: ${naam}`;
        description = `Website van ${naam} (RSIN ${rsin}) gewijzigd van "${prev.website || 'geen'}" naar "${record.website || 'geen'}".`;
        break;
      default:
        title = `ANBI-wijziging: ${naam}`;
        description = `Wijziging gedetecteerd voor ${naam} (RSIN ${rsin}).`;
    }

    if (this.dryRun) {
      console.log(`[ANBI][DRY] ${event.type}: ${title}`);
      return;
    }

    // Sla op als raw_item
    try {
      await this.db.execute({
        sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary,
                scraped_at, content_hash, is_processed, published_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0, datetime('now'))`,
        args: [
          this.sourceId, sourceUrl, title,
          JSON.stringify({ event: event.type, current: record, previous: prev }),
          description, `${event.type}::${rsin}`,
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[ANBI] raw_item fout: ${err.message}`);
    }

    // Maak kg_event
    try {
      await this.db.execute({
        sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                source_id, source_url, source_identifier, parser_version, provenance, created_at)
              VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, '1.0', ?, datetime('now'))`,
        args: [
          event.type, title, description,
          this.sourceId, sourceUrl, rsin,
          JSON.stringify({
            source_name: SOURCE_NAME,
            source_class: 'AUTHORITATIVE_REGISTER',
            source_url: sourceUrl,
            current: record,
            previous: prev,
          }),
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) console.error(`[ANBI] kg_event fout: ${err.message}`);
    }

    // Registreer RSIN als entity_identifier wanneer een entiteit kan worden gevonden
    if (record.rsin && !this.dryRun) {
      try {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url, verified_at)
                SELECT e.id, 'rsin', ?, ?, datetime('now')
                FROM kg_entities e
                WHERE e.canonical_name = ? AND e.entity_type = 'organization'
                LIMIT 1`,
          args: [record.rsin, sourceUrl, record.naam],
        });
      } catch {
        // Entiteit bestaat mogelijk nog niet; dat is prima
      }
    }
  }

  async health() {
    try {
      const response = await this.fetchImpl(LANDING_URL, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Stadsgeest/1.0' },
      });
      return {
        status: response.ok ? 'ok' : 'error',
        message: `Landingspagina ${response.ok ? 'bereikbaar' : 'onbereikbaar'} (${response.status})`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { status: 'error', message: err.message, timestamp: new Date().toISOString() };
    }
  }

  async run() {
    console.log('[ANBI] Start run...');
    await this._ensureSource();

    const { localRecords, downloadUrl } = await this._fetchAndParse();
    const previousState = await this._getPreviousSnapshot();
    const previousSnapshot = previousState?.snapshot || null;
    const events = this._diff(localRecords, previousSnapshot);

    console.log(`[ANBI] ${events.length} wijzigingen gedetecteerd${previousSnapshot ? '' : ' (baseline, alles is nieuw)'}`);

    // Baseline: sla snapshot op zonder events te genereren
    if (!previousSnapshot) {
      console.log(`[ANBI] Baseline — snapshot opslaan zonder events`);
      await this._saveSnapshot(localRecords, previousState);
      return { total: localRecords.length, events: 0, baseline: true, downloadUrl };
    }

    for (const event of events) {
      await this._processEvent(event);
    }

    await this._saveSnapshot(localRecords, previousState);

    const summary = {
      total: localRecords.length,
      events: events.length,
      baseline: false,
      created: events.filter(e => e.type === 'ANBI_ADDED').length,
      removed: events.filter(e => e.type === 'ANBI_REMOVED').length,
      changed: events.filter(e => e.type === 'ANBI_NAME_CHANGED' || e.type === 'ANBI_WEBSITE_CHANGED').length,
      downloadUrl,
    };
    console.log(`[ANBI] Klaar: ${JSON.stringify(summary)}`);
    return summary;
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const adapter = new AnbiRegisterAdapter({ dryRun });
  adapter.run()
    .then(r => { console.log('Resultaat:', r); process.exit(0); })
    .catch(err => { console.error('Fataal:', err); process.exit(1); });
}

module.exports = {
  AnbiRegisterAdapter,
  // Geëxporteerd voor testen
  parseAnbiRecords,
  filterLocal,
  recordKey,
  anbiSemanticHash,
  discoverDownloadUrl,
  normalizePlace,
};
