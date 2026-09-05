// Adapter: Open Data Tuchtrecht — SRU 2.0
// Bron: https://repository.overheid.nl/sru (collectie: tuchtrecht)
// Detecteert: tuchtrechtuitspraken met lokale relevantie.
// Anonimisering kan entity-resolutie onmogelijk maken — forceer dan geen match.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const SOURCE_NAME = 'Open Data Tuchtrecht';
const SRU_BASE = 'https://repository.overheid.nl/sru';
const COLLECTION = 'tuchtrecht';
const OVERLAP_DAYS = 7;
const FILTER_TERMS = ['amersfoort', 'leusden'];

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class TuchtrechtSruAdapter {
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
            VALUES (?, ?, 'api', 'primary', 'government', 'daily',
              1, datetime('now'), 'AUTHORITATIVE_EVENT', '1.0')`,
      args: [SOURCE_NAME, SRU_BASE],
    });
    this.sourceId = Number(result.lastInsertRowid);
    console.log(`[Tuchtrecht] Bron geregistreerd: id=${this.sourceId}`);
  }

  /** Laad lokale entiteiten voor matching. */
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

    this.localEntities = aliases.rows;
    console.log(`[Tuchtrecht] ${aliases.rows.length} aliassen geladen`);
  }

  /** Query SRU voor recente tuchtrechtuitspraken. */
  async _fetchUitspraken(since) {
    const sinceDate = since || new Date(Date.now() - (30 + OVERLAP_DAYS) * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const allRecords = [];
    let startRecord = 1;
    const maxRecords = 50;
    let hasMore = true;

    while (hasMore) {
      // SRU 2.0 query: zoek op plaatsnaam via cql.serverChoice (full-text)
      const queries = FILTER_TERMS.map(term =>
        `cql.serverChoice="${term}"`
      );
      const cql = `(${queries.join(' OR ')}) AND dt.modified>="${sinceDate}"`;

      const params = new URLSearchParams({
        operation: 'searchRetrieve',
        version: '2.0',
        'x-connection': COLLECTION,
        query: cql,
        startRecord: String(startRecord),
        maximumRecords: String(maxRecords),
        recordSchema: 'gzd',
      });

      const url = `${SRU_BASE}?${params}`;
      console.log(`[Tuchtrecht] SRU query startRecord=${startRecord}...`);

      const response = await fetch(url, {
        headers: { 'User-Agent': 'Stadsgeest/1.0 (nieuwsmonitoring Amersfoort)' },
      });
      if (!response.ok) throw new Error(`SRU fout: ${response.status}`);

      const xml = await response.text();
      const records = this._parseSruResponse(xml);

      if (records.length === 0) {
        hasMore = false;
      } else {
        allRecords.push(...records);
        startRecord += maxRecords;
        // Check numberOfRecords
        const totalMatch = xml.match(/<(?:srw:|sru:)?numberOfRecords>(\d+)<\/(?:srw:|sru:)?numberOfRecords>/);
        const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
        hasMore = startRecord <= total;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`[Tuchtrecht] ${allRecords.length} uitspraken gevonden`);
    return allRecords;
  }

  /** Parse SRU XML-response naar records. */
  _parseSruResponse(xml) {
    const records = [];
    const recordRegex = /<(?:srw:|sru:)?record>([\s\S]*?)<\/(?:srw:|sru:)?record>/g;
    let match;

    while ((match = recordRegex.exec(xml)) !== null) {
      const recordXml = match[1];
      const getTag = (tag) => {
        const m = recordXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
      };

      // Probeer identifier te vinden (ECLI of eigen ID)
      const identifier = getTag('dcterms:identifier') || getTag('dc:identifier') || '';
      const title = getTag('dcterms:title') || getTag('dc:title') || '';
      const description = getTag('dcterms:description') || getTag('dc:description') || '';
      const modified = getTag('dcterms:modified') || getTag('dcterms:issued') || '';
      const subject = getTag('dcterms:subject') || '';
      const spatial = getTag('dcterms:spatial') || '';
      const creator = getTag('dcterms:creator') || '';

      // Probeer de volledige tekst-URL te vinden
      const contentUrl = getTag('dcterms:hasVersion') || getTag('dcterms:isFormatOf') || '';

      if (identifier || title) {
        records.push({
          identifier,
          title,
          description,
          modified,
          subject,
          spatial,
          creator,
          contentUrl,
          fullText: `${title} ${description} ${subject} ${spatial} ${creator}`,
        });
      }
    }

    return records;
  }

  /** Match uitspraak tegen lokale entiteiten. */
  _matchLocalEntities(text) {
    if (!text || !this.localEntities) return [];

    const normalizedText = text.toLowerCase();
    const found = [];
    const seenIds = new Set();

    for (const alias of this.localEntities) {
      if (seenIds.has(alias.entity_id)) continue;
      if (alias.alias.length < 4) continue;

      const regex = new RegExp(`\\b${escapeRegex(alias.normalized_alias)}\\b`, 'i');
      if (regex.test(normalizedText)) {
        found.push({
          entityId: alias.entity_id,
          canonicalName: alias.canonical_name,
          entityType: alias.entity_type,
          matchedAlias: alias.alias,
        });
        seenIds.add(alias.entity_id);
      }
    }

    return found;
  }

  /** Bepaal het type maatregel uit de tekst. */
  _classifyEvent(text) {
    const lower = text.toLowerCase();
    if (lower.includes('schorsing') || lower.includes('doorhaling') || lower.includes('ontzetting')) {
      return 'DISCIPLINARY_MEASURE_IMPOSED';
    }
    if (lower.includes('berisping') || lower.includes('waarschuwing') || lower.includes('boete')) {
      return 'DISCIPLINARY_MEASURE_IMPOSED';
    }
    return 'DISCIPLINARY_RULING_PUBLISHED';
  }

  /** Check of de uitspraak lokaal relevant is (plaatsnaam of entity-match). */
  _isLocallyRelevant(record) {
    // Check expliciet op plaatsnaam in spatial of tekst
    const text = record.fullText.toLowerCase();
    if (FILTER_TERMS.some(t => text.includes(t))) return { method: 'plaatsnaam' };

    // Check entity-match
    const matches = this._matchLocalEntities(record.fullText);
    if (matches.length > 0) return { method: 'entity', matches };

    return null;
  }

  async run() {
    await this._ensureSource();
    await this._loadLocalEntities();
    const uitspraken = await this._fetchUitspraken();

    let lokaal = 0, events = 0, skipped = 0;

    for (const record of uitspraken) {
      const relevance = this._isLocallyRelevant(record);
      if (!relevance) {
        skipped++;
        continue;
      }
      lokaal++;

      const identifier = record.identifier || record.title;

      // Check bestaand event
      const existing = await this.db.execute({
        sql: `SELECT id FROM kg_events WHERE source_id = ? AND source_identifier = ?`,
        args: [this.sourceId, identifier],
      });
      if (existing.rows.length > 0) continue;

      const eventType = this._classifyEvent(record.fullText);
      const title = `Tuchtrecht: ${record.title || record.identifier}`;

      if (!this.dryRun) {
        const result = await this.db.execute({
          sql: `INSERT INTO kg_events (event_type, title, summary, published_at, fetched_at,
                  source_id, source_url, source_identifier, parser_version, provenance)
                VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, '1.0', ?)`,
          args: [
            eventType, title, record.description || '',
            record.modified || null,
            this.sourceId, record.contentUrl || '', identifier,
            JSON.stringify({
              source_name: SOURCE_NAME,
              source_class: 'AUTHORITATIVE_EVENT',
              identifier: record.identifier,
              subject: record.subject,
              spatial: record.spatial,
              creator: record.creator,
              relevance_method: relevance.method,
              matched_entities: relevance.matches || [],
            }),
          ],
        });

        // Koppel gematchte entiteiten
        if (relevance.matches) {
          const eventId = Number(result.lastInsertRowid);
          for (const match of relevance.matches) {
            try {
              await this.db.execute({
                sql: `INSERT OR IGNORE INTO event_entities (event_id, entity_id, role, evidence, confidence)
                      VALUES (?, ?, 'related', ?, 0.6)`,
                args: [eventId, match.entityId, `Gematcht via alias: ${match.matchedAlias}`],
              });
            } catch { /* event_entities bestaat misschien nog niet */ }
          }
        }
      }

      console.log(`[Tuchtrecht] ${this.dryRun ? '[DRY] ' : ''}Event: ${title} (via ${relevance.method})`);
      events++;
    }

    console.log(`[Tuchtrecht] Klaar: ${lokaal} lokaal, ${events} nieuwe events, ${skipped} niet-lokaal`);
    return { lokaal, events, skipped };
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- CLI ---
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[Tuchtrecht] Start${dryRun ? ' (DRY RUN)' : ''}...`);
  const adapter = new TuchtrechtSruAdapter({ dryRun });
  adapter.run()
    .then(result => {
      console.log('[Tuchtrecht] Resultaat:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[Tuchtrecht] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = { TuchtrechtSruAdapter };
