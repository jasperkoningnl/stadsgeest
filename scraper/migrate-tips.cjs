// Tiplaag (2026-08-07). De weegroutine schrijft hier naartoe; het redactiedashboard
// leest en schrijft hier. Signalen blijven de ruwe laag — een tip verwijst naar een
// of meer signalen en heeft een eigen levensloop, score en redactieoordeel.
//
// Idempotent: CREATE TABLE IF NOT EXISTS. Draaien met:
//   node scraper/migrate-tips.cjs
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

(async () => {
  // ─── tips ───────────────────────────────────────────────────────────────
  // status-levensloop:
  //   wachtrij → goedgekeurd → in_behandeling → gepubliceerd | niet_gebruikt
  //   wachtrij → geparkeerd → (terug naar wachtrij, of afgekeurd)
  //   wachtrij → afgekeurd
  await db.execute(`CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titel TEXT NOT NULL,                 -- de ene regel in de wachtrij
    kern TEXT NOT NULL,                  -- het verhaal in één zin, max 30 woorden
    briefing TEXT,                       -- uitgebreide beschrijving, zichtbaar na goedkeuren
    vervolgvragen TEXT,                  -- JSON-array van onderzoeksvragen
    soort TEXT NOT NULL CHECK(soort IN ('nieuwsfeit','patroon','verdieping','dossiersignaal')),
    gemeente TEXT NOT NULL DEFAULT 'Amersfoort',   -- Amersfoort | Leusden | regio
    categorie TEXT,                      -- bestuur, veiligheid, wonen, zorg, milieu, economie, onderwijs, cultuur, overig
    score INTEGER NOT NULL,
    score_motivatie TEXT NOT NULL,       -- in gewone taal, gericht aan een redacteur
    weging TEXT,                         -- JSON: per criterium de toegekende punten
    herkomst TEXT,                       -- JSON: welke bronnen dragend zijn, met tier
    elders_gebracht TEXT,                -- JSON-array {medium, url, datum}
    toegevoegde_waarde TEXT,             -- verplicht als elders_gebracht gevuld is
    dossier_id INTEGER REFERENCES dossiers(id),
    status TEXT NOT NULL DEFAULT 'wachtrij'
      CHECK(status IN ('wachtrij','goedgekeurd','in_behandeling','gepubliceerd','niet_gebruikt','geparkeerd','afgekeurd')),
    artikel_url TEXT,                    -- meetknop: het artikel op nieuwsplein33.nl
    eigen_vondst INTEGER,                -- meetknop: 1 = zonder Stadsgeest niet gevonden
    actor TEXT NOT NULL,                 -- welke routine deze tip maakte
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_tips_status ON tips(status, score DESC)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_tips_dossier ON tips(dossier_id)");

  // ─── koppeling tip ↔ signaal (een tip bundelt een of meer signalen) ──────
  await db.execute(`CREATE TABLE IF NOT EXISTS tip_signals (
    tip_id INTEGER NOT NULL REFERENCES tips(id),
    signal_id INTEGER NOT NULL,
    rol TEXT NOT NULL DEFAULT 'dragend' CHECK(rol IN ('dragend','bevestigend','context')),
    PRIMARY KEY (tip_id, signal_id)
  )`);

  // ─── redactiefeedback, append-only: nooit overschrijven ──────────────────
  await db.execute(`CREATE TABLE IF NOT EXISTS tip_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip_id INTEGER NOT NULL REFERENCES tips(id),
    gebruiker TEXT NOT NULL,
    actie TEXT NOT NULL CHECK(actie IN ('goedgekeurd','geparkeerd','afgekeurd','heropend','gepubliceerd','niet_gebruikt','opmerking')),
    reden_code TEXT,                     -- vaste keuze uit het dashboard
    reden_tekst TEXT,                    -- vrije toelichting
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_tipfb_tip ON tip_feedback(tip_id, created_at)");

  // ─── tijdlijn per tip, gelijk aan signal_events maar voor de tiplaag ─────
  await db.execute(`CREATE TABLE IF NOT EXISTS tip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip_id INTEGER NOT NULL REFERENCES tips(id),
    actor TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status_from TEXT,
    status_to TEXT,
    reason TEXT,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_tipev_tip ON tip_events(tip_id, created_at)");

  // ─── bronrol: hoe een bron in de weging meetelt ──────────────────────────
  // 'spiegel' = media die Nieuwsplein33 al heeft (eigen site en partners):
  // nooit dragend, wel bruikbaar voor ontdubbeling, verdieping en dossieropbouw.
  const cols = await db.execute("PRAGMA table_info(sources)");
  const heeft = (n) => cols.rows.some(r => r.name === n);
  if (!heeft('bronrol')) {
    await db.execute("ALTER TABLE sources ADD COLUMN bronrol TEXT");
  }
  if (!heeft('gemeente')) {
    await db.execute("ALTER TABLE sources ADD COLUMN gemeente TEXT");
  }

  // Spiegelbronnen aanmerken: Nieuwsplein33 zelf en de partners die zij op hun
  // over-ons noemen, plus amersfoort.nieuws.nl. Zie documentatie\NIEUWSPLEIN33.md.
  const spiegels = [
    'nieuwsplein33', 'de stad amersfoort', 'destadamersfoort', 'leusder krant',
    'eemland1', 'stadsbron', 'rtv utrecht', 'rtvutrecht', 'golfbreker',
    'bibliotheek eemland', 'amersfoort.nieuws.nl', 'amersfoort nieuws',
  ];
  let gemarkeerd = 0;
  for (const s of spiegels) {
    const r = await db.execute({
      sql: "UPDATE sources SET bronrol = 'spiegel' WHERE lower(name) LIKE ? AND (bronrol IS NULL OR bronrol != 'spiegel')",
      args: [`%${s}%`],
    });
    gemarkeerd += r.rowsAffected || 0;
  }

  const tel = async (t) => (await db.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n;
  const spiegelNamen = await db.execute("SELECT name, tier FROM sources WHERE bronrol = 'spiegel' ORDER BY name");
  console.log('tips:', await tel('tips'), '| tip_signals:', await tel('tip_signals'),
              '| tip_feedback:', await tel('tip_feedback'), '| tip_events:', await tel('tip_events'));
  console.log(`Spiegelbronnen gemarkeerd deze run: ${gemarkeerd}. Totaal nu ${spiegelNamen.rows.length}:`);
  for (const r of spiegelNamen.rows) console.log(`  - ${r.name} (tier ${r.tier ?? '?'})`);
})().catch(e => { console.error(e); process.exit(1); });
