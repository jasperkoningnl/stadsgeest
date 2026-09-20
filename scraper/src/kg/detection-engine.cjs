// Detectieregels-engine — Stadsgeest 2.0
// Evalueert kg_events tegen geregistreerde regels en maakt signalen aan.
// Regels worden geregistreerd met register() en draaien via evaluate().

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

function sourceUrlFallback(event) {
  return event?.source_identifier ? null : (event?.source_url || null);
}

function evidenceUrl(event) {
  if (!event?.source_url || !event?.source_identifier) return event?.source_url || null;
  return `${event.source_url}#stadsgeest-event=${encodeURIComponent(event.source_identifier)}`;
}

class DetectionEngine {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.rules = new Map();
    this.dryRun = config.dryRun || false;
  }

  /**
   * Registreer een detectieregel.
   * @param {object} rule - { id, name, description, eventTypes, condition, createSignal }
   *   - id: unieke string (bijv. 'R1', 'R3')
   *   - name: leesbare naam
   *   - eventTypes: string[] — welke event_types deze regel evalueert
   *   - condition(event, context): async boolean — moet het signaal afgaan?
   *     context bevat: { entities, relations, locations, recentEvents, db }
   *   - createSignal(event, context): async object — signaalgegevens
   *     returnt: { title, summary, category, tier, provenance, evidence }
   */
  register(rule) {
    if (!rule.id || !rule.condition || !rule.createSignal) {
      throw new Error(`Regel mist vereiste velden: id=${rule.id}`);
    }
    this.rules.set(rule.id, rule);
  }

  /**
   * Evalueer alle geregistreerde regels tegen nieuwe events.
   * @param {object} options - { since, limit, ruleIds }
   *   - since: ISO datum — evalueer events na dit tijdstip
   *   - limit: max aantal events om te verwerken
   *   - ruleIds: string[] — alleen deze regels draaien (optioneel)
   * @returns {Promise<{evaluated: number, signalsCreated: number, details: object[]}>}
   */
  async evaluate(options = {}) {
    const since = options.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const limit = options.limit || 500;
    const ruleFilter = options.ruleIds ? new Set(options.ruleIds) : null;

    // Haal nieuwe events op
    const events = await this.db.execute({
      sql: `SELECT e.*, s.name as source_name, s.source_class
            FROM kg_events e
            LEFT JOIN sources s ON s.id = e.source_id
            WHERE e.created_at > ?
            ORDER BY e.created_at ASC
            LIMIT ?`,
      args: [since, limit],
    });

    let evaluated = 0;
    let signalsCreated = 0;
    const details = [];

    for (const event of events.rows) {
      evaluated++;

      // Haal gekoppelde entities op
      const eventEntities = await this.db.execute({
        sql: `SELECT ee.*, ke.canonical_name, ke.entity_type, ke.normalized_name
              FROM event_entities ee
              JOIN kg_entities ke ON ke.id = ee.entity_id
              WHERE ee.event_id = ?`,
        args: [event.id],
      });

      const context = {
        entities: eventEntities.rows,
        db: this.db,
        event,
      };

      // Evalueer elke toepasselijke regel
      for (const [ruleId, rule] of this.rules) {
        if (ruleFilter && !ruleFilter.has(ruleId)) continue;
        if (rule.eventTypes && !rule.eventTypes.includes(event.event_type)) continue;

        try {
          const matches = await rule.condition(event, context);
          if (!matches) continue;

          const signal = await rule.createSignal(event, context);
          if (!signal) continue;

          // Maak signaal aan
          if (!this.dryRun) {
            const signalResult = await this._createSignal(event, rule, signal);
            details.push({
              ruleId, eventId: event.id, signalId: signalResult.id,
              title: signal.title, action: signalResult.created ? 'created' : 'existing',
            });
            if (signalResult.created) signalsCreated++;
          } else {
            details.push({
              ruleId, eventId: event.id, signalId: null,
              title: signal.title, entityPath: signal.entityPath || null,
              evidence: signal.evidence || [], action: 'dry_run',
            });
            signalsCreated++;
          }
        } catch (err) {
          console.error(`[${ruleId}] Fout bij event ${event.id}: ${err.message}`);
          details.push({
            ruleId, eventId: event.id, error: err.message, action: 'error',
          });
        }
      }
    }

    console.log(`[DetectionEngine] ${evaluated} events geëvalueerd, ${signalsCreated} signalen aangemaakt`);
    return { evaluated, signalsCreated, details };
  }

  /**
   * Maak een signaal aan in de bestaande signals-tabel.
   */
  async _createSignal(event, rule, signalData) {
    // Exact-once: een periodieke detectierun mag hetzelfde event niet opnieuw
    // als bevestiging of nieuw signaal tellen. Oude signalen hebben nog geen
    // event_id in provenance; voor die records vallen we terug op de unieke
    // bron-URL of bronidentifier.
    const dedupeKey = signalData.dedupeKey || null;
    const fallbackUrl = sourceUrlFallback(event);
    const existing = await this.db.execute({
      sql: `SELECT id FROM signals
            WHERE detection_rule = ? AND (
              json_extract(provenance, '$.event_id') = ?
              OR (? IS NOT NULL AND json_extract(provenance, '$.signal_key') = ?)
              OR (? IS NOT NULL AND json_extract(provenance, '$.source_url') = ?)
              OR (? IS NOT NULL AND json_extract(provenance, '$.source_identifier') = ?)
            )
            LIMIT 1`,
      args: [
        rule.id,
        event.id,
        dedupeKey,
        dedupeKey,
        fallbackUrl,
        fallbackUrl,
        event.source_identifier || null,
        event.source_identifier || null,
      ],
    });
    if (existing.rows.length > 0) {
      return { id: existing.rows[0].id, created: false };
    }

    // Nieuw signaal
    const provenance = JSON.stringify({
      source_name: event.source_name,
      source_class: event.source_class,
      source_url: event.source_url,
      source_identifier: event.source_identifier,
      occurred_at: event.occurred_at,
      fetched_at: event.fetched_at,
      detection_rule: rule.id,
      event_id: event.id,
      evidence: signalData.evidence || [],
      entity_path: signalData.entityPath || null,
      signal_key: dedupeKey,
      ...(signalData.provenance || {}),
    });

    const result = await this.db.execute({
      sql: `INSERT INTO signals (title, summary, status, confirmations, threshold,
              first_seen_at, last_seen_at, created_at, tier, category,
              detection_rule, provenance, novelty_score)
            VALUES (?, ?, 'new', 1, 3, datetime('now'), datetime('now'), datetime('now'),
              ?, ?, ?, ?, ?)`,
      args: [
        signalData.title,
        signalData.summary || '',
        signalData.tier || 2,
        signalData.category || 'overig',
        rule.id,
        provenance,
        signalData.noveltyScore || 50,
      ],
    });

    const signalId = Number(result.lastInsertRowid);

    // De weegroutine leest bewijs via raw_items → signal_items. Leg daarom
    // voor elk nieuw KG-signaal ook een compact, al verwerkt bewijsitem vast.
    try {
      await this.linkEvidenceForSignal(signalId, event);
    } catch (error) {
      console.error(`[DetectionEngine] Bewijsitem voor signaal ${signalId} mislukt: ${error.message}`);
    }

    // Koppel event-entities aan het signaal via entity_signals (als die tabel bestaat)
    try {
      for (const entity of (signalData.entities || [])) {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO entity_signals (entity_id, signal_id, relevance, created_at)
                VALUES (?, ?, ?, datetime('now'))`,
          args: [entity.entityId, signalId, entity.relevance || 'subject'],
        });
      }
    } catch {
      // entity_signals tabel bestaat misschien nog niet — geen probleem
    }

    return { id: signalId, created: true };
  }

  async linkEvidenceForSignal(signalId, event) {
    if (this.dryRun || !signalId || !event?.source_url || !event?.source_id) return null;
    const externalUrl = evidenceUrl(event);
    let found = await this.db.execute({
      sql: `SELECT id FROM raw_items WHERE source_id=? AND external_url=? ORDER BY id LIMIT 1`,
      args: [event.source_id, externalUrl],
    });
    let rawItemId = found.rows[0]?.id ? Number(found.rows[0].id) : null;
    if (!rawItemId) {
      const contentHash = event.raw_object_hash || crypto.createHash('sha256')
        .update(`${event.event_type || ''}:${event.source_identifier || ''}:${event.summary || ''}`)
        .digest('hex');
      await this.db.execute({
        sql: `INSERT OR IGNORE INTO raw_items
              (source_id, external_url, title, content, summary, scraped_at,
               content_hash, is_processed, published_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        args: [
          event.source_id,
          externalUrl,
          event.title || '(geen titel)',
          event.provenance || event.summary || '',
          event.summary || event.title || '',
          event.fetched_at || new Date().toISOString(),
          contentHash,
          event.published_at || event.occurred_at || null,
        ],
      });
      found = await this.db.execute({
        sql: `SELECT id FROM raw_items WHERE source_id=? AND external_url=? ORDER BY id LIMIT 1`,
        args: [event.source_id, externalUrl],
      });
      rawItemId = found.rows[0]?.id ? Number(found.rows[0].id) : null;
    }
    if (!rawItemId) return null;
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`,
      args: [signalId, rawItemId],
    });
    return rawItemId;
  }

  /**
   * Helper: zoek lokale entiteiten die bij een event horen.
   * Gebruikt de entity-resolver om namen/identifiers in event-tekst te matchen.
   */
  async findLocalEntities(text, entityType) {
    if (!text) return [];
    // Zoek alle kg_entities die voorkomen in de tekst (via aliases)
    const aliases = await this.db.execute({
      sql: `SELECT ka.alias, ka.normalized_alias, ka.entity_id,
              ke.canonical_name, ke.entity_type
            FROM kg_aliases ka
            JOIN kg_entities ke ON ke.id = ka.entity_id
            WHERE ke.merged_into_id IS NULL
            ${entityType ? "AND ke.entity_type = ?" : ""}
            ORDER BY length(ka.alias) DESC`,
      args: entityType ? [entityType] : [],
    });

    const found = [];
    const normalizedText = text.toLowerCase();
    const seenEntityIds = new Set();

    for (const alias of aliases.rows) {
      if (seenEntityIds.has(alias.entity_id)) continue;
      if (alias.alias.length < 4) continue; // Te korte aliassen overslaan (ruis)

      const normalizedAlias = alias.normalized_alias;
      // Zoek als heel woord (niet als substring van een langer woord)
      const regex = new RegExp(`\\b${escapeRegex(normalizedAlias)}\\b`, 'i');
      if (regex.test(normalizedText)) {
        found.push({
          entityId: alias.entity_id,
          canonicalName: alias.canonical_name,
          entityType: alias.entity_type,
          matchedAlias: alias.alias,
        });
        seenEntityIds.add(alias.entity_id);
      }
    }
    return found;
  }

  /**
   * Helper: check of een entity lokaal relevant is (vestiging in Amersfoort/Leusden).
   */
  async isLocallyRelevant(entityId) {
    // Check via entity_locations
    const locResult = await this.db.execute({
      sql: `SELECT l.city FROM entity_locations el
            JOIN locations l ON l.id = el.location_id
            WHERE el.entity_id = ? AND l.city IN ('Amersfoort', 'Leusden')`,
      args: [entityId],
    });
    if (locResult.rows.length > 0) return true;

    // Check via identifier (website/kvk aanwezig = bewust toegevoegd = lokaal)
    const idResult = await this.db.execute({
      sql: `SELECT id FROM entity_identifiers WHERE entity_id = ? LIMIT 1`,
      args: [entityId],
    });
    if (idResult.rows.length > 0) return true;

    // Check of entity een source_person_id of source_org_id heeft (gemigreerd uit bestaande data = lokaal)
    const kgResult = await this.db.execute({
      sql: `SELECT id FROM kg_entities WHERE id = ? AND (source_person_id IS NOT NULL OR source_org_id IS NOT NULL)`,
      args: [entityId],
    });
    return kgResult.rows.length > 0;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { DetectionEngine, createDb, evidenceUrl, sourceUrlFallback };
