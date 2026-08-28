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
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Hoe oud een item mag zijn en toch als vers signaal doorgaat. Vóór 2026-08-09
// stond hier 48 uur, gemeten vanaf het scrapemoment, en werd alles daarbuiten
// wéggegooid: 519 items zijn zo verdwenen zonder ooit een signaal te worden.
// Twee dingen zijn veranderd. De peildatum is nu de publicatiedatum van het
// document als die bekend is (kolom published_at, nog leeg — de scrapers moeten
// hem gaan vullen), anders het scrapemoment. En wat buiten het venster valt gaat
// niet meer de prullenbak in maar de historische route op: het wordt een signaal
// met status 'watching' en het label [HISTORISCH], zodat de weger het ziet.
// Tier 3 blijft wél afvallen als het oud is; dat is de bestaande regel hieronder.
const VERSHEID_DAGEN = Number(process.env.VERSHEID_DAGEN || 7);

// Woordoverlap mag geen bekendmaking aan een rechtspraakuitspraak knopen. Dat
// gebeurde structureel: vier meldingen "toepassen van grond of baggerspecie"
// hingen aan een uitspraak over proceskostenvergoeding, en een vergunning voor
// zeven appartementen aan de Langestraat hing aan een woning aan 't Zand.
// Gedeelde entiteiten mogen die grens wél oversteken — een persoon of adres dat
// in beide voorkomt is juist het interessante geval.
function bronwereld(naam) {
  const n = (naam || '').toLowerCase();
  if (n.includes('rechtspraak') || n.includes('raad van state')) return 'rechtspraak';
  if (n.includes('bekendmaking') || n.startsWith('ob —') || n.includes('gemeenteblad')
      || n.includes('provinciaal blad') || n.includes('waterschapsblad')
      || n.includes('verkeersbesluit') || n.includes('omgevingsvergunning')) return 'bekendmaking';
  if (n.includes('inspectie') || n.includes('nvwa') || n.includes('omgevingsdienst')
      || n.includes('lrk') || n.includes('toezicht')) return 'inspectie';
  return 'anders';
}

const STOPWOORDEN = new Set(['de','het','een','en','van','in','te','dat','is','op','aan','met','er','maar','om','dan','ook','door','als','bij','dit','zijn','uit','noch','naar','tot','onder','over','worden','heeft','was','voor','nog','wel','niet','meer','ook','zo','nu','al','elke','alle','elk','die','wat','wie','hoe','waar','wanneer','welke','hoeveel','waarom','echter','omdat','want','toch','ja','nee','hier','daar','deze','dit','die','dat','zo','zeer','veel','meer','minder','andere','ieder','iedere','voor','door','naar','zijn','werd','worden','heeft','hebben','kunnen','zal','zou','mogen','willen','gaan',
  // Gebiedsnamen en registerjargon (toegevoegd 2026-08-15): deze woorden staan
  // in vrijwel elke titel in deze database en verbinden daardoor alles met
  // alles — precies de clusterfouten uit de weger-runs van 13-15 augustus.
  'amersfoort','amersfoortse','leusden','leusdense','gemeente','gemeentelijke','besluit','aanvraag','bekendmaking','vergadering','agenda',
  // Bekendmakingen-registertaal (toegevoegd 2026-08-28): procedurele woorden
  // die in vrijwel elke vergunning/kennisgeving terugkomen en ongerelateerde
  // bekendmakingen aan elkaar koppelen via woordoverlap.
  'vergunning','omgevingsvergunning','verleende','verleend','ontvangen','perceel',
  'plaatsen','kappen','boom','bomen','slopen','realiseren','wijzigen','vervangen',
  'tijdelijk','gebruik','hoogte','container','steiger',
  'kennisgeving','ontvangst','beschikking','behandelen','intrekken','ingetrokken',
  'buiten','behandeling','laten','aangevraagd',
  // BRP-/registermeldingen (2026-08-28): voorkomen dat alle "Vertrokken met
  // onbekende bestemming"-items en "Beslistermijn verlengen"-items clusteren.
  'vertrokken','onbekende','bestemming','beslistermijn','verlengen','verlengd',
  'woning','dakvlak','dakkapel','voorgevel','achtergevel','gevel','dakterras',
  // Rechtspraak-procedurewoorden (2026-08-28)
  'verdachte','straf','taakstraf','geldboete','rijontzegging','voorwaardelijke',
  // Datum- en tijdwoorden (2026-08-28): maandnamen en jaarcijfers matchen
  // alle bekendmakingen uit dezelfde periode aan elkaar.
  'januari','februari','maart','april','juni','juli','augustus','september','oktober','november','december',
  '2024','2025','2026','2027','2028']);

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
  // Fix 2026-08-02 (n.a.v. #587: agendapunt gekoppeld aan motorrace-vergunning):
  // bij dunne titels/items is 2 gedeelde woorden te zwak — eis dan 3.
  const dun = sigTokens.size < 6 || itemTokens.size < 6;
  if (dun && common < 3) return 0;
  return common;
}

