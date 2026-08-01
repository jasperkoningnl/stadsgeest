/**
 * intake-run.mjs — Stadsgeest Intake
 * Run vanuit: C:\Users\Jasper Koning\Documents\Claude\Projects\Nieuwssite Amersfoort\scraper\
 *
 * CLI: node intake-run.mjs [trigger]   (trigger default: 'pm2')
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const STOPWOORDEN = new Set(['de','het','een','en','van','in','te','dat','is','op','aan','met','er','maar','om','dan','ook','door','als','bij','dit','zijn','uit','noch','naar','tot','onder','over','worden','heeft','was','voor','nog','wel','niet','meer','ook','zo','nu','al','elke','alle','elk','die','wat','wie','hoe','waar','wanneer','welke','hoeveel','waarom','echter','omdat','want','toch','ja','nee','hier','daar','deze','dit','die','dat','zo','zeer','veel','meer','minder','andere','ieder','iedere','voor','door','naar','zijn','werd','worden','heeft','hebben','kunnen','zal','zou','mogen','willen','gaan']);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWOORDEN.has(w));
}

function matchScore(item, signal) {
  const itemTokens = new Set([
    ...tokenize(item.title),
    ...tokenize(item.summary || ''),
    ...tokenize((item.content || '').substring(0, 300))
  ]);
  // Match alleen op signaal-TITEL, niet op summary.
  // Summary kan heel lang zijn (bijv. research-rapporten) waardoor
  // bijna elk item 2+ woorden deelt en foutief matcht.
  const sigTokens = new Set(tokenize(signal.title));
  let common = 0;
  for (const t of itemTokens) {
    if (sigTokens.has(t)) common++;
  }
  return common;
}

function extractEntities(item, personIndex = []) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.content || '').substring(0, 500)}`;
  const entities = [];

  // Bekende personen (college, raad, bestuurders) — matcht op volledige naam
  // (regex zonder 'g'-vlag: match() geeft dan gewoon de eerste treffer + index terug)
  for (const p of personIndex) {
    const match = text.match(p.regex);
    if (match) {
      entities.push({
        type: 'person',
        name: p.name,
        normalized: p.name.toLowerCase(),
        context: text.substring(Math.max(0, match.index - 30), match.index + p.name.length + 30),
      });
    }
  }

  // Bedragen
  const bedragRe = /€\s*([\d.,]+(?:\s*(?:miljoen|duizend|mln))?)/gi;
  let m;
  while ((m = bedragRe.exec(text)) !== null) {
    entities.push({ type: 'amount', name: `€${m[1].trim()}`, normalized: m[1].trim().toLowerCase().replace(/\s+/g,''), context: text.substring(Math.max(0, m.index-30), m.index+60) });
  }

  // ECLI
  const ecliRe = /ECLI:[A-Z]{2}:[A-Z]+:\d{4}:[A-Z0-9]+/gi;
  while ((m = ecliRe.exec(text)) !== null) {
    entities.push({ type: 'legal_ref', name: m[0], normalized: m[0].toLowerCase(), context: text.substring(Math.max(0, m.index-20), m.index+60) });
  }

  // Bekende organisaties en locaties
  const patterns = [
    { re: /\bgemeente amersfoort\b/i, name: 'Gemeente Amersfoort', normalized: 'gemeente amersfoort', type: 'organization' },
    { re: /\b(?:b&w|college van b&w|burgemeester en wethouders)\b/i, name: 'College B&W Amersfoort', normalized: 'gemeente amersfoort', type: 'organization' },
    { re: /\bde alliantie\b/i, name: 'De Alliantie', normalized: 'de alliantie', type: 'organization' },
    { re: /\bmeander\b/i, name: 'Meander Medisch Centrum', normalized: 'meander medisch centrum', type: 'organization' },
    { re: /\bvru\b|\bveiligheidsregio\b/i, name: 'VRU', normalized: 'veiligheidsregio utrecht-noord', type: 'organization' },
    { re: /\bportaal\b/i, name: 'Portaal', normalized: 'portaal', type: 'organization' },
    { re: /\bwaterschap vallei\b/i, name: 'Waterschap Vallei en Veluwe', normalized: 'waterschap vallei en veluwe', type: 'organization' },
    { re: /\bprorail\b/i, name: 'ProRail', normalized: 'prorail', type: 'organization' },
    { re: /\bhoefkwartier\b/i, name: 'Hoefkwartier', normalized: 'hoefkwartier', type: 'project' },
    { re: /\bwind op isselt\b/i, name: 'Wind op Isselt', normalized: 'wind op isselt', type: 'project' },
    { re: /\bisselt\b/i, name: 'Isselt', normalized: 'isselt', type: 'location' },
    { re: /\bsoesterkwartier\b/i, name: 'Soesterkwartier', normalized: 'soesterkwartier', type: 'location' },
    { re: /\bkattenbroek\b/i, name: 'Kattenbroek', normalized: 'kattenbroek', type: 'location' },
    { re: /\bnimf\b/i, name: 'NIMF', normalized: 'nimf amersfoort', type: 'organization' },
  ];

  for (const p of patterns) {
    if (p.re.test(text)) {
      const match = p.re.exec(text);
      if (match) {
        entities.push({ type: p.type, name: p.name, normalized: p.normalized, context: text.substring(Math.max(0, match.index-20), match.index+60) });
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  return entities.filter(e => {
    const key = `${e.type}:${e.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadPersonIndex() {
  const res = await db.execute('SELECT name FROM persons');
  return res.rows.map(p => ({
    name: p.name,
    regex: new RegExp(`\\b${escapeRegex(p.name)}\\b`, 'i'),
  }));
}

// ─── Dashboard-logging: batched schrijven naar intake_decisions / signal_events ───

function makeBatcher(flushSize = 50) {
  let buf = [];
  return {
    async push(stmt) {
      buf.push(stmt);
      if (buf.length >= flushSize) {
        const chunk = buf;
        buf = [];
        await db.batch(chunk, 'write');
      }
    },
    async flush() {
      if (buf.length === 0) return;
      const chunk = buf;
      buf = [];
      await db.batch(chunk, 'write');
    },
  };
}

function decisionStmt(runId, item, tier, decision, reason, extra = {}) {
  return {
    sql: `INSERT INTO intake_decisions (intake_run_id, raw_item_id, source_id, source_name, item_title, decision, reason, signal_id, match_score, tier)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [runId, item.id, item.source_id ?? null, item.source_name ?? null, item.title ?? null, decision, reason, extra.signal_id ?? null, extra.match_score ?? null, tier],
  };
}

function eventStmt(signalId, eventType, { statusFrom = null, statusTo = null, reason = null } = {}) {
  return {
    sql: `INSERT INTO signal_events (signal_id, actor, event_type, status_from, status_to, reason)
          VALUES (?, 'intake', ?, ?, ?, ?)`,
    args: [signalId, eventType, statusFrom, statusTo, reason],
  };
}

async function finishIntakeRun(runId, startedAt, counts, status, errorMessage) {
  const durationMs = Date.now() - startedAt;
  await db.execute({
    sql: `UPDATE intake_runs SET
            finished_at = datetime('now'),
            duration_ms = ?,
            items_in = ?,
            items_filtered = ?,
            items_matched = ?,
            signals_created = ?,
            signals_historical = ?,
            thresholds_reached = ?,
            entities_created = ?,
            status = ?,
            error_message = ?
          WHERE id = ?`,
    args: [
      durationMs,
      counts.items_in,
      counts.items_filtered,
      counts.items_matched,
      counts.signals_created,
      counts.signals_historical,
      counts.thresholds_reached,
      counts.entities_created,
      status,
      errorMessage ?? null,
      runId,
    ],
  });
}

async function run() {
  console.log(`\n=== Stadsgeest Intake: ${new Date().toISOString()} ===\n`);

  const trigger = process.argv[2] || 'pm2';
  const startedAt = Date.now();
  const runResult = await db.execute({
    sql: `INSERT INTO intake_runs (trigger, started_at) VALUES (?, datetime('now')) RETURNING id`,
    args: [trigger],
  });
  const runId = runResult.rows[0]?.id;

  const decisionBatcher = makeBatcher(50);
  const eventBatcher = makeBatcher(50);
  const entityUpdateBatcher = makeBatcher(50);

  let stats = { verwerkt: 0, gefilterd: 0, nieuwSignaal: 0, historischSignaal: 0, bijgewerktSignaal: 0, drempelBereikt: 0, entiteiten: 0, ids: [] };
  let itemsInCount = 0;

  const countsFromStats = () => ({
    items_in: itemsInCount,
    items_filtered: stats.gefilterd,
    items_matched: stats.bijgewerktSignaal,
    signals_created: stats.nieuwSignaal,
    signals_historical: stats.historischSignaal,
    thresholds_reached: stats.drempelBereikt,
    entities_created: stats.entiteiten,
  });

  try {
    const personIndex = await loadPersonIndex();
    console.log(`${personIndex.length} bekende personen geladen voor entiteitsherkenning`);

    const itemsResult = await db.execute(`
      SELECT r.id, r.title, r.content, r.summary, r.external_url, r.scraped_at, r.is_historical,
             s.name as source_name, s.reliability, s.category, s.tier, s.id as source_id
      FROM raw_items r JOIN sources s ON r.source_id = s.id
      WHERE r.is_processed = 0
      ORDER BY r.is_historical ASC, r.scraped_at DESC
      LIMIT 500
    `);
    const items = itemsResult.rows;
    itemsInCount = items.length;
    console.log(`${items.length} onverwerkte items gevonden`);

    if (items.length === 0) {
      console.log('Niets te verwerken.');
      await finishIntakeRun(runId, startedAt, countsFromStats(), 'ok', null);
      process.exit(0);
    }

    const signalsResult = await db.execute(`
      SELECT id, title, summary, confirmations, threshold, status
      FROM signals WHERE status NOT IN ('published', 'discarded')
    `);
    const activeSignals = signalsResult.rows;

    const allTitlesResult = await db.execute(`SELECT title FROM signals`);
    const allSignalTitles = new Set(allTitlesResult.rows.map(r => (r.title || '').toLowerCase().trim()));

    for (const item of items) {
      const tier = item.tier || 2;
      const isHist = item.is_historical === 1;

      // Filters
      if (!item.title && !item.content) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'leeg item zonder titel of inhoud'));
        continue;
      }
      if (item.source_name && item.source_name.toLowerCase().includes('rechtspraak') && !item.content) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'rechtspraak-item zonder uitspraaktekst'));
        continue;
      }
      if (isHist && tier >= 3) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'historisch item uit tier 3-bron, alleen gebruikt als context'));
        continue;
      }

      if (!isHist) {
        const ageH = (Date.now() - new Date(item.scraped_at).getTime()) / 3600000;
        if (ageH > 48) {
          stats.gefilterd++; stats.ids.push(item.id);
          await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', `gescraped meer dan 48 uur geleden (${Math.round(ageH)} uur)`));
          continue;
        }
      }

      // Signaalmatching
      let bestMatch = null, bestScore = 0;
      for (const sig of activeSignals) {
        const score = matchScore(item, sig);
        if (score >= 2 && score > bestScore) { bestScore = score; bestMatch = sig; }
      }

      if (bestMatch) {
        await db.execute({ sql: `UPDATE signals SET confirmations = confirmations + 1, last_seen_at = datetime('now') WHERE id = ?`, args: [bestMatch.id] });
        await db.execute({ sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`, args: [bestMatch.id, item.id] });
        bestMatch.confirmations = (bestMatch.confirmations || 0) + 1;
        stats.bijgewerktSignaal++;
        console.log(`  MATCH [T${tier}] "${(item.title||'').substring(0,50)}" → #${bestMatch.id} (score:${bestScore})`);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'matched', `gekoppeld aan signaal #${bestMatch.id} (${bestScore} gedeelde woorden in de titel)`, { signal_id: bestMatch.id, match_score: bestScore }));
        await eventBatcher.push(eventStmt(bestMatch.id, 'confirmed', { reason: `bevestigd door nieuw item uit ${item.source_name || 'onbekende bron'}` }));
      } else {
        const normTitle = (item.title || '').toLowerCase().trim();
        if (allSignalTitles.has(normTitle)) {
          stats.gefilterd++; stats.ids.push(item.id);
          await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'titel komt exact overeen met bestaand signaal'));
          continue;
        }

        if (!isHist && tier >= 3) {
          const opvallend = /€[\s\d]|schietpartij|brand.*groot|explosie|dode[n]?|overval|arrestat|aanslag|groot alarm/i.test(`${item.title} ${item.summary||''}`);
          if (!opvallend) {
            stats.gefilterd++; stats.ids.push(item.id);
            await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'tier 3-bron zonder trefwoord dat op nieuwswaarde wijst'));
            continue;
          }
        }

        const tierTag = `[TIER: ${tier}]`;
        const summary = isHist
          ? `[HISTORISCH — bron voor context, geen actief signaal] ${tierTag} ${item.summary || (item.title||'').substring(0,200)}`
          : `${tierTag} ${item.summary || (item.title||'').substring(0,200)}`;
        const status = isHist ? 'watching' : 'new';

        let newId;
        if (isHist) {
          const res = await db.execute({ sql: `INSERT INTO signals (title, summary, status, confirmations, threshold, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 3, ?, ?) RETURNING id`, args: [(item.title||'(geen titel)'), summary, status, item.scraped_at, item.scraped_at] });
          newId = res.rows[0]?.id;
        } else {
          const res = await db.execute({ sql: `INSERT INTO signals (title, summary, status, confirmations, threshold, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 3, datetime('now'), datetime('now')) RETURNING id`, args: [(item.title||'(geen titel)'), summary, status] });
          newId = res.rows[0]?.id;
        }

        if (newId) {
          await db.execute({ sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`, args: [newId, item.id] });
          activeSignals.push({ id: newId, title: item.title, summary, confirmations: 1, threshold: 3, status });
          allSignalTitles.add(normTitle);
          const reason = `nieuw signaal aangemaakt vanuit ${item.source_name || 'onbekende bron'}, tier ${tier}`;
          if (isHist) { stats.historischSignaal++; console.log(`  HIST [T${tier}] "${(item.title||'').substring(0,50)}" → watching #${newId}`); }
          else { stats.nieuwSignaal++; console.log(`  NIEUW [T${tier}] "${(item.title||'').substring(0,50)}" → new #${newId}`); }
          await decisionBatcher.push(decisionStmt(runId, item, tier, isHist ? 'historical_signal' : 'new_signal', reason, { signal_id: newId }));
          await eventBatcher.push(eventStmt(newId, 'created', { statusTo: status, reason }));
        }
      }

      stats.verwerkt++;
      stats.ids.push(item.id);
    }

    // Drempels
    const dr = await db.execute(`SELECT id, title, confirmations, threshold FROM signals WHERE confirmations >= threshold AND status = 'new'`);
    for (const s of dr.rows) {
      await db.execute({ sql: `UPDATE signals SET status = 'watching' WHERE id = ?`, args: [s.id] });
      stats.drempelBereikt++;
      console.log(`  DREMPEL #${s.id} "${(s.title||'').substring(0,40)}" → watching`);
      await eventBatcher.push(eventStmt(s.id, 'status_change', { statusFrom: 'new', statusTo: 'watching', reason: `drempel van ${s.threshold} bevestigingen bereikt` }));
    }

    // Markeer verwerkt
    for (let i = 0; i < stats.ids.length; i += 50) {
      const chunk = stats.ids.slice(i, i+50);
      const ph = chunk.map(() => '?').join(',');
      await db.execute({ sql: `UPDATE raw_items SET is_processed = 1 WHERE id IN (${ph})`, args: chunk });
    }

    // Entiteiten (primary/secondary)
    const entItems = items.filter(it => (it.reliability === 'primary' || it.reliability === 'secondary') && stats.ids.includes(it.id));
    for (const item of entItems) {
      const ents = extractEntities(item, personIndex);
      const sl = await db.execute({ sql: `SELECT signal_id FROM signal_items WHERE raw_item_id = ? LIMIT 1`, args: [item.id] });
      const sigId = sl.rows[0]?.signal_id;
      for (const ent of ents) {
        try {
          const ex = await db.execute({ sql: `SELECT id FROM entities WHERE normalized_name = ? AND entity_type = ?`, args: [ent.normalized, ent.type] });
          let eid;
          if (ex.rows.length > 0) { eid = ex.rows[0].id; }
          else {
            const res = await db.execute({ sql: `INSERT INTO entities (raw_item_id, entity_type, name, normalized_name, context) VALUES (?, ?, ?, ?, ?) RETURNING id`, args: [item.id, ent.type, ent.name, ent.normalized, ent.context||''] });
            eid = res.rows[0]?.id;
            stats.entiteiten++;
          }
          if (eid && sigId) {
            await db.execute({ sql: `INSERT OR IGNORE INTO entity_signals (entity_id, signal_id, source_id, role) VALUES (?, ?, ?, 'mentioned')`, args: [eid, sigId, item.source_name||''] });
          }
        } catch (_) {}
      }
      if (ents.length > 0) {
        await entityUpdateBatcher.push({
          sql: `UPDATE intake_decisions SET entities_found = ? WHERE intake_run_id = ? AND raw_item_id = ?`,
          args: [JSON.stringify(ents), runId, item.id],
        });
      }
    }

    await decisionBatcher.flush();
    await eventBatcher.flush();
    await entityUpdateBatcher.flush();

    console.log('\n═══ INTAKE SAMENVATTING ═══');
    console.log(`Items gevonden:          ${items.length}`);
    console.log(`Items verwerkt:          ${stats.verwerkt}`);
    console.log(`Items gefilterd:         ${stats.gefilterd}`);
    console.log(`Nieuwe signalen (new):   ${stats.nieuwSignaal}`);
    console.log(`Historische signalen:    ${stats.historischSignaal}`);
    console.log(`Signalen bijgewerkt:     ${stats.bijgewerktSignaal}`);
    console.log(`Drempels bereikt:        ${stats.drempelBereikt}`);
    console.log(`Entiteiten nieuw:        ${stats.entiteiten}`);

    const fc = await db.execute(`SELECT status, COUNT(*) as cnt FROM signals GROUP BY status`);
    console.log('\nSignalen per status:');
    for (const r of fc.rows) console.log(`  ${r.status}: ${r.cnt}`);
    console.log(`\n=== Voltooid: ${new Date().toISOString()} ===`);

    await finishIntakeRun(runId, startedAt, countsFromStats(), 'ok', null);
  } catch (e) {
    console.error('FOUT:', e.message);
    try { await decisionBatcher.flush(); } catch (_) {}
    try { await eventBatcher.flush(); } catch (_) {}
    try { await entityUpdateBatcher.flush(); } catch (_) {}
    try {
      await finishIntakeRun(runId, startedAt, countsFromStats(), 'error', (e.message || String(e)).substring(0, 500));
    } catch (finishErr) {
      console.error('Kon intake_runs niet afsluiten:', finishErr.message);
    }
    process.exit(1);
  }
}

run().catch(e => {
  // Val hier alleen in als er niet eens een intake_runs-rij kon worden aangemaakt
  // (bijv. DB niet bereikbaar) — de rest van de fouten wordt al binnen run() afgehandeld.
  console.error('FOUT: intake-run kon niet starten:', e.message);
  process.exit(1);
});
