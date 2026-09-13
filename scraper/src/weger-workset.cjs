#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const MAX_CONTENT_CHARS = 4000;
const MAX_ITEMS_PER_SIGNAL = 6;

function usage() {
  return `Gebruik: node scraper/src/weger-workset.cjs [--limit 10] [--summary]\n\n` +
    `Geeft een compacte JSON-werkset voor de Codex-weger. Alleen signalen die nog\n` +
    `niet zijn beoordeeld of na hun laatste weger-oordeel zijn gewijzigd komen mee.`;
}

function parseLimit(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  const index = argv.indexOf('--limit');
  const value = index === -1 ? 10 : Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('--limit moet een geheel getal tussen 1 en 50 zijn.');
  }
  return value;
}

function jsonValue(_key, value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

function clip(value) {
  const text = String(value ?? '');
  return {
    text: text.slice(0, MAX_CONTENT_CHARS),
    length: text.length,
    truncated: text.length > MAX_CONTENT_CHARS,
  };
}

async function tableExists(db, name) {
  const result = await db.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    args: [name],
  });
  return result.rows.length > 0;
}

async function loadItems(db, signalId) {
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM signal_items WHERE signal_id = ?',
    args: [signalId],
  });
  const result = await db.execute({
    sql: `SELECT r.id, r.title, r.summary, r.content, r.full_text,
                 r.external_url, r.published_at, r.scraped_at,
                 src.name AS source_name, src.tier, src.bronrol
          FROM signal_items si
          JOIN raw_items r ON r.id = si.raw_item_id
          JOIN sources src ON src.id = r.source_id
          WHERE si.signal_id = ?
          ORDER BY CASE WHEN src.bronrol = 'spiegel' THEN 1 ELSE 0 END,
                   COALESCE(src.tier, 9),
                   COALESCE(r.published_at, r.scraped_at) DESC, r.id DESC
          LIMIT ?`,
    args: [signalId, MAX_ITEMS_PER_SIGNAL],
  });
  const items = result.rows.map((row) => {
    const body = clip(row.full_text || row.content || row.summary || '');
    return {
      id: Number(row.id),
      title: row.title,
      summary: row.summary,
      url: row.external_url,
      published_at: row.published_at,
      scraped_at: row.scraped_at,
      source: { name: row.source_name, tier: row.tier, role: row.bronrol },
      content: body.text,
      content_length: body.length,
      content_truncated: body.truncated,
    };
  });
  return { items, total: Number(countResult.rows[0]?.n ?? items.length) };
}

async function loadEntities(db, signalId) {
  if (!(await tableExists(db, 'entities'))) return [];
  const result = await db.execute({
    sql: `SELECT DISTINCT e.entity_type, e.name, e.normalized_name, e.context
          FROM signal_items si
          JOIN entities e ON e.raw_item_id = si.raw_item_id
          WHERE si.signal_id = ?
          ORDER BY e.entity_type, e.normalized_name
          LIMIT 100`,
    args: [signalId],
  });
  return result.rows;
}

async function loadRecentEvents(db, signalId) {
  if (!(await tableExists(db, 'signal_events'))) return [];
  const result = await db.execute({
    sql: `SELECT actor, event_type, status_from, status_to, reason, created_at
          FROM signal_events
          WHERE signal_id = ? AND actor <> 'weger'
            AND created_at >= datetime('now','-72 hours')
          ORDER BY created_at DESC
          LIMIT 30`,
    args: [signalId],
  });
  return result.rows;
}

async function main(argv = process.argv.slice(2)) {
  const limit = parseLimit(argv);
  if (limit === null) {
    console.log(usage());
    return;
  }
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken in scraper/.env.');
  }

  const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  try {
    const signals = await db.execute({
      sql: `SELECT s.id, s.title, s.summary, s.status, s.confirmations,
                   s.first_seen_at, s.last_seen_at,
                   (SELECT MAX(e.created_at) FROM signal_events e
                    WHERE e.signal_id = s.id AND e.actor = 'weger') AS weger_last_reviewed_at
            FROM signals s
            WHERE s.status IN ('new','watching')
              AND NOT EXISTS (SELECT 1 FROM tip_signals ts WHERE ts.signal_id = s.id)
              AND (
                NOT EXISTS (SELECT 1 FROM signal_events e WHERE e.signal_id = s.id AND e.actor = 'weger')
                OR datetime(s.last_seen_at) > datetime((
                  SELECT MAX(e.created_at) FROM signal_events e
                  WHERE e.signal_id = s.id AND e.actor = 'weger'
                ))
              )
            ORDER BY datetime(s.last_seen_at) DESC, s.id DESC
            LIMIT ?`,
      args: [limit],
    });

    const candidates = [];
    for (const signal of signals.rows) {
      const signalId = Number(signal.id);
      const [itemSet, entities, recentEvents] = await Promise.all([
        loadItems(db, signalId),
        loadEntities(db, signalId),
        loadRecentEvents(db, signalId),
      ]);
      candidates.push({
        signal: { ...signal, id: signalId },
        items: itemSet.items,
        item_count: itemSet.total,
        items_omitted: Math.max(0, itemSet.total - itemSet.items.length),
        entities,
        recent_events: recentEvents,
      });
    }

    const dossierResult = await db.execute(
      'SELECT id, naam, slug, trefwoorden, omschrijving FROM dossiers ORDER BY naam'
    );
    const output = {
      generated_at: new Date().toISOString(),
      limit,
      selected_count: candidates.length,
      candidates,
      dossiers: dossierResult.rows.map((row) => ({ ...row, id: Number(row.id) })),
    };
    if (argv.includes('--summary')) {
      console.log(JSON.stringify({
        generated_at: output.generated_at,
        selected_count: output.selected_count,
        dossier_count: output.dossiers.length,
        candidates: output.candidates.map((candidate) => ({
          signal_id: candidate.signal.id,
          item_count: candidate.item_count,
          included_items: candidate.items.length,
        })),
      }, null, 2));
    } else {
      console.log(JSON.stringify(output, jsonValue, 2));
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Weger-werkset mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { clip, jsonValue, parseLimit };
