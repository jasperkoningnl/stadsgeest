// Adapter: Liander storingsdata — ArcGIS FeatureServer
// Bron: https://services1.arcgis.com/.../IStoringen_Productie_V7/FeatureServer/0
// Detecteert: grote of terugkerende storingen in Amersfoort/Leusden.
// Statusupdates worden gemodelleerd als versies van één event, niet als nieuwe signalen.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Liander storingsdata';
const FEATURE_SERVER_URL = 'https://services1.arcgis.com/v6W5HAVrpgSg3vts/ArcGIS/rest/services/IStoringen_Productie_V7/FeatureServer/0';
const FILTER_CITIES = ['amersfoort', 'leusden'];
// Postcodegebieden Amersfoort (38xx) en Leusden (383x, 384x)
const LOCAL_POSTCODES = /^38[0-9]{2}/;

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class LianderStoringenAdapter {
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
            VALUES (?, ?, 'api', 'primary', 'data', 'daily',
              1, datetime('now'), 'MEASUREMENT', '1.0')`,
      args: [SOURCE_NAME, FEATURE_SERVER_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[Liander] Bron geregistreerd: id=${this.sourceId}`);
  }

  /** Query de ArcGIS FeatureServer voor storingen. */
  async _fetchStoringen() {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      f: 'json',
      resultRecordCount: '500',
      orderByFields: 'STORING_NUMMER DESC',
    });

    const url = `${FEATURE_SERVER_URL}/query?${params}`;
    console.log('[Liander] Storingen ophalen...');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`ArcGIS query mislukt: ${response.status}`);

    const data = await response.json();
    if (data.error) throw new Error(`ArcGIS fout: ${data.error.message}`);

    const features = data.features || [];
    console.log(`[Liander] ${features.length} storingen opgehaald`);
    return features;
  }

  /** Filter op lokale storingen (postcodes/plaatsen in Amersfoort/Leusden). */
  _isLocallyRelevant(feature) {
    const attrs = feature.attributes || {};
    const plaatsen = (attrs.STORING_GETROFFEN_PLAATSEN || '').toLowerCase();
    if (FILTER_CITIES.some(c => plaatsen.includes(c))) return true;
    const postcodes = (attrs.STORING_GETROFFEN_POSTCODES || attrs.STORING_GETROFFEN_POSTCODES || '').toString();
    if (LOCAL_POSTCODES.test(postcodes)) return true;
    const straten = (attrs.STORING_GETROFFEN_STRATEN || '').toLowerCase();
    if (straten.includes('amersfoort') || straten.includes('leusden')) return true;
    return false;
  }

  /** Bepaal of een storing nieuwswaardig is (drempels uit bronkaart). */
  _isNewsworthy(feature) {
    const attrs = feature.attributes || {};
    const klanten = parseInt(attrs.STORING_GETROFFEN_KLANTEN || '0', 10);
    const meldtijd = attrs.STORING_DATUM_GEMELD ? new Date(attrs.STORING_DATUM_GEMELD) : null;
    const eindtijd = attrs.STORING_DATUM_EIND ? new Date(attrs.STORING_DATUM_EIND) : null;
    if (klanten >= 250) return { reason: `${klanten} klanten getroffen`, tier: 1 };
    if (meldtijd && eindtijd) {
      const duurMinuten = (eindtijd - meldtijd) / 60000;
      if (duurMinuten > 60) return { reason: `duur ${Math.round(duurMinuten)} minuten`, tier: 2 };
    } else if (meldtijd && !eindtijd) {
      const duurMinuten = (Date.now() - meldtijd.getTime()) / 60000;
      if (duurMinuten > 60) return { reason: `actief, al ${Math.round(duurMinuten)} minuten`, tier: 1 };
    }
    return null;
  }

  _semanticHash(attrs) {
    return [
      attrs.STORING_NUMMER,
      attrs.STORING_STATUS,
      attrs.STORING_GETROFFEN_KLANTEN || '',
      attrs.STORING_OORZAAK || '',
      attrs.STORING_DATUM_EIND || '',
    ].join('::');
  }

  async run() {
    await this._ensureSource();
    const features = await this._fetchStoringen();
    let lokaal = 0, events = 0, updated = 0, skipped = 0;

    for (const feature of features) {
      if (!this._isLocallyRelevant(feature)) {
        skipped++;
        continue;
      }
      lokaal++;
      const attrs = feature.attributes || {};
      const storingNummer = attrs.STORING_NUMMER;
      if (!storingNummer) continue;
      const currentHash = this._semanticHash(attrs);

      const existing = await this.db.execute({
        sql: `SELECT id, raw_object_hash FROM kg_events
              WHERE source_id = ? AND source_identifier = ?
              ORDER BY created_at DESC LIMIT 1`,
        args: [this.sourceId, String(storingNummer)],
      });

      if (existing.rows.length > 0) {
        if (existing.rows[0].raw_object_hash === currentHash) continue;
        if (!this.dryRun) {
          await this.db.execute({
            sql: `UPDATE kg_events SET
                    summary = ?, raw_object_hash = ?,
                    event_type = CASE WHEN ? IS NOT NULL THEN 'UTILITY_OUTAGE_RESOLVED'
                                      ELSE event_type END,
                    provenance = ?
                  WHERE id = ?`,
            args: [
              this._buildSummary(attrs),
              currentHash,
              attrs.STORING_DATUM_EIND,
              JSON.stringify(this._buildProvenance(attrs)),
              existing.rows[0].id,
            ],
          });
        }
        updated++;
        console.log(`[Liander] Update: storing ${storingNummer}`);
        continue;
      }

      const eventType = attrs.STORING_DATUM_EIND
        ? 'UTILITY_OUTAGE_RESOLVED'
        : 'UTILITY_OUTAGE_STARTED';
      const title = `Liander-storing ${storingNummer}: ${attrs.STORING_ENERGIESOORT || 'onbekend'} — ${attrs.STORING_GETROFFEN_PLAATSEN || 'onbekend'}`;
      const summary = this._buildSummary(attrs);

      if (!this.dryRun) {
        await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, occurred_at, fetched_at,
                  source_id, source_identifier, raw_object_hash, parser_version, provenance)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '1.0', ?)`,
          args: [
            eventType, title, summary,
            attrs.STORING_DATUM_GEMELD ? new Date(attrs.STORING_DATUM_GEMELD).toISOString() : null,
            this.sourceId, String(storingNummer), currentHash,
            JSON.stringify(this._buildProvenance(attrs)),
          ],
        });
      }

      const newsworthy = this._isNewsworthy(feature);
      console.log(`[Liander] ${this.dryRun ? '[DRY] ' : ''}Event: ${title}${newsworthy ? ` (NIEUWSWAARDIG: ${newsworthy.reason})` : ''}`);
      events++;
    }

    console.log(`[Liander] Klaar: ${lokaal} lokale storingen, ${events} nieuwe events, ${updated} updates, ${skipped} niet-lokaal`);
    return { lokaal, events, updated, skipped };
  }

  _buildSummary(attrs) {
    const delen = [];
    if (attrs.STORING_ENERGIESOORT) delen.push(`Energiebron: ${attrs.STORING_ENERGIESOORT}`);
    if (attrs.STORING_STATUS) delen.push(`Status: ${attrs.STORING_STATUS}`);
    if (attrs.STORING_GETROFFEN_KLANTEN) delen.push(`Getroffen klanten: ${attrs.STORING_GETROFFEN_KLANTEN}`);
    if (attrs.STORING_GETROFFEN_PLAATSEN) delen.push(`Plaatsen: ${attrs.STORING_GETROFFEN_PLAATSEN}`);
    if (attrs.STORING_GETROFFEN_POSTCODES) delen.push(`Postcodes: ${attrs.STORING_GETROFFEN_POSTCODES}`);
    if (attrs.STORING_GETROFFEN_STRATEN) delen.push(`Straten: ${attrs.STORING_GETROFFEN_STRATEN}`);
    if (attrs.STORING_OORZAAK) delen.push(`Oorzaak: ${attrs.STORING_OORZAAK}`);
    if (attrs.STORING_COMPONENT) delen.push(`Component: ${attrs.STORING_COMPONENT}`);
    if (attrs.STORING_DATUM_GEMELD) delen.push(`Gemeld: ${new Date(attrs.STORING_DATUM_GEMELD).toISOString()}`);
    if (attrs.STORING_DATUM_SCHATTING) delen.push(`Verwacht eind: ${new Date(attrs.STORING_DATUM_SCHATTING).toISOString()}`);
    if (attrs.STORING_DATUM_EIND) delen.push(`Werkelijk eind: ${new Date(attrs.STORING_DATUM_EIND).toISOString()}`);
    return delen.join('. ');
  }

  _buildProvenance(attrs) {
    return {
      source_name: SOURCE_NAME,
      source_class: 'MEASUREMENT',
      storing_nummer: attrs.STORING_NUMMER,
      energiesoort: attrs.STORING_ENERGIESOORT,
      storing_status: attrs.STORING_STATUS,
      getroffen_klanten: attrs.STORING_GETROFFEN_KLANTEN,
      getroffen_plaatsen: attrs.STORING_GETROFFEN_PLAATSEN,
      getroffen_postcodes: attrs.STORING_GETROFFEN_POSTCODES,
      oorzaak: attrs.STORING_OORZAAK,
      component: attrs.STORING_COMPONENT,
    };
  }
}

// --- CLI ---
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[Liander] Start${dryRun ? ' (DRY RUN)' : ''}...`);
  const adapter = new LianderStoringenAdapter({ dryRun });
  adapter.run()
    .then(result => {
      console.log('[Liander] Resultaat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[Liander] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = { LianderStoringenAdapter };
