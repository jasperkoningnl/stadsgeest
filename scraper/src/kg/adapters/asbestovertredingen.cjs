// Adapter: Nederlandse Arbeidsinspectie — ernstige asbestovertredingen
// Bron: https://asbestovertredingen.nlarbeidsinspectie.nl/
// Detecteert: boetes en stilleggingen bij asbestwerk in Amersfoort/Leusden.
// HTML-scraper: overzichtspagina → detailpagina's → lokale filtering.

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Nederlandse Arbeidsinspectie — asbestovertredingen';
const BASE_URL = 'https://asbestovertredingen.nlarbeidsinspectie.nl';
const FILTER_CITIES = ['amersfoort', 'leusden'];
const LOCAL_POSTCODES = /^38[0-9]{2}/;

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class AsbestovertredingenAdapter {
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
            VALUES (?, ?, 'scrape', 'primary', 'government', 'daily',
              1, datetime('now'), 'AUTHORITATIVE_EVENT', '1.0')`,
      args: [SOURCE_NAME, BASE_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[Asbest] Bron geregistreerd: id=${this.sourceId}`);
  }

  /** Haal alle overtreding-links op van de overzichtspagina's. */
  async _fetchOvertredingLinks() {
    const allLinks = new Set();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;
      console.log(`[Asbest] Overzichtspagina ${page}...`);

      const response = await fetch(url, {
        headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
      });
      if (!response.ok) {
        console.warn(`[Asbest] Pagina ${page} mislukt: ${response.status}`);
        break;
      }

      const html = await response.text();
      const linkRegex = /href="\/overtredingen\/([^"]+)"/g;
      let match;
      let foundOnPage = 0;

      while ((match = linkRegex.exec(html)) !== null) {
        const slug = match[1];
        if (!allLinks.has(slug)) {
          allLinks.add(slug);
          foundOnPage++;
        }
      }

      // Check of er een volgende pagina is
      hasMore = foundOnPage > 0 && html.includes(`page=${page + 1}`);
      page++;

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[Asbest] ${allLinks.size} unieke overtredingen gevonden`);
    return [...allLinks];
  }

  /** Haal detailpagina op en parse locatie- en overtredingsgegevens. */
  async _fetchDetail(slug) {
    const url = `${BASE_URL}/overtredingen/${slug}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) return null;

    const html = await response.text();

    // Parse velden uit de HTML
    const getField = (label) => {
      const regex = new RegExp(`${label}[^:]*:\\s*([^<]+)`, 'i');
      const m = html.match(regex);
      return m ? m[1].trim() : '';
    };

    const bedrijf = getField('Naam overtreder') || getField('Bedrijfsnaam') || slug.replace(/^\d+-/, '').replace(/-/g, ' ');
    const plaatsOvertreder = getField('Plaats overtreder');

    // Locatie overtreding: staat in een <h2>Locatie overtreding</h2> blok
    let locatieText = '';
    const locatieMatch = html.match(/<h2>Locatie overtreding<\/h2>\s*<p>([\s\S]*?)<\/p>/i);
    if (locatieMatch) {
      locatieText = locatieMatch[1].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').trim();
    }

    // Stillegging
    const stillegging = getField('Stillegging') || (html.toLowerCase().includes('stillegging: ja') ? 'Ja' : '');

    // Boetebedrag
    const boeteMatch = html.match(/Boetebedrag[^:]*:\s*[€]?\s*([\d.,]+)/i);
    const boete = boeteMatch ? `€${boeteMatch[1]}` : '';

    // Overtredingen
    const overtredingenMatch = html.match(/<h2>Overtreding\(en\)<\/h2>\s*<ul>([\s\S]*?)<\/ul>/i);
    let overtredingen = '';
    if (overtredingenMatch) {
      overtredingen = overtredingenMatch[1].replace(/<li>/g, '').replace(/<\/li>/g, '; ').replace(/<[^>]+>/g, '').trim();
    }

    // Datum
    const datumMatch = html.match(/Datum overtreding[^:]*:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i)
      || html.match(/Datum inspectie[^:]*:\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i);
    const datum = datumMatch ? datumMatch[1] : '';

    return {
      slug,
      url,
      bedrijf,
      plaatsOvertreder,
      locatieText,
      stillegging,
      boete,
      overtredingen,
      datum,
    };
  }

  /** Check of een overtreding lokaal relevant is. */
  _isLocallyRelevant(detail) {
    const allText = `${detail.plaatsOvertreder} ${detail.locatieText}`.toLowerCase();
    if (FILTER_CITIES.some(c => allText.includes(c))) return true;

    // Check postcode
    const postcodeMatch = allText.match(/\b(\d{4})\s*[A-Za-z]{2}\b/);
    if (postcodeMatch && LOCAL_POSTCODES.test(postcodeMatch[1])) return true;

    return false;
  }

  async run() {
    await this._ensureSource();
    const slugs = await this._fetchOvertredingLinks();

    // Check welke slugs we al kennen
    const [knownRecords, knownEvents] = await Promise.all([
      this.db.execute({
        sql: `SELECT DISTINCT source_key FROM source_records WHERE source_id = ?`,
        args: [this.sourceId],
      }),
      this.db.execute({
        sql: `SELECT DISTINCT source_identifier FROM kg_events WHERE source_id = ?`,
        args: [this.sourceId],
      }),
    ]);
    const knownSlugs = new Set([
      ...knownRecords.rows.map(row => row.source_key),
      ...knownEvents.rows.map(row => row.source_identifier),
    ]);

    const newSlugs = slugs.filter(s => !knownSlugs.has(s));
    console.log(`[Asbest] ${knownSlugs.size} al bekend, ${newSlugs.length} nieuw te checken`);

    let lokaal = 0, events = 0, skipped = 0;

    for (const slug of newSlugs) {
      const detail = await this._fetchDetail(slug);
      if (!detail) {
        skipped++;
        continue;
      }

      if (!this.dryRun) {
        const rawObject = JSON.stringify(detail);
        const contentHash = crypto.createHash('sha256').update(rawObject).digest('hex');
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO source_records
                (source_id, source_key, raw_object, content_hash, semantic_hash, change_type)
                VALUES (?, ?, ?, ?, ?, 'added')`,
          args: [this.sourceId, slug, rawObject, contentHash, contentHash],
        });
      }

      if (!this._isLocallyRelevant(detail)) {
        skipped++;
        continue;
      }
      lokaal++;

      const eventType = detail.stillegging && detail.stillegging.toLowerCase().includes('ja')
        ? 'ASBESTOS_WORK_STOPPED'
        : 'ASBESTOS_VIOLATION_PUBLISHED';

      const title = `Asbestovertreding: ${detail.bedrijf}`;
      const summary = [
        `Bedrijf: ${detail.bedrijf}`,
        detail.locatieText ? `Locatie: ${detail.locatieText}` : null,
        detail.boete ? `Boete: ${detail.boete}` : null,
        detail.stillegging ? `Stillegging: ${detail.stillegging}` : null,
        detail.overtredingen ? `Overtredingen: ${detail.overtredingen}` : null,
      ].filter(Boolean).join('. ');

      if (!this.dryRun) {
        await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, occurred_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '1.0', ?)`,
          args: [
            eventType, title, summary,
            detail.datum || null,
            this.sourceId, detail.url, slug,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'AUTHORITATIVE_EVENT',
              bedrijf: detail.bedrijf,
              locatie: detail.locatieText,
              boete: detail.boete,
              stillegging: detail.stillegging,
            }),
          ],
        });
      }

      console.log(`[Asbest] ${this.dryRun ? '[DRY] ' : ''}Event: ${title}`);
      events++;

      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[Asbest] Klaar: ${lokaal} lokaal, ${events} nieuwe events, ${skipped} niet-lokaal`);
    return { total: slugs.length, lokaal, events, skipped, cached: knownSlugs.size };
  }
}

// --- CLI ---
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[Asbest] Start${dryRun ? ' (DRY RUN)' : ''}...`);
  const adapter = new AsbestovertredingenAdapter({ dryRun });
  adapter.run()
    .then(result => {
      console.log('[Asbest] Resultaat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[Asbest] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = { AsbestovertredingenAdapter };
