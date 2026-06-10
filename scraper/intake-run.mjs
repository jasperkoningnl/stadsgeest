/**
 * intake-run.mjs — Stadsgeest Intake
 * Run vanuit: C:\Users\Jasper Koning\Documents\Claude\Projects\Nieuwssite Amersfoort\scraper\
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
  const sigTokens = new Set([
    ...tokenize(signal.title),
    ...tokenize(signal.summary || '')
  ]);
  let common = 0;
  for (const t of itemTokens) {
    if (sigTokens.has(t)) common++;
  }
  return common;
}

function extractEntities(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.content || '').substring(0, 500)}`;
  const entities = [];

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

async function run() {
  console.log(`\n=== Stadsgeest Intake: ${new Date().toISOString()} ===\n`);

  const itemsResult = await db.execute(`
    SELECT r.id, r.title, r.content, r.summary, r.external_url, r.scraped_at, r.is_historical,
           s.name as source_name, s.reliability, s.category, s.tier, s.id as source_id
    FROM raw_items r JOIN sources s ON r.source_id = s.id
    WHERE r.is_processed = 0
    ORDER BY r.is_historical ASC, r.scraped_at DESC
    LIMIT 500
  `);
  const items = itemsResult.rows;
  console.log(`${items.length} onverwerkte items gevonden`);

  if (items.length === 0) {
    console.log('Niets te verwerken.');
    process.exit(0);
  }

  const signalsResult = await db.execute(`
    SELECT id, title, summary, confirmations, threshold, status
    FROM signals WHERE status NOT IN ('published', 'discarded')
  `);
  const activeSignals = signalsResult.rows;

  const allTitlesResult = await db.execute(`SELECT title FROM signals`);
  const allSignalTitles = new Set(allTitlesResult.rows.map(r => (r.title || '').toLowerCase().trim()));

  let stats = { verwerkt: 0, gefilterd: 0, nieuwSignaal: 0, historischSignaal: 0, bijgewerktSignaal: 0, drempelBereikt: 0, entiteiten: 0, ids: [] };

  for (const item of items) {
    const tier = item.tier || 2;
    const isHist = item.is_historical === 1;

    // Filters
    if (!item.title && !item.content) { stats.gefilterd++; stats.ids.push(item.id); continue; }
    if (item.source_name && item.source_name.toLowerCase().includes('rechtspraak') && !item.content) { stats.gefilterd++; stats.ids.push(item.id); continue; }
    if (isHist && tier >= 3) { stats.gefilterd++; stats.ids.push(item.id); continue; }

    if (!isHist) {
      const ageH = (Date.now() - new Date(item.scraped_at).getTime()) / 3600000;
      if (ageH > 48) { stats.gefilterd++; stats.ids.push(item.id); continue; }
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
    } else {
      const normTitle = (item.title || '').toLowerCase().trim();
      if (allSignalTitles.has(normTitle)) { stats.gefilterd++; stats.ids.push(item.id); continue; }

      if (!isHist && tier >= 3) {
        const opvallend = /€[\s\d]|schietpartij|brand.*groot|explosie|dode[n]?|overval|arrestat|aanslag|groot alarm/i.test(`${item.title} ${item.summary||''}`);
        if (!opvallend) { stats.gefilterd++; stats.ids.push(item.id); continue; }
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
        if (isHist) { stats.historischSignaal++; console.log(`  HIST [T${tier}] "${(item.title||'').substring(0,50)}" → watching #${newId}`); }
        else { stats.nieuwSignaal++; console.log(`  NIEUW [T${tier}] "${(item.title||'').substring(0,50)}" → new #${newId}`); }
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
    const ents = extractEntities(item);
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
  }

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
}

run().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
