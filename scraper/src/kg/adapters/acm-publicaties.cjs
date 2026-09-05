// Adapter: Autoriteit Consument & Markt (ACM) — publicaties
// Bron: https://www.acm.nl/nl/nieuws/rss
// Detecteert: besluiten, sancties, concentratiemeldingen met lokale relevantie.
// Lokaal filter werkt via entity-matching, niet primair op plaatsnaam.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Autoriteit Consument & Markt';
const RSS_URL = 'https://www.acm.nl/nl/nieuws/rss';
const BASE_URL = 'https://www.acm.nl';

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class AcmPublicatiesAdapter {
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
            VALUES (?, ?, 'rss', 'primary', 'government', 'daily',
              1, datetime('now'), 'AUTHORITATIVE_EVENT', '1.0')`,
      args: [SOURCE_NAME, RSS_URL],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[ACM] Bron geregistreerd: id=${this.sourceId}`);
  }

  async _loadLocalEntities() {
    if (this.localEntities) return;

    const entities = await this.db.execute({
      sql: `SELECT ke.id, ke.canonical_name, ke.normalized_name, ke.entity_type
            FROM kg_entities ke
            WHERE ke.merged_into_id IS NULL
            AND ke.entity_type = 'organization'`,
      args: [],
    });

    const aliases = await this.db.execute({
      sql: `SELECT ka.entity_id, ka.alias, ka.normalized_alias
            FROM kg_aliases ka
            JOIN kg_entities ke ON ke.id = ka.entity_id
            WHERE ke.merged_into_id IS NULL
            AND ke.entity_type = 'organization'
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
      byId: new Map(entities.rows.map(e => [e.id, e])),
      aliases: aliases.rows,
      kvkNumbers: new Map(kvkNumbers.rows.map(k => [k.value, k.entity_id])),
    };

    console.log(`[ACM] ${entities.rows.length} lokale organisaties geladen, ${aliases.rows.length} aliassen, ${kvkNumbers.rows.length} KvK-nummers`);
  }

  async _fetchRss() {
    console.log('[ACM] RSS ophalen...');
    const response = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
    });
    if (!response.ok) throw new Error(`RSS ophalen mislukt: ${response.status}`);
    const xml = await response.text();
    return this._parseRss(xml);
  }

  _parseRss(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const getTag = (tag) => {
        const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
      };

      items.push({
        title: getTag('title'),
        link: getTag('link'),
        description: getTag('description'),
        pubDate: getTag('pubDate'),
        category: getTag('category'),
        guid: getTag('guid') || getTag('link'),
      });
    }

    console.log(`[ACM] ${items.length} items uit RSS`);
    return items;
  }

  _matchLocalEntities(text) {
    if (!text || !this.localEntities) return [];

    const normalizedText = text.toLowerCase();
    const found = [];
    const seenIds = new Set();

    const kvkPattern = /\b(\d{8})\b/g;
    let kvkMatch;
    while ((kvkMatch = kvkPattern.exec(text)) !== null) {
      const entityId = this.localEntities.kvkNumbers.get(kvkMatch[1]);
      if (entityId && !seenIds.has(entityId)) {
        const entity = this.localEntities.byId.get(entityId);
        if (entity) {
          found.push({
            entityId,
            canonicalName: entity.canonical_name,
            matchType: 'kvk',
            matchedValue: kvkMatch[1],
            confidence: 1.0,
          });
          seenIds.add(entityId);
        }
      }
    }

    for (const alias of this.localEntities.aliases) {
      if (seenIds.has(alias.entity_id)) continue;
      if (alias.alias.length < 4) continue;
      const normalizedAlias = alias.normalized_alias;
      const regex = new RegExp(`\\b${escapeRegex(normalizedAlias)}\\b`, 'i');
      if (regex.test(normalizedText)) {
        const entity = this.localEntities.byId.get(alias.entity_id);
        if (entity) {
          found.push({
            entityId: alias.entity_id,
            canonicalName: entity.canonical_name,
            matchType: 'alias',
            matchedValue: alias.alias,
            confidence: 0.7,
          });
          seenIds.add(alias.entity_id);
        }
      }
    }

    return found;
  }

  _classifyEvent(item) {
    const text = `${item.title} ${item.description} ${item.category}`.toLowerCase();
    if (text.includes('sanctie') || text.includes('boete') || text.includes('last onder dwangsom')) {
      return 'ACM_SANCTION_PUBLISHED';
    }
    if (text.includes('concentratie') || text.includes('fusie') || text.includes('overname')) {
      return 'ACM_CONCENTRATION_FILED';
    }
    if (text.includes('besluit') || text.includes('beslissing')) {
      return 'ACM_DECISION_PUBLISHED';
    }
    if (text.includes('zaak') || text.includes('onderzoek')) {
      return 'ACM_CASE_OPENED';
    }
    return 'ACM_CASE_UPDATED';
  }

  async run() {
    await this._ensureSource();
    await this._loadLocalEntities();
    const items = await this._fetchRss();
    let matched = 0, events = 0, skipped = 0;

    for (const item of items) {
      const searchText = `${item.title} ${item.description}`;
      const matches = this._matchLocalEntities(searchText);

      if (matches.length === 0) {
        skipped++;
        continue;
      }
      matched++;

      const guid = item.guid || item.link;

      const existing = await this.db.execute({
        sql: `SELECT id FROM kg_events WHERE source_id = ? AND source_identifier = ?`,
        args: [this.sourceId, guid],
      });
      if (existing.rows.length > 0) continue;

      const eventType = this._classifyEvent(item);
      const matchedNames = matches.map(m => m.canonicalName).join(', ');
      const title = `ACM: ${item.title}`;
      const summary = item.description || '';

      if (!this.dryRun) {
        const result = await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '1.0', ?)`,
          args: [
            eventType, title, summary,
            item.pubDate ? new Date(item.pubDate).toISOString() : null,
            this.sourceId, item.link, guid,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'AUTHORITATIVE_EVENT',
              source_url: item.link,
              category: item.category,
              matched_entities: matches,
              detection_rule: null,
            }),
          ],
        });

        const eventId = Number(result.lastInsertRowid);
        for (const match of matches) {
          try {
            await this.db.execute({
              sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                    VALUES (?, ?, 'subject', ?, ?)`,
              args: [eventId, match.entityId, `Gematcht via ${match.matchType}: ${match.matchedValue}`, match.confidence],
            });
          } catch { /* event_entities bestaat misschien nog niet */ }
        }
      }

      console.log(`[ACM] ${this.dryRun ? '[DRY] ' : ''}Event: ${title} (lokaal: ${matchedNames})`);
      events++;
    }

    console.log(`[ACM] Klaar: ${matched} lokale matches, ${events} nieuwe events, ${skipped} niet-lokaal`);
    return { matched, events, skipped };
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- CLI ---
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[ACM] Start${dryRun ? ' (DRY RUN)' : ''}...`);
  const adapter = new AcmPublicatiesAdapter({ dryRun });
  adapter.run()
    .then(result => {
      console.log('[ACM] Resultaat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[ACM] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = { AcmPublicatiesAdapter };
