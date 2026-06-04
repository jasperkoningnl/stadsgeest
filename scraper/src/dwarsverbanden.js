/**
 * dwarsverbanden.js
 *
 * Zoekt co-occurrences van entiteiten over bronklassen heen.
 * Schrijft een briefing naar signals.crossref_briefing.
 * Kost nul tokens — pure DB-logica.
 *
 * Draait: 00:45 (nacht, na intake 00:10, vóór speurder 01:01)
 *         11:50 (middag ma-vr, na intake 11:36, vóór analist 12:02)
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const LOOKBACK_DAYS = 90;
const BATCH_LIMIT = 100;

// ─── Schema setup ────────────────────────────────────────────────────────────

async function ensureColumns() {
  const alterStatements = [
    'ALTER TABLE signals ADD COLUMN crossref_checked INTEGER DEFAULT 0',
    'ALTER TABLE signals ADD COLUMN crossref_score INTEGER DEFAULT 0',
    'ALTER TABLE signals ADD COLUMN crossref_briefing TEXT',
    'ALTER TABLE sources ADD COLUMN category TEXT DEFAULT \'other\'',
  ];

  for (const sql of alterStatements) {
    try {
      await db.execute(sql);
    } catch (err) {
      if (!err.message?.includes('duplicate column')) {
        // Kolom bestaat al — prima, verder gaan
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const then = new Date(dateStr);
  const now = new Date();
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 7) return `${days} dagen geleden`;
  if (days < 14) return '1 week geleden';
  if (days < 30) return `${Math.round(days / 7)} weken geleden`;
  if (days < 60) return '1 maand geleden';
  return `${Math.round(days / 30)} maanden geleden`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

async function getUncheckedSignals() {
  const result = await db.execute({
    sql: `SELECT s.id, s.title, s.status, s.summary
          FROM signals s
          WHERE s.status IN ('new', 'watching')
          AND (s.crossref_checked IS NULL OR s.crossref_checked = 0)
          ORDER BY s.created_at DESC
          LIMIT ${BATCH_LIMIT}`,
    args: [],
  });
  return result.rows;
}

// Haal de meest voorkomende categorie van een signaal op via entity_signals → sources
async function getSignalCategory(signalId) {
  const result = await db.execute({
    sql: `SELECT src.category
          FROM entity_signals es
          JOIN sources src ON es.source_id = src.name
          WHERE es.signal_id = ?
          GROUP BY src.category
          ORDER BY COUNT(*) DESC
          LIMIT 1`,
    args: [signalId],
  });
  return result.rows[0]?.category || 'other';
}

async function getEntitiesForSignal(signalId) {
  const result = await db.execute({
    sql: `SELECT e.id, e.name, e.entity_type
          FROM entity_signals es
          JOIN entities e ON es.entity_id = e.id
          WHERE es.signal_id = ?`,
    args: [signalId],
  });
  return result.rows;
}

async function findCrossRefs(entityId, currentSignalId, currentCategory) {
  const result = await db.execute({
    sql: `SELECT
            s.id as signal_id,
            s.title as signal_title,
            s.status,
            s.created_at,
            es.source_id,
            src.name as source_name,
            src.category,
            src.tier,
            es.role
          FROM entity_signals es
          JOIN signals s ON es.signal_id = s.id
          LEFT JOIN sources src ON es.source_id = src.name
          WHERE es.entity_id = ?
          AND es.signal_id != ?
          AND s.created_at > datetime('now', '-${LOOKBACK_DAYS} days')
          AND (src.category != ? OR src.category IS NULL)
          ORDER BY s.created_at DESC
          LIMIT 10`,
    args: [entityId, currentSignalId, currentCategory || 'other'],
  });
  return result.rows;
}

// ─── Score berekening ─────────────────────────────────────────────────────────

function calculateScore(entitiesWithMatches) {
  let score = 0;
  const categories = new Set();

  for (const { entity, matches } of entitiesWithMatches) {
    for (const match of matches) {
      score += 2; // basis per uniek signaal

      if (match.tier === 1 || match.tier === '1') {
        score += 1; // tier 1 bonus
      }

      if (entity.entity_type === 'organization' || entity.entity_type === 'person') {
        score += 1; // sterkere entiteitstypen
      }

      if (match.category) categories.add(match.category);
    }
  }

  if (categories.size > 3) {
    score += 3; // breedte bonus
  }

  return score;
}

// ─── Briefing bouwen ──────────────────────────────────────────────────────────

function buildBriefing(entitiesWithMatches, score) {
  const lines = ['DWARSVERBANDEN (automatisch gegenereerd):\n'];

  for (const { entity, matches } of entitiesWithMatches) {
    if (matches.length === 0) continue;

    const typeLabel = entity.entity_type === 'person' ? 'Persoon'
      : entity.entity_type === 'organization' ? 'Organisatie'
      : entity.entity_type === 'location' ? 'Locatie'
      : 'Entiteit';

    lines.push(`• ${typeLabel} "${entity.name}" komt ook voor in:`);
    for (const match of matches) {
      const ago = timeAgo(match.created_at);
      const sourceName = match.source_name || match.source_id;
      const category = match.category || '?';
      lines.push(`  - "${match.signal_title}" (bron: ${sourceName}, ${category}, ${ago})`);
    }
    lines.push('');
  }

  lines.push(`Dwarsverband-score: ${score}`);
  return lines.join('\n');
}

// ─── Hoofd-loop ───────────────────────────────────────────────────────────────

async function run() {
  const startedAt = new Date().toISOString();
  console.log(`\n=== Dwarsverbanden gestart: ${startedAt} ===\n`);

  await ensureColumns();

  // Check of entity_signals data bevat
  const esCheck = await db.execute('SELECT COUNT(*) as count FROM entity_signals');
  const esCount = esCheck.rows[0].count;

  if (!esCount || Number(esCount) === 0) {
    console.warn('⚠ entity_signals tabel is leeg — geen entiteiten gekoppeld. Stop.');
    return;
  }

  console.log(`entity_signals: ${esCount} koppelingen beschikbaar`);

  const signals = await getUncheckedSignals();
  console.log(`${signals.length} signalen te controleren\n`);

  let checked = 0;
  let withMatches = 0;

  for (const signal of signals) {
    try {
      const entities = await getEntitiesForSignal(signal.id);

      if (entities.length === 0) {
        // Geen entiteiten — markeer als gecheckt, sla over
        await db.execute({
          sql: 'UPDATE signals SET crossref_checked = 1 WHERE id = ?',
          args: [signal.id],
        });
        checked++;
        continue;
      }

      const signalCategory = await getSignalCategory(signal.id);
      const entitiesWithMatches = [];

      for (const entity of entities) {
        const matches = await findCrossRefs(entity.id, signal.id, signalCategory);
        if (matches.length > 0) {
          entitiesWithMatches.push({ entity, matches });
        }
      }

      if (entitiesWithMatches.length > 0) {
        const score = calculateScore(entitiesWithMatches);
        const briefing = buildBriefing(entitiesWithMatches, score);

        await db.execute({
          sql: `UPDATE signals
                SET crossref_briefing = ?,
                    crossref_checked = 1,
                    crossref_score = ?
                WHERE id = ?`,
          args: [briefing, score, signal.id],
        });

        console.log(`✓ [${signal.id}] "${signal.title.substring(0, 60)}" — score: ${score}, ${entitiesWithMatches.length} entiteit(en) met matches`);
        withMatches++;
      } else {
        await db.execute({
          sql: 'UPDATE signals SET crossref_checked = 1, crossref_score = 0 WHERE id = ?',
          args: [signal.id],
        });
      }

      checked++;
    } catch (err) {
      console.error(`✗ Fout bij signaal ${signal.id} ("${signal.title?.substring(0, 40)}"): ${err.message}`);
    }
  }

  console.log(`\n=== Klaar: ${checked} gecheckt, ${withMatches} met dwarsverbanden ===`);
  console.log(`=== Dwarsverbanden voltooid: ${new Date().toISOString()} ===\n`);
}

run().catch((err) => {
  console.error('Fatale fout in dwarsverbanden.js:', err);
  process.exit(1);
});
