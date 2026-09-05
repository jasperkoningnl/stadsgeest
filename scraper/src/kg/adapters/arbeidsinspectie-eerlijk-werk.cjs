// Adapter: Nederlandse Arbeidsinspectie — Eerlijk Werk
// Bron: resultaten.nlarbeidsinspectie.nl
// API: /api/inspecties?searchString=<stad>&currentPage=<n>&sortColumn=Inspectie&sortDescending=true
// Levert inspectieresultaten op voor WML, Wav en Waadi.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_ID = 'nlarbeidsinspectie_eerlijk_werk';
const SOURCE_NAME = 'Nederlandse Arbeidsinspectie — Eerlijk Werk';
const BASE_URL = 'https://resultaten.nlarbeidsinspectie.nl';
const API_PATH = '/api/inspecties';
const SEARCH_CITIES = ['Amersfoort', 'Leusden'];
const DETAIL_URL_TEMPLATE = `${BASE_URL}/#/inspectie/`;

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class ArbeidsinspectieEerlijkWerkAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
  }

  /** Zorg dat de bron geregistreerd staat in sources. */
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
            VALUES (?, ?, 'api', 'primary', 'government', 'daily',
              1, datetime('now'), 'AUTHORITATIVE_EVENT', '1.0')`,
      args: [SOURCE_NAME, BASE_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[ArbInsp] Bron geregistreerd: id=${this.sourceId}`);
  }

  /** Haal inspectieresultaten op via de API voor een specifieke stad. */
  async _fetchPage(city, page = 1) {
    const url = `${BASE_URL}${API_PATH}?currentPage=${page}&sortColumn=Inspectie&sortDescending=true&searchString=${encodeURIComponent(city)}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
      },
    });
    if (!response.ok) {
      throw new Error(`API-fout ${response.status} voor ${city} pagina ${page}`);
    }
    return response.json();
  }

  /** Haal alle pagina's op voor alle zoeksteden. Dedupliceer op inspectie-ID. */
  async discover() {
    const allResults = new Map();

    for (const city of SEARCH_CITIES) {
      let page = 1;
      let pageCount = 1;

      while (page <= pageCount) {
        const data = await this._fetchPage(city, page);
        pageCount = data.SearchResultInfo?.PageCount || 1;

        for (const result of (data.Results || [])) {
          if (!allResults.has(result.Id)) {
            allResults.set(result.Id, result);
          }
        }
        page++;

        // Rate limiting: 500ms tussen requests
        if (page <= pageCount) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.log(`[ArbInsp] ${city}: ${allResults.size} unieke resultaten na ${pageCount} pagina's`);

      // Pauze tussen steden
      if (SEARCH_CITIES.indexOf(city) < SEARCH_CITIES.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return [...allResults.values()];
  }

  /** Filter: inspectieplaats of vestigingsplaats moet lokaal zijn. */
  _isLocallyRelevant(result) {
    const lowerCities = SEARCH_CITIES.map(c => c.toLowerCase());
    const inspPlace = (result.Inspectieplaats || '').toLowerCase();
    const bedrijfPlace = (result.BedrijfPlaats || '').toLowerCase();
    return lowerCities.some(c => inspPlace.includes(c) || bedrijfPlace.includes(c));
  }

  /** Normaliseer een API-resultaat naar een uniform formaat. */
  _normalize(result) {
    const overtredingen = (result.Inspectieresultaten || []).map(r => ({
      omschrijving: r.Omschrijving || r.OmschrijvingKort || 'Onbekend',
      resultaat: r.Resultaat || 'Onbekend',
    }));

    const heeftOvertreding = overtredingen.some(o =>
      o.resultaat.toLowerCase().includes('overtreding vastgesteld') &&
      !o.resultaat.toLowerCase().includes('geen')
    );

    return {
      externalId: String(result.Id),
      bedrijfsnaam: result.Bedrijfsnaam || '-',
      bedrijfPlaats: result.BedrijfPlaats || '-',
      inspectieplaats: result.Inspectieplaats || '-',
      inspectiedatum: result.Inspectiedatum || null,
      overtredingen,
      heeftOvertreding,
      detailUrl: `${DETAIL_URL_TEMPLATE}${result.Id}`,
    };
  }

  /** Bereken een semantische hash voor diff-detectie. */
  _semanticHash(normalized) {
    const parts = [
      normalized.externalId,
      normalized.bedrijfsnaam,
      normalized.heeftOvertreding ? '1' : '0',
      normalized.overtredingen.map(o => `${o.omschrijving}|${o.resultaat}`).join(';'),
    ];
    return parts.join('::');
  }

  /** Sla een inspectieresultaat op als raw_item + maak kg_event aan. */
  async _processResult(normalized) {
    // Check of dit item al bestaat (dedup op external ID)
    const existing = await this.db.execute({
      sql: `SELECT id, content_hash FROM raw_items WHERE source_id = ? AND external_url = ?`,
      args: [this.sourceId, normalized.detailUrl],
    });

    const semanticHash = this._semanticHash(normalized);

    if (existing.rows.length > 0) {
      if (existing.rows[0].content_hash === semanticHash) {
        return { action: 'unchanged', id: existing.rows[0].id };
      }
      await this.db.execute({
        sql: `UPDATE raw_items SET content_hash = ?, summary = ?, scraped_at = datetime('now') WHERE id = ?`,
        args: [semanticHash, this._makeSummary(normalized), existing.rows[0].id],
      });
      return { action: 'updated', id: existing.rows[0].id };
    }

    // Nieuw item
    const title = `Inspectie ${normalized.bedrijfsnaam} — ${normalized.inspectieplaats}`;
    const summary = this._makeSummary(normalized);
    const content = JSON.stringify(normalized, null, 2);

    if (this.dryRun) {
      console.log(`[ArbInsp][DRY] Nieuw: ${title}`);
      return { action: 'dry_run', id: null };
    }

    const result = await this.db.execute({
      sql: `INSERT INTO raw_items (source_id, external_url, title, content, summary,
              scraped_at, content_hash, is_processed, published_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0, ?)`,
      args: [
        this.sourceId, normalized.detailUrl, title, content, summary,
        semanticHash, normalized.inspectiedatum,
      ],
    });

    const rawItemId = Number(result.lastInsertRowid);
    await this._createEvent(normalized, rawItemId);
    return { action: 'created', id: rawItemId };
  }

  _makeSummary(normalized) {
    const parts = [`${normalized.bedrijfsnaam} (${normalized.bedrijfPlaats})`];
    parts.push(`geinspecteerd in ${normalized.inspectieplaats}`);
    if (normalized.inspectiedatum) {
      const d = new Date(normalized.inspectiedatum);
      parts.push(`op ${d.toLocaleDateString('nl-NL')}`);
    }
    if (normalized.heeftOvertreding) {
      const types = normalized.overtredingen
        .filter(o => o.resultaat.toLowerCase().includes('overtreding vastgesteld') && !o.resultaat.toLowerCase().includes('geen'))
        .map(o => o.omschrijving);
      parts.push(`— overtreding: ${types.join(', ')}`);
    } else {
      parts.push('— geen overtreding');
    }
    return parts.join(' ');
  }

  /** Maak een kg_event aan voor dit inspectieresultaat. */
  async _createEvent(normalized, rawItemId) {
    const eventType = normalized.heeftOvertreding ? 'INSPECTION_VIOLATION' : 'INSPECTION_CLEAR';
    try {
      await this.db.execute({
        sql: `INSERT INTO kg_events (event_type, source_id, source_url, source_identifier,
                title, summary, occurred_at, fetched_at, provenance)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
        args: [
          eventType, this.sourceId, normalized.detailUrl, normalized.externalId,
          `Inspectie ${normalized.bedrijfsnaam}`,
          this._makeSummary(normalized), normalized.inspectiedatum,
          JSON.stringify(normalized),
        ],
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE')) {
        console.error(`[ArbInsp] Event-fout: ${err.message}`);
      }
    }
  }

  /** Health check: test of de API bereikbaar is. */
  async health() {
    try {
      const data = await this._fetchPage('Amersfoort', 1);
      const count = data.SearchResultInfo?.TotalCount || 0;
      return {
        status: count > 0 ? 'ok' : 'warn',
        message: `API bereikbaar, ${count} resultaten voor Amersfoort`,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { status: 'error', message: err.message, timestamp: new Date().toISOString() };
    }
  }

  /** Draai de volledige adapter-cyclus. */
  async run() {
    console.log(`[ArbInsp] Start run...`);
    await this._ensureSource();

    const results = await this.discover();
    console.log(`[ArbInsp] ${results.length} resultaten opgehaald`);

    let created = 0, updated = 0, unchanged = 0, skipped = 0;

    for (const result of results) {
      const normalized = this._normalize(result);
      if (!this._isLocallyRelevant(result)) {
        skipped++;
        continue;
      }
      const outcome = await this._processResult(normalized);
      if (outcome.action === 'created') created++;
      else if (outcome.action === 'updated') updated++;
      else if (outcome.action === 'unchanged') unchanged++;
    }

    // Log fetch run
    if (!this.dryRun) {
      try {
        await this.db.execute({
          sql: `INSERT INTO fetch_runs (source_id, adapter_class, started_at, finished_at,
                  items_found, items_new, items_changed, status)
                VALUES (?, 'ArbeidsinspectieEerlijkWerk', datetime('now'), datetime('now'),
                  ?, ?, ?, 'ok')`,
          args: [this.sourceId, results.length, created, updated],
        });
      } catch { /* fetch_runs mag falen */ }
    }

    const summary = { total: results.length, created, updated, unchanged, skipped };
    console.log(`[ArbInsp] Klaar: ${JSON.stringify(summary)}`);
    return summary;
  }
}

// CLI: node src/kg/adapters/arbeidsinspectie-eerlijk-werk.cjs [--dry-run]
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const adapter = new ArbeidsinspectieEerlijkWerkAdapter({ dryRun });
  adapter.run()
    .then(r => { console.log('Resultaat:', r); process.exit(0); })
    .catch(err => { console.error('Fataal:', err); process.exit(1); });
}

module.exports = { ArbeidsinspectieEerlijkWerkAdapter };
