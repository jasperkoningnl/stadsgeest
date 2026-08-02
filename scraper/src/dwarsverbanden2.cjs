// Dwarsverbanden 2.0 (P2, 2026-08-02). Vier detectoren over entity_mentions/subsidies.
// Default: READ-ONLY rapport naar stdout + dwarsverbanden/rapport-[datum].md.
// Met --write: schrijft crossref_briefing op gekoppelde signalen + signal_events (actor 'dwarsverbanden').
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const WRITE = process.argv.includes('--write');
const GENERIEK = new Set(['gemeente amersfoort', 'nieuwsplein33', 'de stad amersfoort']);

async function detect() {
  const out = [];

  // 1. KRUISBRON: zelfde sterke entiteit in >=2 bronCATEGORIEËN (tier<=2) binnen 90 dagen
  const kruis = await db.execute(`
    SELECT e.normalized_name, e.entity_type,
           GROUP_CONCAT(DISTINCT s.category) cats,
           COUNT(DISTINCT s.category) ncat,
           COUNT(DISTINCT m.raw_item_id) nitems,
           GROUP_CONCAT(DISTINCT r.id) item_ids
    FROM entity_mentions m
    JOIN entities e ON e.id = m.entity_id
    JOIN raw_items r ON r.id = m.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE e.entity_type IN ('person','organization','address')
      AND COALESCE(s.tier, 2) <= 2
      AND r.scraped_at > datetime('now','-90 days')
    GROUP BY e.normalized_name, e.entity_type
    HAVING ncat >= 2
    ORDER BY ncat DESC, nitems DESC LIMIT 40`);
  for (const r of kruis.rows) {
    if (GENERIEK.has(r.normalized_name)) continue;
    out.push({ det: 'KRUISBRON', ent: r.normalized_name, type: r.entity_type, score: Number(r.ncat), info: `komt voor in bronklassen [${r.cats}] over ${r.nitems} documenten (90d)`, item_ids: String(r.item_ids), vraag: `Waarom duikt ${r.normalized_name} op in zowel ${String(r.cats).split(',').join(' als ')}? Documenten naast elkaar leggen.`, betrouwbaarheid: Number(r.ncat) >= 3 ? 'middel' : 'laag' });
  }

  // 2. STAPELING: entiteit >=3 documenten in 60 dagen, historisch <=1 per 60 dagen
  const stapel = await db.execute(`
    WITH recent AS (
      SELECT e.normalized_name, e.entity_type, COUNT(DISTINCT m.raw_item_id) n, GROUP_CONCAT(DISTINCT m.raw_item_id) ids
      FROM entity_mentions m JOIN entities e ON e.id = m.entity_id
      JOIN raw_items r ON r.id = m.raw_item_id
      WHERE r.scraped_at > datetime('now','-60 days') AND e.entity_type IN ('organization','address','location')
      GROUP BY e.normalized_name, e.entity_type HAVING n >= 3
    ), hist AS (
      SELECT e.normalized_name, COUNT(DISTINCT m.raw_item_id) * 60.0 /
        MAX(1, JULIANDAY('now','-60 days') - JULIANDAY(MIN(r.scraped_at))) per60
      FROM entity_mentions m JOIN entities e ON e.id = m.entity_id
      JOIN raw_items r ON r.id = m.raw_item_id
      WHERE r.scraped_at <= datetime('now','-60 days')
      GROUP BY e.normalized_name
    )
    SELECT recent.*, COALESCE(hist.per60, 0) basis FROM recent LEFT JOIN hist USING (normalized_name)
    WHERE COALESCE(hist.per60, 0) <= 1 ORDER BY recent.n DESC LIMIT 25`);
  for (const r of stapel.rows) {
    if (GENERIEK.has(r.normalized_name)) continue;
    out.push({ det: 'STAPELING', ent: r.normalized_name, type: r.entity_type, score: Number(r.n), info: `${r.n} documenten in 60 dagen, historische basislijn ${Number(r.basis).toFixed(1)}/60d`, item_ids: String(r.ids), vraag: `Wat verklaart de plotselinge concentratie rond ${r.normalized_name}?`, betrouwbaarheid: Number(r.n) >= 5 ? 'middel' : 'laag' });
  }

  // 3. SUBSIDIE-ANOMALIE
  const subs = await db.execute(`
    SELECT ontvanger_normalized ontv,
           SUM(CASE WHEN jaar=2024 THEN bedrag ELSE 0 END) b24,
           SUM(CASE WHEN jaar=2025 THEN bedrag ELSE 0 END) b25,
           COUNT(DISTINCT COALESCE(deelprogramma, programmanr)) nprog
    FROM subsidies WHERE is_particulier = 0
    GROUP BY ontvanger_normalized`);
  for (const r of subs.rows) {
    const b24 = Number(r.b24) || 0, b25 = Number(r.b25) || 0;
    if (b24 >= 25000 && b25 >= 25000 && (b25 > b24 * 1.5 || b25 < b24 * 0.5)) {
      out.push({ det: 'SUBSIDIE', ent: r.ontv, type: 'organization', score: 3, info: `2024: EUR ${Math.round(b24).toLocaleString('nl-NL')} -> 2025: EUR ${Math.round(b25).toLocaleString('nl-NL')} (${b25 > b24 ? '+' : ''}${Math.round((b25 / Math.max(b24, 1) - 1) * 100)}%)`, item_ids: '', vraag: `Waarom ${b25 > b24 ? 'steeg' : 'daalde'} de subsidie aan ${r.ontv} zo sterk? Collegebesluit erbij zoeken.`, betrouwbaarheid: 'middel' });
    } else if (b24 === 0 && b25 >= 50000) {
      out.push({ det: 'SUBSIDIE', ent: r.ontv, type: 'organization', score: 2, info: `nieuwe grote ontvanger: EUR ${Math.round(b25).toLocaleString('nl-NL')} in 2025, niets in 2024`, item_ids: '', vraag: `Wie is ${r.ontv} en waarvoor is dit toegekend?`, betrouwbaarheid: 'middel' });
    }
    if (Number(r.nprog) >= 3 && (b24 + b25) >= 50000) {
      out.push({ det: 'SUBSIDIE', ent: r.ontv, type: 'organization', score: 2, info: `ontvangt uit ${r.nprog} verschillende programma's, totaal EUR ${Math.round(b24 + b25).toLocaleString('nl-NL')}`, item_ids: '', vraag: `Is de stapeling van subsidies aan ${r.ontv} bekend bij de raad?`, betrouwbaarheid: 'laag' });
    }
  }

  // 4. ROLCONFLICT: bestuurder (persoon) en 'zijn' organisatie samen genoemd in registry/tender/rechtspraak-document
  const rol = await db.execute(`
    SELECT p.name persoon, o.name org, ro.title functie, r.id item_id, r.title doc, s.category cat
    FROM entity_mentions mp
    JOIN entities ep ON ep.id = mp.entity_id AND ep.person_id IS NOT NULL
    JOIN roles ro ON ro.person_id = ep.person_id AND ro.is_current = 1
    JOIN persons p ON p.id = ep.person_id
    JOIN organizations o ON o.id = ro.organization_id
    JOIN entity_mentions mo ON mo.raw_item_id = mp.raw_item_id
    JOIN entities eo ON eo.id = mo.entity_id AND eo.organization_id = ro.organization_id
    JOIN raw_items r ON r.id = mp.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE s.category IN ('registry','government','data') AND COALESCE(s.tier,2) = 1
      AND o.normalized_name != 'gemeente amersfoort'
    LIMIT 25`);
  for (const r of rol.rows) {
    out.push({ det: 'ROLCONFLICT', ent: `${r.persoon} / ${r.org}`, type: 'person', score: 4, info: `${r.persoon} (${r.functie} bij ${r.org}) en ${r.org} samen genoemd in ${r.cat}-document "${String(r.doc).substring(0, 80)}" (item ${r.item_id})`, item_ids: String(r.item_id), vraag: `Raakt dit besluit/document de organisatie waar ${r.persoon} een rol heeft? ALTIJD menselijke verificatie vóór publicatie.`, betrouwbaarheid: 'laag' });
  }
  return out;
}

