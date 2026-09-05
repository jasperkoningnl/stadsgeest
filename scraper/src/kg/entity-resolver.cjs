// Entity-resolver — Stadsgeest 2.0
// Zoekt en matcht entities op basis van identifiers, aliassen en context.
// Scoringsmodel conform migratieplan §4.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

// Scoringsgewichten
const SCORES = {
  EXACT_IDENTIFIER: 100,  // KvK, RSIN, ECLI
  WEBSITE_DOMAIN:    45,
  BAG_ADDRESS:       40,
  EXACT_NAME:        35,
  NORMALIZED_NAME:   25,
  SHARED_DIRECTOR:   20,
  SAME_POSTAL:       15,
  SAME_AREA:         10,
};

// Drempels
const THRESHOLDS = {
  AUTO_MERGE:    90,
  REVIEW:        70,
  NO_MERGE:      70,  // onder deze score: geen actie
  PERSON_MIN:   110,  // personen nooit auto-merge op naam alleen (naam max 35)
};

function normalizeStr(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createDb() {
  return createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

class EntityResolver {
  constructor(config = {}) {
    this.db = config.db || createDb();
    this.dryRun = config.dryRun || false;
  }

  /**
   * Zoek een match voor een entity-kandidaat.
   * @param {object} candidate - { name, entityType, identifiers?, aliases?, location? }
   * @returns {Promise<{match: object|null, score: number, details: object[]}>}
   */
  async resolve(candidate) {
    const matches = [];

    // Stap 1: zoek op identifiers (sterkste signaal)
    if (candidate.identifiers && candidate.identifiers.length > 0) {
      for (const id of candidate.identifiers) {
        const idMatches = await this._matchByIdentifier(id.type, id.value);
        for (const m of idMatches) {
          matches.push({
            entityId: m.entity_id,
            score: SCORES.EXACT_IDENTIFIER,
            reason: `identifier ${id.type}=${id.value}`,
          });
        }
      }
    }

    // Stap 2: zoek op exacte naam
    const normalized = normalizeStr(candidate.name);
    if (normalized) {
      const nameMatches = await this._matchByName(normalized, candidate.entityType);
      for (const m of nameMatches) {
        const isExact = m.normalized_name === normalized || m.normalized_alias === normalized;
        matches.push({
          entityId: m.id || m.entity_id,
          score: isExact ? SCORES.EXACT_NAME : SCORES.NORMALIZED_NAME,
          reason: isExact ? `exacte naam "${candidate.name}"` : `genormaliseerde naam "${normalized}"`,
        });
      }
    }

    // Stap 3: zoek op website-domein
    if (candidate.website) {
      const domain = this._extractDomain(candidate.website);
      if (domain) {
        const webMatches = await this._matchByIdentifier('website', domain);
        for (const m of webMatches) {
          matches.push({
            entityId: m.entity_id,
            score: SCORES.WEBSITE_DOMAIN,
            reason: `website ${domain}`,
          });
        }
      }
    }

    // Stap 4: zoek op BAG-adres
    if (candidate.bagId) {
      const bagMatches = await this._matchByBagId(candidate.bagId);
      for (const m of bagMatches) {
        matches.push({
          entityId: m.entity_id,
          score: SCORES.BAG_ADDRESS,
          reason: `BAG-id ${candidate.bagId}`,
        });
      }
    }

    // Aggregeer scores per entity
    const aggregated = this._aggregateScores(matches);

    // Sorteer op score, hoogste eerst
    aggregated.sort((a, b) => b.totalScore - a.totalScore);

    if (aggregated.length === 0) {
      return { match: null, score: 0, details: [], action: 'create' };
    }

    const best = aggregated[0];
    const action = this._determineAction(best.totalScore, candidate.entityType);

    return {
      match: { entityId: best.entityId, score: best.totalScore },
      score: best.totalScore,
      details: best.reasons,
      action,
      alternatives: aggregated.slice(1, 4), // max 3 alternatieven
    };
  }

  /**
   * Bepaal actie op basis van score en entity-type.
   */
  _determineAction(score, entityType) {
    if (entityType === 'person') {
      // Personen: nooit auto-merge op naam alleen
      if (score >= THRESHOLDS.PERSON_MIN) return 'auto_merge';
      if (score >= THRESHOLDS.REVIEW) return 'review';
      return 'create';
    }
    if (score >= THRESHOLDS.AUTO_MERGE) return 'auto_merge';
    if (score >= THRESHOLDS.REVIEW) return 'review';
    return 'create';
  }

  /**
   * Aggregeer match-scores per entity.
   */
  _aggregateScores(matches) {
    const byEntity = new Map();
    for (const m of matches) {
      if (!byEntity.has(m.entityId)) {
        byEntity.set(m.entityId, { entityId: m.entityId, totalScore: 0, reasons: [] });
      }
      const entry = byEntity.get(m.entityId);
      entry.totalScore += m.score;
      entry.reasons.push({ score: m.score, reason: m.reason });
    }
    return Array.from(byEntity.values());
  }

  /**
   * Zoek entity via identifier (KvK, RSIN, website, etc.).
   */
  async _matchByIdentifier(type, value) {
    const result = await this.db.execute({
      sql: `SELECT entity_id FROM entity_identifiers
            WHERE identifier_type = ? AND value = ?`,
      args: [type, value],
    });
    return result.rows;
  }

  /**
   * Zoek entity via naam (kg_entities + kg_aliases).
   */
  async _matchByName(normalizedName, entityType) {
    // Zoek in kg_entities.normalized_name
    const directResult = await this.db.execute({
      sql: `SELECT id, canonical_name, normalized_name, entity_type FROM kg_entities
            WHERE normalized_name = ? AND (? IS NULL OR entity_type = ?) AND merged_into_id IS NULL`,
      args: [normalizedName, entityType || null, entityType || null],
    });

    // Zoek in kg_aliases.normalized_alias
    const aliasResult = await this.db.execute({
      sql: `SELECT ka.entity_id, ka.alias, ka.normalized_alias, ke.entity_type
            FROM kg_aliases ka
            JOIN kg_entities ke ON ke.id = ka.entity_id
            WHERE ka.normalized_alias = ? AND (? IS NULL OR ke.entity_type = ?) AND ke.merged_into_id IS NULL`,
      args: [normalizedName, entityType || null, entityType || null],
    });

    return [...directResult.rows, ...aliasResult.rows];
  }

  /**
   * Zoek entity via BAG-id (entity_locations + locations).
   */
  async _matchByBagId(bagId) {
    const result = await this.db.execute({
      sql: `SELECT el.entity_id FROM entity_locations el
            JOIN locations l ON l.id = el.location_id
            WHERE l.bag_id = ?`,
      args: [bagId],
    });
    return result.rows;
  }

  /**
   * Extraheer domein uit URL.
   */
  _extractDomain(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  /**
   * Maak een nieuwe kg_entity aan (wanneer resolve geen match vindt).
   */
  async createEntity(candidate) {
    if (this.dryRun) {
      console.log(`[DRY RUN] Zou entity aanmaken: ${candidate.name} (${candidate.entityType})`);
      return null;
    }

    const normalized = normalizeStr(candidate.name);
    const result = await this.db.execute({
      sql: `INSERT INTO kg_entities (entity_type, canonical_name, normalized_name)
            VALUES (?, ?, ?)`,
      args: [candidate.entityType, candidate.name, normalized],
    });
    const entityId = Number(result.lastInsertRowid);

    // Voeg aliassen toe
    if (candidate.aliases && candidate.aliases.length > 0) {
      for (const alias of candidate.aliases) {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
                VALUES (?, ?, ?, 'ci', ?)`,
          args: [entityId, alias, normalizeStr(alias), candidate.source || 'auto'],
        });
      }
    }

    // Voeg identifiers toe
    if (candidate.identifiers && candidate.identifiers.length > 0) {
      for (const id of candidate.identifiers) {
        await this.db.execute({
          sql: `INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url)
                VALUES (?, ?, ?, ?)`,
          args: [entityId, id.type, id.value, id.sourceUrl || null],
        });
      }
    }

    return entityId;
  }

  /**
   * Merge entity B in entity A.
   * Verplaatst aliassen, identifiers en relaties van B naar A.
   */
  async mergeEntities(keepId, mergeId) {
    if (this.dryRun) {
      console.log(`[DRY RUN] Zou entity ${mergeId} mergen in ${keepId}`);
      return;
    }

    // Verplaats aliassen
    await this.db.execute({
      sql: `UPDATE OR IGNORE kg_aliases SET entity_id = ? WHERE entity_id = ?`,
      args: [keepId, mergeId],
    });

    // Verplaats identifiers
    await this.db.execute({
      sql: `UPDATE OR IGNORE entity_identifiers SET entity_id = ? WHERE entity_id = ?`,
      args: [keepId, mergeId],
    });

    // Verplaats relaties (subject)
    await this.db.execute({
      sql: `UPDATE kg_relations SET subject_id = ? WHERE subject_id = ?`,
      args: [keepId, mergeId],
    });

    // Verplaats relaties (object)
    await this.db.execute({
      sql: `UPDATE kg_relations SET object_id = ? WHERE object_id = ?`,
      args: [keepId, mergeId],
    });

    // Verplaats entity_locations
    await this.db.execute({
      sql: `UPDATE OR IGNORE entity_locations SET entity_id = ? WHERE entity_id = ?`,
      args: [keepId, mergeId],
    });

    // Verplaats event_entities
    await this.db.execute({
      sql: `UPDATE OR IGNORE event_entities SET entity_id = ? WHERE entity_id = ?`,
      args: [keepId, mergeId],
    });

    // Markeer als gemerged
    await this.db.execute({
      sql: `UPDATE kg_entities SET merged_into_id = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [keepId, mergeId],
    });
  }

  /**
   * Maak een merge-kandidaat aan voor handmatige review.
   */
  async createMergeCandidate(entityAId, entityBId, score, matchDetails) {
    if (this.dryRun) return;

    // Check of dit paar al bestaat
    const existing = await this.db.execute({
      sql: `SELECT id FROM entity_merge_candidates
            WHERE ((entity_a_id = ? AND entity_b_id = ?) OR (entity_a_id = ? AND entity_b_id = ?))
            AND status = 'pending'`,
      args: [entityAId, entityBId, entityBId, entityAId],
    });
    if (existing.rows.length > 0) return;

    await this.db.execute({
      sql: `INSERT INTO entity_merge_candidates (entity_a_id, entity_b_id, score, match_details, status)
            VALUES (?, ?, ?, ?, 'pending')`,
      args: [entityAId, entityBId, score, JSON.stringify(matchDetails)],
    });
  }

  /**
   * Verwerk een entity-kandidaat volledig: resolve → create of merge/review.
   * @returns {Promise<{entityId: number, action: string, score: number}>}
   */
  async resolveOrCreate(candidate) {
    const result = await this.resolve(candidate);

    if (result.action === 'create') {
      const entityId = await this.createEntity(candidate);
      return { entityId, action: 'created', score: 0 };
    }

    if (result.action === 'auto_merge') {
      return { entityId: result.match.entityId, action: 'matched', score: result.score };
    }

    if (result.action === 'review') {
      // Maak merge-kandidaat voor handmatige review, retourneer bestaande entity
      await this.createMergeCandidate(result.match.entityId, null, result.score, result.details);
      return { entityId: result.match.entityId, action: 'review', score: result.score };
    }

    return { entityId: null, action: 'none', score: 0 };
  }
}

module.exports = { EntityResolver, normalizeStr, SCORES, THRESHOLDS, createDb };
