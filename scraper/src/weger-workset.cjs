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

// Korte tekst voor koppelvelden; clip() is voor documentinhoud.
function short(value, max = 200) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
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

// Spoor 1 (NER, 2026-09-23): KG-entiteiten die spaCy in de documenten van dit
// signaal vond en die niet al via de aliasextractie in `entities` staan. Alleen
// koppelkandidaten op exacte naam/alias; onopgeloste vermeldingen gaan bewust
// niet mee (te veel ruis, zie docs/NER.md).
async function loadNerKgCandidates(db, signalId) {
  if (!(await tableExists(db, 'document_mentions'))) return [];
  const result = await db.execute({
    sql: `SELECT dm.resolved_entity_id AS kg_entity_id, ke.entity_type,
                 ke.canonical_name AS kg_naam,
                 GROUP_CONCAT(DISTINCT dm.mention_text) AS vormen,
                 SUM(dm.occurrences) AS vermeldingen,
                 MIN(dm.context_snippet) AS context,
                 MAX(dm.resolution_status) AS status,
                 GROUP_CONCAT(DISTINCT s.name) AS bronnen
          FROM signal_items si
          JOIN document_mentions dm ON dm.raw_item_id = si.raw_item_id
          JOIN kg_entities ke ON ke.id = dm.resolved_entity_id
          JOIN raw_items r ON r.id = dm.raw_item_id
          JOIN sources s ON s.id = r.source_id
          WHERE si.signal_id = ?
            AND dm.resolution_status IN ('candidate', 'confirmed')
            AND NOT EXISTS (
              SELECT 1 FROM signal_items si2
              JOIN entities e ON e.raw_item_id = si2.raw_item_id
              WHERE si2.signal_id = si.signal_id
                AND ((ke.source_person_id IS NOT NULL AND e.person_id = ke.source_person_id)
                  OR (ke.source_org_id IS NOT NULL AND e.organization_id = ke.source_org_id))
            )
          GROUP BY dm.resolved_entity_id
          ORDER BY vermeldingen DESC
          LIMIT 25`,
    args: [signalId],
  });
  // Een kandidaat die de bron zelf is ('NS' in 'NS Verstoringen') zegt niets.
  const isSource = (row) => {
    const naam = String(row.kg_naam || '').toLowerCase().trim();
    if (!naam) return false;
    const woord = new RegExp(`(^|[^\\p{L}\\d])${naam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\d]|$)`, 'u');
    return String(row.bronnen || '').split(',').every((b) => woord.test(b.toLowerCase()));
  };
  return result.rows.filter((row) => !isSource(row)).map(({ bronnen, ...row }) => ({
    ...row,
    kg_entity_id: Number(row.kg_entity_id),
    vermeldingen: Number(row.vermeldingen),
    context: short(row.context),
  }));
}