function extractEntities(item, personIndex = []) {
  const text = `${item.title || ''} ${item.summary || ''} ${(item.content || '').substring(0, 2000)}`;
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
    // Toegevoegd 2026-08-28: Amersfoortse organisaties die in de intake-audit
    // als ontbrekend zijn geïdentificeerd.
    { re: /\bflint\b/i, name: 'De Flint', normalized: 'de flint', type: 'organization' },
    { re: /\bsro\b/i, name: 'SRO Amersfoort', normalized: 'sro amersfoort', type: 'organization' },
    { re: /\bamfors\b/i, name: 'Amfors', normalized: 'amfors', type: 'organization' },
    { re: /\bomnia wonen\b/i, name: 'Omnia Wonen', normalized: 'omnia wonen', type: 'organization' },
    { re: /\beemland wonen\b/i, name: 'Eemland Wonen', normalized: 'eemland wonen', type: 'organization' },
    { re: /\binschool\b/i, name: 'Inschool', normalized: 'inschool', type: 'organization' },
    { re: /\bgg[dD]\s*(?:regio\s+)?utrecht\b/i, name: 'GGD regio Utrecht', normalized: 'ggd regio utrecht', type: 'organization' },
    { re: /\bkwintes\b/i, name: 'Kwintes', normalized: 'kwintes', type: 'organization' },
    { re: /\bamersfoort033\b/i, name: 'Amersfoort033', normalized: 'amersfoort033', type: 'organization' },
    { re: /\bbpa\b|\bberg(?:kwartier)?pad\b/i, name: 'BPA Bergkwartier', normalized: 'bpa bergkwartier', type: 'organization' },
  ];

  for (const p of patterns) {
    if (p.re.test(text)) {
      const match = p.re.exec(text);
      if (match) {
        entities.push({ type: p.type, name: p.name, normalized: p.normalized, context: text.substring(Math.max(0, match.index-20), match.index+60) });
      }
    }
  }

  // Adresherkenning (toegevoegd 2026-08-28): postcodes en straat+huisnummer
  // uit bekendmakingen-titels extraheren. Twee items met dezelfde postcode
  // of hetzelfde adres gaan over dezelfde locatie — entiteitsmatch voorkomt
  // dat ze via (nu weggefilterde) procedurewoorden aan verkeerde signalen
  // hangen.

  // Postcode: 4 cijfers + 2 letters (Nederlands formaat), genormaliseerd zonder spatie
  const pcRe = /\b(\d{4})\s*([A-Z]{2})\b/gi;
  while ((m = pcRe.exec(text)) !== null) {
    const pc = `${m[1]}${m[2].toUpperCase()}`;
    entities.push({ type: 'location', name: pc, normalized: `postcode:${pc.toLowerCase()}`, context: text.substring(Math.max(0, m.index-30), m.index+30) });
  }

  // Straatnaam + huisnummer uit "perceel Straat ##" of "hoogte van Straat ##" patronen
  const adresRe = /(?:perceel|hoogte van|locatie|adres)\s+([A-Z][a-zéèëïöüá]+(?:[\s-][a-z]*[A-Z]?[a-zéèëïöüá]+)*)\s+(\d+(?:\s*[A-Za-z])?)\b/g;
  while ((m = adresRe.exec(text)) !== null) {
    const straat = m[1].trim();
    const nr = m[2].trim().replace(/\s+/g, '');
    // Filter te korte straatnamen (waarschijnlijk geen echte straat)
    if (straat.length >= 4) {
      const adres = `${straat} ${nr}`;
      entities.push({ type: 'location', name: adres, normalized: `adres:${adres.toLowerCase()}`, context: text.substring(Math.max(0, m.index-10), m.index+60) });
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

  // Lockfile: voorkom dat twee gelijktijdige intake-runs dezelfde items verwerken.
  // fs.mkdirSync is atomair op alle OS'en — de eerste aanroep slaagt, de tweede faalt.
  const LOCKDIR = path.join(__dirname, '.intake-lock');
  try {
    fs.mkdirSync(LOCKDIR);
  } catch (lockErr) {
    if (lockErr.code === 'EEXIST') {
      // Controleer of de lock niet verouderd is (>15 minuten = stale lock)
      try {
        const lockAge = Date.now() - fs.statSync(LOCKDIR).mtimeMs;
        if (lockAge > 15 * 60 * 1000) {
          console.warn(`Stale lock gevonden (${Math.round(lockAge/60000)} min oud), wordt verwijderd`);
          fs.rmdirSync(LOCKDIR);
          fs.mkdirSync(LOCKDIR);
        } else {
          console.log('Andere intake-run is nog bezig — overgeslagen.');
          return;
        }
      } catch (_) {
        console.log('Andere intake-run is nog bezig — overgeslagen.');
        return;
      }
    } else throw lockErr;
  }
  // Zorg dat de lock altijd wordt opgeruimd
  const releaseLock = () => { try { fs.rmdirSync(LOCKDIR); } catch (_) {} };
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(1); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

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

    // Fix clustervervuiling (2026-08-23): entiteiten die in >8 signalen voorkomen
    // zijn te generiek om als matchbasis te dienen. Wethouders, de burgemeester en
    // organisaties als GGD/ODU staan in vrijwel elk bestuurlijk document — niet
    // omdat het document over hen gaat, maar omdat zij het ondertekenen of
    // behandelen. Die verbinden alles met alles: signaal 634 groeide zo van
    // "Coffeeshopbeleid" naar 64 items met verkeersbesluiten en rekenkamer-
    // onderzoeken. De drempel van 8 is conservatief: alleen entiteiten die
    // aantoonbaar ruis veroorzaken vallen eruit.
    const ruisRes = await db.execute(`
      SELECT e.normalized_name, e.entity_type
      FROM entities e JOIN entity_signals es ON es.entity_id = e.id
      GROUP BY e.normalized_name, e.entity_type
      HAVING COUNT(DISTINCT es.signal_id) > 8
    `);
    const RUIS_ENTITEITEN = new Set(
      ruisRes.rows.map(r => `${r.entity_type}:${r.normalized_name}`)
    );
    // 'gemeente amersfoort' zat al hardcoded op regel 339; nu in dezelfde set
    RUIS_ENTITEITEN.add('organization:gemeente amersfoort');
    console.log(`${RUIS_ENTITEITEN.size} ruis-entiteiten uitgefilterd: ${[...RUIS_ENTITEITEN].join(', ')}`);

    const itemsResult = await db.execute(`
      SELECT r.id, r.title, r.content, r.summary, r.external_url, r.scraped_at, r.is_historical,
             r.published_at,
             s.name as source_name, s.reliability, s.category, s.tier, s.bronrol, s.id as source_id
      FROM raw_items r JOIN sources s ON r.source_id = s.id
      WHERE r.is_processed = 0
      ORDER BY r.is_historical ASC, r.scraped_at ASC
      LIMIT 1000
    `);
    const items = itemsResult.rows;
    itemsInCount = items.length;
    console.log(`${items.length} onverwerkte items gevonden`);

    if (items.length === 0) {
      console.log('Niets te verwerken.');
      await finishIntakeRun(runId, startedAt, countsFromStats(), 'ok', null);
      // Geen process.exit(0) hier: een harde exit terwijl de libsql-client nog
      // een open handle heeft laat Node op Windows afbreken met een assertion en
      // een exitcode van -1073740791. PM2 leest dat als een crash. Gewoon
      // terugkeren; Node eindigt vanzelf zodra de client dicht is.
      return;
    }

    const signalsResult = await db.execute(`
      SELECT id, title, summary, confirmations, threshold, status
      FROM signals WHERE status NOT IN ('published', 'discarded')
    `);
    const activeSignals = signalsResult.rows;

    const allTitlesResult = await db.execute(`SELECT title FROM signals`);
    const allSignalTitles = new Set(allTitlesResult.rows.map(r => (r.title || '').toLowerCase().trim()));

    // Entity-gebaseerde matching (P1, 2026-08-02): per actief signaal de set entiteiten
    // (personen/organisaties/adressen tellen zwaar; locaties licht). Items zijn vóór intake
    // al gescand door extract-entities.cjs (draait in de run-files).
    const sigEnt = new Map(); // signal_id -> {strong:Set, loc:Set}
    const entRows = await db.execute(`
      SELECT si.signal_id, e.entity_type, e.normalized_name
      FROM signal_items si JOIN entities e ON e.raw_item_id = si.raw_item_id
      WHERE e.entity_type IN ('person','organization','address','location')
    `);
    for (const r of entRows.rows) {
      if (!sigEnt.has(r.signal_id)) sigEnt.set(r.signal_id, { strong: new Set(), loc: new Set() });
      const b = sigEnt.get(r.signal_id);
      (r.entity_type === 'location' ? b.loc : b.strong).add(r.normalized_name);
    }

    // Per signaal: uit welke bronwerelden het is opgebouwd. Nodig om te voorkomen
    // dat woordoverlap een bekendmaking aan een rechtspraakuitspraak knoopt.
    const sigWerelden = new Map(); // signal_id -> Set('bekendmaking'|'rechtspraak'|'anders')
    const wereldRows = await db.execute(`
      SELECT si.signal_id, s.name AS source_name
      FROM signal_items si
      JOIN raw_items r ON r.id = si.raw_item_id
      JOIN sources s ON s.id = r.source_id
    `);
    for (const r of wereldRows.rows) {
      if (!sigWerelden.has(r.signal_id)) sigWerelden.set(r.signal_id, new Set());
      sigWerelden.get(r.signal_id).add(bronwereld(r.source_name));
    }
    // Botsen twee specifieke werelden, dan is woordoverlap geen bewijs van samenhang.
    function wereldenBotsen(itemWereld, signalId) {
      if (itemWereld === 'anders') return false;
      const w = sigWerelden.get(signalId);
      if (!w || w.size === 0) return false;
      const specifiek = [...w].filter(x => x !== 'anders');
      if (specifiek.length === 0) return false;
      return !specifiek.includes(itemWereld);
    }
    async function entityMatchSignal(itemId) {
      const ie = await db.execute({ sql: `SELECT entity_type, normalized_name FROM entities WHERE raw_item_id = ?`, args: [itemId] });
      if (!ie.rows.length) return null;
      const iStrong = new Set(), iLoc = new Set();
      for (const r of ie.rows) (r.entity_type === 'location' ? iLoc : iStrong).add(r.normalized_name);
      // Filter ruis-entiteiten: te generiek om als matchbasis te dienen.
      // Was alleen 'gemeente amersfoort'; nu alle entiteiten die in >8 signalen
      // voorkomen (burgemeester, wethouders, GGD, ODU, etc.).
      for (const e of [...iStrong]) {
        const key = `person:${e}`;
        const key2 = `organization:${e}`;
        if (RUIS_ENTITEITEN.has(key) || RUIS_ENTITEITEN.has(key2)) iStrong.delete(e);
      }
      // Filter ook ruis-locaties (bijv. "Soesterkwartier" in 19 signalen, "Isselt" in 14)
      for (const e of [...iLoc]) {
        if (RUIS_ENTITEITEN.has(`location:${e}`)) iLoc.delete(e);
      }
      let best = null, bestN = 0;
      for (const sig of activeSignals) {
        const b = sigEnt.get(sig.id);
        if (!b) continue;
        let n = 0;
        // Tel alleen niet-ruis-entiteiten aan de signaal-kant
        for (const e of iStrong) {
          if (b.strong.has(e) && !RUIS_ENTITEITEN.has(`person:${e}`) && !RUIS_ENTITEITEN.has(`organization:${e}`)) n += 2;
        }
        let locN = 0;
        for (const e of iLoc) if (b.loc.has(e)) locN++;
        if (locN >= 3) n += 2; // ≥3 gedeelde locaties telt als één sterke match (verhoogd van 2, bevinding #5)
        if (n >= 2 && n > bestN) { bestN = n; best = sig; }
      }
      return best ? { sig: best, n: bestN } : null;
    }


    // URL-duplicaatdetectie: items met een external_url die al eerder verwerkt
    // is (is_processed = 1) overslaan. Voorkomt dat dezelfde pagina bij
    // meerdere scrape-runs opnieuw een signaal aanmaakt of bijwerkt.
    const bekendUrls = new Set();
    const urlItems = items.filter(it => it.external_url);
    if (urlItems.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < urlItems.length; i += BATCH) {
        const batch = urlItems.slice(i, i + BATCH);
        const placeholders = batch.map(() => '?').join(',');
        const res = await db.execute({
          sql: `SELECT DISTINCT external_url FROM raw_items WHERE external_url IN (${placeholders}) AND is_processed = 1`,
          args: batch.map(it => it.external_url),
        });
        for (const r of res.rows) bekendUrls.add(r.external_url);
      }
      if (bekendUrls.size > 0) console.log(`${bekendUrls.size} URLs al eerder verwerkt (duplicaatdetectie)`);
    }
    for (const item of items) {
      const tier = item.tier || 2;

      // Peildatum: publicatiedatum van het document als die er is, anders het
      // scrapemoment. Wat buiten het versheidsvenster valt wordt niet weggegooid
      // maar als historisch behandeld — zie de toelichting bij VERSHEID_DAGEN.
      const peildatum = item.published_at || item.scraped_at;
      const leeftijdDagen = (Date.now() - new Date(peildatum).getTime()) / 86400000;
      const verouderd = Number.isFinite(leeftijdDagen) && leeftijdDagen > VERSHEID_DAGEN;
      const isHist = item.is_historical === 1 || verouderd;

      // Filters
      if (!item.title && !item.content) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'leeg item zonder titel of inhoud'));
        continue;
      }
      // URL-duplicaat: dit item heeft dezelfde external_url als een eerder
      // verwerkt item — overslaan om dubbele signalen te voorkomen.
      if (item.external_url && bekendUrls.has(item.external_url)) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', `URL-duplicaat: ${item.external_url} is al eerder verwerkt`));
        continue;
      }
      if (item.source_name && item.source_name.toLowerCase().includes('rechtspraak') && !item.content) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'rechtspraak-item zonder uitspraaktekst'));
        continue;
      }
      if (isHist && tier >= 3) {
        stats.gefilterd++; stats.ids.push(item.id);
        const waarom = verouderd && item.is_historical !== 1
          ? `tier 3-item ouder dan ${VERSHEID_DAGEN} dagen (${Math.round(leeftijdDagen)} dagen), alleen bruikbaar als context`
          : 'historisch item uit tier 3-bron, alleen gebruikt als context';
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', waarom));
        continue;
      }

      // Registerruis: BAG-panden met de status "Pand in gebruik" zijn automatische
      // registratiemutaties zonder gebeurtenis erachter. Op 4 augustus 2026 leverden
      // die in één dag 36 nieuwe signalen op, die allemaal zijn afgekeurd.
      // Panden met een ándere status blijven wel door: bouw gestart, sloopvergunning
      // verleend of pand gesloopt zijn wél gebeurtenissen.
      if (item.source_name === 'PDOK BAG Amersfoort'
          && /(?:Status:\s*)?Pand in gebruik/i.test(`${item.title} ${item.content || ''}`)) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'BAG-pandregistratie met status "Pand in gebruik": registermutatie, geen gebeurtenis'));
        continue;
      }

      // Doorgeplaatste advertenties op Nextdoor zijn geen buurtnieuws. Het
      // €-trefwoord in de opvallend-regex verderop maakte er signalen van
      // ("4 Efteling kaarten te koop" werd signaal #1023) en de weger voerde er
      // van 10 t/m 15 augustus elke run een paar af. Marktplaats-links en
      // te-koop-taal gaan er hier uit; de reden staat per item in
      // intake_decisions, dus niets is onvindbaar kwijt.
      if (item.source_name && item.source_name.toLowerCase().includes('nextdoor')) {
        const advertentie =
          /marktplaats\.nl/i.test(`${item.content || ''} ${item.external_url || ''}`)
          || /\bte koop\b|\bgratis af te halen\b|\bgezocht:|\baangeboden\b|€\s?\d/i.test(`${item.title || ''} ${item.summary || ''}`);
        if (advertentie) {
          stats.gefilterd++; stats.ids.push(item.id);
          await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'Nextdoor-advertentie (Marktplaats-link of te-koop-taal), geen buurtnieuws'));
          continue;
        }
      }

      // Spiegelbronnen (Nieuwsplein33 en zijn partners) zijn geen signaalbron
      // maar een context- en ontdubbelingsbron (NIEUWSPLEIN33.md §5). Tot
      // 15 augustus werden hun items via woordoverlap in bestaande clusters
      // geschoven; clusters dreven daardoor van hun onderwerp weg (signaal 540
      // begon bij het Sovjet Ereveld en eindigde bij ijssalons en wespen) en
      // hun last_seen_at werd elke dag ververst zonder dat er iets gebeurde,
      // waardoor de weger ze telkens opnieuw voorgeschoteld kreeg. Nu: alleen
      // koppelen bij een entiteitsmatch, als bevestiging zonder last_seen_at
      // te verversen; zonder match blijft het item naslag voor de spiegelcheck.
      if (item.bronrol === 'spiegel') {
        const sm = await entityMatchSignal(item.id);
        if (sm) {
          await db.execute({ sql: `UPDATE signals SET confirmations = confirmations + 1 WHERE id = ?`, args: [sm.sig.id] });
          await db.execute({ sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`, args: [sm.sig.id, item.id] });
          sm.sig.confirmations = (sm.sig.confirmations || 0) + 1;
          stats.bijgewerktSignaal++; stats.verwerkt++; stats.ids.push(item.id);
          console.log(`  SPIEGEL [T${tier}] "${(item.title||'').substring(0,50)}" → #${sm.sig.id} (entiteiten:${sm.n})`);
          await decisionBatcher.push(decisionStmt(runId, item, tier, 'matched', `spiegelbevestiging op gedeelde entiteiten voor signaal #${sm.sig.id}; last_seen_at bewust niet ververst`, { signal_id: sm.sig.id, match_score: sm.n }));
          await eventBatcher.push(eventStmt(sm.sig.id, 'confirmed', { reason: `spiegelbron ${item.source_name || 'onbekend'} raakt dit onderwerp — bevestiging, geen nieuw materiaal` }));
        } else {
          stats.gefilterd++; stats.ids.push(item.id);
          await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'spiegelbron: geen eigen signaal — alleen naslag voor ontdubbeling en bevestiging'));
        }
        continue;
      }

      // Omnibus-documenten: B&W-besluitenlijsten en raadsvergadering-
      // besluitenlijsten bevatten 10-20 ongerelateerde onderwerpen in één stuk.
      // Entity-matching werkt hier niet: zelfs na ruisfiltering matchen 4-22
      // entiteiten uit verschillende agendapunten, waardoor signalen onterecht
      // opblazen (signaal #634 kreeg 68 bevestigingen van ongerelateerde B&W-
      // besluiten). Tot de besluitenlijsten gesplitst worden in losse
      // agendapunten vóór de intake, worden ze volledig gefilterd.
      const isOmnibus = item.source_name && (
        item.source_name.toLowerCase().includes('b&w besluitenlijst')
        || item.source_name.toLowerCase().includes('b&w-besluitenlijst')
        || item.source_name.toLowerCase().includes('besluitenlijst college')
      ) || /\bbesluitenlijst\b/i.test(item.title || '');
      if (isOmnibus) {
        stats.gefilterd++; stats.ids.push(item.id);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'filtered', 'omnibus-document (besluitenlijst): bevat meerdere ongerelateerde besluiten, pas bruikbaar na splitsing in losse agendapunten'));
        continue;
      }

      // Het 48-uursfilter dat hier stond is op 2026-08-09 verwijderd. Oude items
      // worden nu hierboven als historisch aangemerkt in plaats van weggegooid.

      // Signaalmatching — primair op gedeelde entiteiten (P1), woordoverlap als fallback
      let bestMatch = null, bestScore = 0, matchBasis = 'woorden';
      const em = await entityMatchSignal(item.id);
      if (em) {
        bestMatch = em.sig; bestScore = em.n; matchBasis = 'entiteiten';
      } else {
        const itemWereld = bronwereld(item.source_name);
        for (const sig of activeSignals) {
          if (wereldenBotsen(itemWereld, sig.id)) continue;
          const score = matchScore(item, sig);
          // Drempel op 3 sinds 2026-08-15. Twee gedeelde woorden bleek opnieuw
          // over-matchend (de les van juni herhaalde zich): signaal 1051 kreeg
          // BRP-uitschrijvingen bij een gunning, 1041 meldkamerberichten bij een
          // ECLI, 1067 advertenties bij een steigervergunning. Entiteitsmatching
          // hierboven is de bedoelde route; woordoverlap is alleen nog vangnet.
          if (score >= 3 && score > bestScore) { bestScore = score; bestMatch = sig; }
        }
      }
      // Bescherming: signalen met al veel items niet verder voeden.
      // Tot 2026-08-23 gold dit alleen voor woordoverlap; entity-matches passeerden
      // ongehinderd, waardoor signaal #634 tot 64 items groeide. Nu: cap op beide
      // matchtypen, met een iets hogere grens voor entiteiten (die zijn betrouwbaarder
      // dan woordoverlap, maar een signaal met >15 items is per definitie verdacht).
      if (bestMatch) {
        const cap = matchBasis === 'entiteiten' ? 15 : 10;
        if ((bestMatch.confirmations || 0) > cap) {
          console.log(`  CAP [${matchBasis}] "${(item.title||'').substring(0,50)}" niet gekoppeld aan #${bestMatch.id} (${bestMatch.confirmations} confirmaties > cap ${cap})`);
          bestMatch = null; bestScore = 0;
        }
      }

      if (bestMatch) {
        await db.execute({ sql: `UPDATE signals SET confirmations = confirmations + 1, last_seen_at = datetime('now') WHERE id = ?`, args: [bestMatch.id] });
        await db.execute({ sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`, args: [bestMatch.id, item.id] });
        bestMatch.confirmations = (bestMatch.confirmations || 0) + 1;
        if (!sigWerelden.has(bestMatch.id)) sigWerelden.set(bestMatch.id, new Set());
        sigWerelden.get(bestMatch.id).add(bronwereld(item.source_name));
        stats.bijgewerktSignaal++;
        console.log(`  MATCH [T${tier}] "${(item.title||'').substring(0,50)}" → #${bestMatch.id} (score:${bestScore})`);
        await decisionBatcher.push(decisionStmt(runId, item, tier, 'matched', `gekoppeld aan signaal #${bestMatch.id} (basis: ${matchBasis}, score ${bestScore})`, { signal_id: bestMatch.id, match_score: bestScore, match_basis: matchBasis }));
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

        // Drempel 1 sinds 2026-08-09. De drempel van 3 stamt uit de tijd dat er geen
        // weger was en er iets moest voorkomen dat de stapel te groot werd. De weger
        // leest sinds 8 augustus dagelijks álles wat open staat, dus de drempel hield
        // niets meer tegen: 594 van de 854 signalen bleven op één bevestiging staan.
        // `confirmations` blijft gewoon doortellen en is voor de weger een aanwijzing
        // dat er iets speelt — het is alleen geen poort meer.
        let newId;
        if (isHist) {
          const res = await db.execute({ sql: `INSERT INTO signals (title, summary, status, confirmations, threshold, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 1, ?, ?) RETURNING id`, args: [(item.title||'(geen titel)'), summary, status, peildatum, peildatum] });
          newId = res.rows[0]?.id;
        } else {
          const res = await db.execute({ sql: `INSERT INTO signals (title, summary, status, confirmations, threshold, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 1, datetime('now'), datetime('now')) RETURNING id`, args: [(item.title||'(geen titel)'), summary, status] });
          newId = res.rows[0]?.id;
        }

        if (newId) {
          await db.execute({ sql: `INSERT OR IGNORE INTO signal_items (signal_id, raw_item_id) VALUES (?, ?)`, args: [newId, item.id] });
          activeSignals.push({ id: newId, title: item.title, summary, confirmations: 1, threshold: 1, status });
          // Nieuw signaal ook meteen in de wereldenkaart, anders kan een volgend item
          // in dezelfde run er alsnog dwars overheen matchen.
          sigWerelden.set(newId, new Set([bronwereld(item.source_name)]));
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

    // Entiteiten (primary/secondary) — vóór is_processed = 1, zodat bij een
    // crash halverwege de entiteitsextractie de items opnieuw worden aangeboden.
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
        } catch (entErr) { console.warn(`Entiteit-opslag mislukt voor item ${item.id}: ${entErr.message}`); }
      }
      if (ents.length > 0) {
        await entityUpdateBatcher.push({
          sql: `UPDATE intake_decisions SET entities_found = ? WHERE intake_run_id = ? AND raw_item_id = ?`,
          args: [JSON.stringify(ents), runId, item.id],
        });
      }
    }

    // Markeer verwerkt — bewust ná de entiteitsextractie, zodat bij een crash
    // halverwege items opnieuw worden aangeboden en hun entiteiten niet missen.
    for (let i = 0; i < stats.ids.length; i += 50) {
      const chunk = stats.ids.slice(i, i+50);
      const ph = chunk.map(() => '?').join(',');
      await db.execute({ sql: `UPDATE raw_items SET is_processed = 1 WHERE id IN (${ph})`, args: chunk });
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
    process.exitCode = 1;
  }
}

run().catch(e => {
  // Val hier alleen in als er niet eens een intake_runs-rij kon worden aangemaakt
  // (bijv. DB niet bereikbaar) — de rest van de fouten wordt al binnen run() afgehandeld.
  console.error('FOUT: intake-run kon niet starten:', e.message);
  process.exitCode = 1;
});
