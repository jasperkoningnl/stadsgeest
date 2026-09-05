// Adapter: Autoriteit Persoonsgegevens (AP) — sancties
// Bron: https://autoriteitpersoonsgegevens.nl/boetes-en-andere-sancties
// Detecteert: AVG-boetes en sancties tegen lokaal relevante organisaties.
// Vanaf 1 september 2026 is publicatie wettelijk verplicht.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Autoriteit Persoonsgegevens — sancties';
const OVERVIEW_URL = 'https://autoriteitpersoonsgegevens.nl/boetes-en-andere-sancties';
const BASE_URL = 'https://autoriteitpersoonsgegevens.nl';

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class ApSanctiesAdapter {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
    this.sourceId = null;
    this.localEntities = null;
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
      args: [SOURCE_NAME, OVERVIEW_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[AP] Bron geregistreerd: id=${this.sourceId}`);
  }

  async _loadLocalEntities() {
    if (this.localEntities) return;

    const aliases = await this.db.execute({
      sql: `SELECT ka.entity_id, ka.alias, ka.normalized_alias,
              ke.canonical_name, ke.entity_type
            FROM kg_aliases ka
            JOIN kg_entities ke ON ke.id = ka.entity_id
            WHERE ke.merged_into_id IS NULL
            ORDER BY length(ka.alias) DESC`,
      args: [],
    });

    const kvkNumbers = await this.db.execute({
      sql: `SELECT ei.entity_id, ei.value
            FROM entity_identifiers ei
            WHERE ei.identifier_type = 'kvk'`,
      args: [],
    });

    this.localEntities = {
      aliases: aliases.rows,
      kvkNumbers: new Map(kvkNumbers.rows.map(k => [k.value, k.entity_id])),
    };

    console.log(`[AP] ${aliases.rows.length} aliassen en ${kvkNumbers.rows.length} KvK-nummers geladen`);
  }

  async _fetchSancties() {
    console.log('[AP] Sanctieoverzicht ophalen...');
    const response = await fetch(OVERVIEW_URL, {
      headers: {
        'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)',
        'Accept': 'text/html',
      },
    });
    if (!response.ok) throw new Error(`AP ophalen mislukt: ${response.status}`);
    const html = await response.text();
    return this._parseSanctieOverzicht(html);
  }

  _parseSanctieOverzicht(html) {
    const items = [];

    const linkRegex = /<a[^>]+href="([^"]*(?:boete|sanctie|besluit|last-onder|verwerkingsverbod)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1].startsWith('http') ? match[1] : `${BASE_URL}${match[1]}`;
      const linkText = match[2].replace(/<[^>]+>/g, '').trim();
      if (linkText && linkText.length > 10) {
        items.push({ url, title: linkText, guid: url });
      }
    }

    if (items.length === 0) {
      const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
      while ((match = articleRegex.exec(html)) !== null) {
        const articleHtml = match[1];
        const titleMatch = articleHtml.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/);
        const linkMatch = articleHtml.match(/<a[^>]+href="([^"]+)"/);
        const dateMatch = articleHtml.match(/(\d{1,2}\s+\w+\s+\d{4})/);

        if (titleMatch) {
          const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
          const url = linkMatch
            ? (linkMatch[1].startsWith('http') ? linkMatch[1] : `${BASE_URL}${linkMatch[1]}`)
            : '';
          items.push({
            url, title, guid: url || title,
            pubDate: dateMatch ? dateMatch[1] : null,
          });
        }
      }
    }

    const seen = new Set();
    const unique = items.filter(item => {
      if (seen.has(item.guid)) return false;
      seen.add(item.guid);
      return true;
    });

    console.log(`[AP] ${unique.length} sancties gevonden op overzichtspagina`);
    return unique;
  }

  _matchLocalEntities(text) {
    if (!text || !this.localEntities) return [];

    const normalizedText = text.toLowerCase();
    const found = [];
    const seenIds = new Set();

    for (const alias of this.localEntities.aliases) {
      if (seenIds.has(alias.entity_id)) continue;
      if (alias.alias.length < 4) continue;

      const regex = new RegExp(`\\b${escapeRegex(alias.normalized_alias)}\\b`, 'i');
      if (regex.test(normalizedText)) {
        found.push({
          entityId: alias.entity_id,
          canonicalName: alias.canonical_name,
          matchType: 'alias',
          matchedValue: alias.alias,
        });
        seenIds.add(alias.entity_id);
      }
    }

    return found;
  }

  _classifyEvent(title) {
    const text = title.toLowerCase();
    if (text.includes('boete')) return 'AP_SANCTION_PUBLISHED';
    if (text.includes('last onder') || text.includes('dwangsom')) return 'AP_ORDER_PUBLISHED';
    if (text.includes('verwerkingsverbod')) return 'AP_SANCTION_PUBLISHED';
    return 'AP_DECISION_UPDATED';
  }

  async run() {
    await this._ensureSource();
    await this._loadLocalEntities();
    const items = await this._fetchSancties();
    let matched = 0, events = 0, skipped = 0;

    for (const item of items) {
      const matches = this._matchLocalEntities(item.title);

      if (matches.length === 0) {
        skipped++;
        continue;
      }
      matched++;

      const existing = await this.db.execute({
        sql: `SELECT id FROM kg_events WHERE source_id = ? AND source_identifier = ?`,
        args: [this.sourceId, item.guid],
      });
      if (existing.rows.length > 0) continue;

      const eventType = this._classifyEvent(item.title);
      const matchedNames = matches.map(m => m.canonicalName).join(', ');

      if (!this.dryRun) {
        const result = await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '1.0', ?)`,
          args: [
            eventType,
            `AP: ${item.title}`,
            '',
            item.pubDate || null,
            this.sourceId, item.url, item.guid,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'AUTHORITATIVE_EVENT',
              source_url: item.url,
              matched_entities: matches,
            }),
          ],
        });

        const eventId = Number(result.lastInsertRowid);
        for (const match of matches) {
          try {
            await this.db.execute({
              sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                    VALUES (?, ?, 'subject', ?, 0.7)`,
              args: [eventId, match.entityId, `Gematcht via ${match.matchType}: ${match.matchedValue}`],
            });
          } catch { /* event_entities bestaat misschien nog niet */ }
        }
      }

      console.log(`[AP] ${this.dryRun ? '[DRY] ' : ''}Event: ${item.title} (lokaal: ${matchedNames})`);
      events++;
    }

    console.log(`[AP] Klaar: ${matched} lokale matches, ${events} nieuwe events, ${skipped} niet-lokaal`);
    return { matched, events, skipped };
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- CLI ---
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[AP] Start${dryRun ? ' (DRY RUN)' : ''}...`);
  const adapter = new ApSanctiesAdapter({ dryRun });
  adapter.run()
    .then(result => {
      console.log('[AP] Resultaat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[AP] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = { ApSanctiesAdapter };