async function main() {
  const det = await detect();
  const datum = new Date().toISOString().substring(0, 10);
  const dir = path.join(__dirname, '..', '..', 'dwarsverbanden');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = det.map(d => `- [${d.det}] (${d.betrouwbaarheid}) ${d.ent} — ${d.info}\n  Vraag: ${d.vraag}`);
  fs.writeFileSync(path.join(dir, `rapport-${datum}.md`), `# Dwarsverbanden ${datum} (${WRITE ? 'write' : 'read-only'})\n\n${det.length} detecties.\n\n${lines.join('\n')}\n`, 'utf8');
  console.log(`${det.length} detecties (${det.filter(d => d.det === 'KRUISBRON').length} kruisbron, ${det.filter(d => d.det === 'STAPELING').length} stapeling, ${det.filter(d => d.det === 'SUBSIDIE').length} subsidie, ${det.filter(d => d.det === 'ROLCONFLICT').length} rolconflict). Rapport: dwarsverbanden/rapport-${datum}.md`);

  if (!WRITE) return;
  let written = 0;
  for (const d of det) {
    if (d.betrouwbaarheid === 'laag' && d.det !== 'ROLCONFLICT') continue; // alleen middel/hoog + alle rolconflicten
    // koppel aan bestaand signaal via items, anders overslaan (signaal-creatie blijft mensenwerk/speurderwerk)
    let sigId = null;
    if (d.item_ids) {
      const ids = d.item_ids.split(',').slice(0, 20).map(Number).filter(Boolean);
      if (ids.length) {
        const q = await db.execute({ sql: `SELECT signal_id FROM signal_items WHERE raw_item_id IN (${ids.map(() => '?').join(',')}) LIMIT 1`, args: ids });
        if (q.rows.length) sigId = q.rows[0].signal_id;
      }
    }
    const briefing = `[${d.det} | betrouwbaarheid: ${d.betrouwbaarheid}] ${d.ent}: ${d.info}. Journalistieke vraag: ${d.vraag}`;
    if (sigId) {
      await db.execute({ sql: "UPDATE signals SET crossref_briefing = COALESCE(crossref_briefing || char(10), '') || ?, crossref_score = COALESCE(crossref_score,0) + ?, crossref_checked = datetime('now') WHERE id = ?", args: [briefing, d.score, sigId] });
      await db.execute({ sql: "INSERT INTO signal_events (signal_id, actor, event_type, reason) VALUES (?, 'dwarsverbanden', 'crossref', ?)", args: [sigId, briefing.substring(0, 300)] });
      written++;
    }
  }
  console.log(`Weggeschreven naar signalen: ${written} (alleen middel/hoog + rolconflicten, alleen bij bestaand gekoppeld signaal).`);
}
main().catch(e => { console.error(e); process.exit(1); });
