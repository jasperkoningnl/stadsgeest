// Dossierlaag (2026-08-02, n.a.v. journalistieke vergelijking Nieuwsplein33/Stadsgeest).
// Persistent feitenregister per terugkerend onderwerp, zodat artikelen niet steeds
// opnieuw uit losse zoekresultaten worden opgebouwd en eerdere feiten niet verdwijnen.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

(async () => {
  await db.execute(`CREATE TABLE IF NOT EXISTS dossiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    trefwoorden TEXT NOT NULL, -- komma-gescheiden, voor matching door routines
    omschrijving TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS dossier_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
    fact_type TEXT NOT NULL CHECK(fact_type IN ('incident','besluit','bedrag','contract','subsidie','claim','plan','realisatie','maatregel','correctie','overig')),
    datum TEXT,               -- datum van het feit zelf (niet van registratie)
    locatie TEXT,
    titel TEXT NOT NULL,      -- één zin: wat is het feit
    details TEXT,             -- gestructureerde toelichting
    classificatie TEXT,       -- bv. 'vermoedelijk opzettelijk', 'niet-crimineel', 'theoretische potentie', 'gerealiseerd'
    zekerheid TEXT NOT NULL DEFAULT 'bevestigd' CHECK(zekerheid IN ('bevestigd','officieel','claim_belanghebbende','verwachting','theoretisch','onbevestigd','betwist')),
    primaire_bron_url TEXT,
    secundaire_bronnen TEXT,  -- JSON-array van URLs
    signal_id INTEGER,
    article_slug TEXT,        -- Stadsgeest-artikel waarin dit feit is gepubliceerd
    tegenstrijdigheid TEXT,   -- expliciet: welke bron zegt iets anders (bv. locatie Vollenhovekade vs Wieringenpad)
    superseded_by INTEGER REFERENCES dossier_facts(id), -- correctie/actualisering; oude feit blijft staan
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    actor TEXT                -- welke routine dit feit toevoegde
  )`);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_df_dossier ON dossier_facts(dossier_id, datum)");

  const seed = [
    ['Explosies Amersfoort', 'explosies-amersfoort', 'explosie,ontploffing,aanslag,vuurwerkbom,narcisstraat,sprengenberg,wieringenpad', 'Reeks (vermoedelijk criminele) explosies sinds begin 2026. LET OP: classificatie per incident vastleggen — de dodelijke gasexplosie Everard Meysterweg is waarschijnlijk NIET crimineel en telt niet mee in de criminele reeks. Locatie explosie eind juni is betwist (Vollenhovekade vs Wieringenpad).'],
    ['Warmtenet en biomassa', 'warmtenet-biomassa', 'warmtenet,biomassa,houtstook,eemwarmte,ennatuurlijk,aquathermie,rioolwaterzuivering,isselt,warmtebron', 'Warmtenet Amersfoort (13 wijken, 10.800 beoogd, ca. 2.200 aangesloten apr 2025). Kernonderscheid plan/potentie/realisatie: aquathermie-potentieel 7.700 woningen is THEORETISCH. Relevante factoren uit bronnen: max €68 mln subsidie, alternatieven jaren weg, duurzaamheidsafspraken juridisch niet afdwingbaar.'],
    ['Droogte en waterbeheer', 'droogte-waterbeheer', 'droogte,watertekort,blauwalg,natuurbrand,hitteplan,grondwater,beken,waterschap', 'Droogte 2026. LET OP causaliteit: watertekort (bestuurlijke classificatie), drooggevallen beken (fysiek gevolg), blauwalg (meerdere factoren) en hitteplan (gezondheidsmaatregel) zijn verschillende categorieën — niet als één causale reeks presenteren. Natuurbrandrisico niet vergeten.'],
    ['Woningbouw en wonen', 'woningbouw-wonen', 'woningbouw,nieuwbouw,vathorst,bovenduist,opkoopbescherming,starterslening,corporatie,huurwoning', 'Woningbouwprojecten, woonbeleid, corporaties.'],
    ['Lokale politiek en college', 'lokale-politiek', 'college,coalitie,wethouder,raadsbesluit,motie,coalitieakkoord', 'College per 8 juli 2026 (PRO/KeiHart/D66/VVD/CDA). Besluiten vóór 7 juli = oude college — toeschrijving checken.'],
  ];
  for (const [naam, slug, tw, oms] of seed) {
    await db.execute({ sql: "INSERT OR IGNORE INTO dossiers (naam, slug, trefwoorden, omschrijving) VALUES (?,?,?,?)", args: [naam, slug, tw, oms] });
  }
  const n = await db.execute("SELECT COUNT(*) n FROM dossiers");
  console.log('Dossiers aanwezig:', JSON.stringify(n.rows));
})().catch(e => { console.error(e); process.exit(1); });