// Adreskoppeling (2026-09-23): per exact BAG-adres in dit signaal de andere
// documenten, registers en KG-organisaties op precies dat adres (nummeraanduiding).
// Alleen adressen met minstens één treffer elders gaan mee. Een adres dat in meer
// dan 50 documenten staat (gemeentehuis, postadres) krijgt geen documentlijst.
async function loadAddressLinks(db, signalId) {
  if (!(await tableExists(db, 'document_addresses'))) return [];
  const haveRegisters = await tableExists(db, 'register_addresses');
  const havePanden = await tableExists(db, 'bag_vbo_pand');
  const addresses = (await db.execute({
    sql: `SELECT da.nummeraanduiding_id AS bag_id, MIN(da.address_text) AS adres, MIN(da.buurtcode) AS buurtcode,
                 MIN(da.verblijfsobject_id) AS vbo
          FROM signal_items si JOIN document_addresses da ON da.raw_item_id = si.raw_item_id
          WHERE si.signal_id = ? AND da.match_status = 'exact'
          GROUP BY da.nummeraanduiding_id LIMIT 10`,
    args: [signalId],
  })).rows;
  const out = [];
  for (const a of addresses) {
    const others = (await db.execute({
      sql: `SELECT r.id, r.title, s.name AS bron, COALESCE(r.published_at, r.scraped_at) AS datum
            FROM document_addresses da
            JOIN raw_items r ON r.id = da.raw_item_id
            JOIN sources s ON s.id = r.source_id
            WHERE da.nummeraanduiding_id = ? AND da.match_status = 'exact'
              AND da.raw_item_id NOT IN (SELECT raw_item_id FROM signal_items WHERE signal_id = ?)
            ORDER BY r.id DESC LIMIT 51`,
      args: [a.bag_id, signalId],
    })).rows;
    const registers = haveRegisters ? (await db.execute({
      sql: `SELECT s.name AS register, ra.label, ra.role
            FROM register_addresses ra JOIN sources s ON s.id = ra.source_id
            WHERE ra.nummeraanduiding_id = ? AND ra.match_status = 'exact' LIMIT 10`,
      args: [a.bag_id],
    })).rows : [];
    const kg = (await db.execute({
      sql: `SELECT DISTINCT ke.id AS kg_entity_id, ke.canonical_name AS naam, el.relation_type AS relatie
            FROM locations l
            JOIN entity_locations el ON el.location_id = l.id
            JOIN kg_entities ke ON ke.id = el.entity_id
            WHERE l.bag_id = ? LIMIT 10`,
      args: [a.bag_id],
    })).rows;
    // Zelfde gebouw, ander adres (2026-09-24): via het BAG-pand. Alleen bij panden
    // met hoogstens 20 verblijfsobjecten; een flat of kantoorverzamelgebouw zegt niets.
    let pand = null;
    let samePand = [];
    if (havePanden && a.vbo) {
      const panden = (await db.execute({
        sql: 'SELECT pand_id, bouwjaar, aantal_verblijfsobjecten FROM bag_vbo_pand WHERE verblijfsobject_id = ?',
        args: [a.vbo],
      })).rows;
      if (panden.length) {
        const ids = panden.map((p) => p.pand_id);
        const maxVbo = Math.max(...panden.map((p) => Number(p.aantal_verblijfsobjecten) || 0));
        pand = { pand_ids: ids, bouwjaar: panden[0].bouwjaar, verblijfsobjecten: maxVbo };
        if (maxVbo <= 20) {
          const inList = ids.map(() => '?').join(',');
          samePand = (await db.execute({
            sql: `SELECT 'register' AS soort, s.name AS bron, ra.label AS wat, ra.address_text AS adres
                  FROM bag_vbo_pand p2
                  JOIN register_addresses ra ON ra.verblijfsobject_id = p2.verblijfsobject_id
                  JOIN sources s ON s.id = ra.source_id
                  WHERE p2.pand_id IN (${inList}) AND ra.match_status = 'exact' AND ra.nummeraanduiding_id <> ?
                  UNION ALL
                  SELECT 'document' AS soort, s.name AS bron, r.title AS wat, da.address_text AS adres
                  FROM bag_vbo_pand p2
                  JOIN document_addresses da ON da.verblijfsobject_id = p2.verblijfsobject_id
                  JOIN raw_items r ON r.id = da.raw_item_id
                  JOIN sources s ON s.id = r.source_id
                  WHERE p2.pand_id IN (${inList}) AND da.match_status = 'exact' AND da.nummeraanduiding_id <> ?
                    AND da.raw_item_id NOT IN (SELECT raw_item_id FROM signal_items WHERE signal_id = ?)
                  LIMIT 10`,
            args: [...ids, a.bag_id, ...ids, a.bag_id, signalId],
          })).rows.map((x) => ({ ...x, wat: short(x.wat) }));
        }
      }
    }
    if (!others.length && !registers.length && !kg.length && !samePand.length) continue;
    const veel = others.length > 50;
    out.push({
      adres: a.adres,
      bag_nummeraanduiding: a.bag_id,
      buurtcode: a.buurtcode,
      andere_documenten: veel ? 'meer dan 50 (veelvoorkomend adres, niet gelijst)' : others.slice(0, 5).map((o) => ({
        raw_item_id: Number(o.id), titel: short(o.title), bron: o.bron, datum: o.datum,
      })),
      andere_documenten_aantal: veel ? '>50' : others.length,
      registers,
      kg_organisaties: kg.map((k) => ({ ...k, kg_entity_id: Number(k.kg_entity_id) })),
      pand,
      zelfde_pand_ander_adres: samePand,
    });
  }
  return out;
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
      const [itemSet, entities, recentEvents, nerKgCandidates, addressLinks] = await Promise.all([
        loadItems(db, signalId),
        loadEntities(db, signalId),
        loadRecentEvents(db, signalId),
        loadNerKgCandidates(db, signalId),
        loadAddressLinks(db, signalId),
      ]);
      candidates.push({
        signal: { ...signal, id: signalId },
        items: itemSet.items,
        item_count: itemSet.total,
        items_omitted: Math.max(0, itemSet.total - itemSet.items.length),
        entities,
        ner_kg_kandidaten: nerKgCandidates,
        adres_koppelingen: addressLinks,
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

module.exports = { clip, jsonValue, parseLimit, loadNerKgCandidates, loadAddressLinks };
