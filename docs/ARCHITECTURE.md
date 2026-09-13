# Architectuur

**Doel:** technische kaart van de actieve keten.
**Status:** actueel op hoofdlijnen per 13 september 2026.
**Lees wanneer:** bij frontend-, scraper-, database- of detectiewerk.

## Uitvoeringsomgeving

- Next.js/TypeScript-dashboard in `src/`, gedeployed via Vercel vanaf `main`.
- Node-scrapers en verwerkingsjobs in `scraper/` op een Windows-notebook.
- PM2 beheert periodieke scraper- en intakeprocessen; Windows Taakplanner start
  de zelfstandige detectierun en de vijftienminuten-NDW-run.
- Turso/libsql is de gedeelde productiedatabase.
- Lokale geheimen staan in genegeerde `.env`-bestanden en Vercel-variabelen.

## Gegevensstroom

1. Klassieke scrapers schrijven documenten naar `raw_items` en registreren runs.
2. Intake filtert en clustert bronitems tot `signals`, met `signal_items`,
   `intake_decisions`, `intake_runs` en `signal_events` als verantwoording.
3. De kennisgraaflaag bewaart entiteiten, aliassen, identifiers, locaties,
   relaties, bronrecords en events.
4. Adapters onder `scraper/src/kg/adapters/` volgen registers en datasets via
   baselines en semantische diffs.
5. `detection-run.cjs` orkestreert adapters en regels. `detection-engine.cjs`
   maakt exact-once signalen; bruikbare detecties krijgen ook een primair
   `raw_item` en `signal_items`-koppeling voor de weger.
6. De weger beoordeelt alleen nieuwe signalen of signalen met inhoudelijk nieuw
   materiaal. De uitvoer gaat naar `tips`, `tip_signals`, `tip_events`,
   `dossiers` en `dossier_facts`.
7. Het dashboard leest de productiedata. `LOGBOEK.md` wordt bij de Vercel-build
   meegeleverd als redactioneel productlogboek.

## Belangrijke grenzen

- Een baseline is opslag, geen nieuwsgebeurtenis.
- Ontbreken in een periodiek bestand is niet automatisch sluiting of verwijdering.
- Lokale relevantie loopt waar mogelijk via gekoppelde entiteiten en locaties,
  niet via een losse plaatsnaam in tekst.
- Een event of signaal moet provenance naar officiële bron of bronrecord hebben.
- Spiegelbronnen bevestigen of ontdubbelen, maar dragen geen tip.

## Schema en migraties

Schemawijzigingen zijn bij voorkeur additief, zodat de klassieke keten tijdens
de overgang blijft werken. `scraper/migrate-kg-m1m2m3.cjs` en
`scraper/migrate-kg-m4-seed.cjs` leggen het uitgevoerde KG-fundament vast. De
actuele database en migratiecode zijn gezaghebbend; voer SQL uit oude plannen
niet rechtstreeks uit. Controleer vóór schemawerk de productieversie en maak
een gerichte herstel- of voorwaartse migratie in plaats van tabellen generiek te
verwijderen.

De kern bestaat uit `kg_entities`, identifiers, aliassen, locaties, relaties,
events, `source_records`, `fetch_runs` en de handmatige mergewachtrij. De
klassieke tabellen blijven daarnaast bestaan zolang intake en KG-detectie
afzonderlijke productiepaden zijn.

`scraper/migrate-phase3.cjs` voegt broncontrolevelden en de tabellen
`source_snapshots`, `statistical_baselines`, `area_versions` en
`phase3_backtests` idempotent toe. Grote ruwe responses staan gecomprimeerd en
genegeerd onder `scraper/data/phase3-snapshots/`; de database bewaart hash,
media-type, omvang en opslagpad. Politiecorrecties krijgen een nieuwe
`source_records`-versie, nooit een stille overschrijving.

Fase-3-adapters delen `phase3-core.cjs`: canonieke semantische hashing,
schema-/volumecontrole, retry met backoff, bronmetadata, baseline, semantische
diff en tweerunsbevestiging voor verwijderingen. Een herstelde tijdelijke
afwezigheid maakt geen event. Feed-events gebruiken officiële identifiers voor
exact-once signalen en een afzonderlijk bewijsrecord per identifier.

## Entity-resolutiecontract

De actuele implementatie staat in `scraper/src/kg/entity-resolver.cjs`. Sterke
identifiers wegen 100 punten, website 45, BAG-adres 40, exacte naam 35,
genormaliseerde naam 25, gedeelde bestuurder 20, postcode/huisnummer 15 en
werkgebied 10. Vanaf 90 volgt automatisch samenvoegen, 70–89 vereist review en
onder 70 volgt geen merge. Personen vereisen minimaal 110 punten en worden dus
nooit uitsluitend op naam automatisch samengevoegd.

## Belangrijkste codegebieden

| Gebied | Locatie |
|---|---|
| Dashboardroutes | `src/app/nieuwsplein33/` |
| Dashboardqueries | `src/lib/dashboard/` |
| Klassieke intake | `scraper/intake-run.mjs` |
| KG-adapters | `scraper/src/kg/adapters/` |
| Detectieorkestratie | `scraper/src/kg/detection-run.cjs` |
| Detectieregels | `scraper/src/kg/detection-rules.cjs` |
| Entity resolution | `scraper/src/kg/entity-resolver.cjs` |
| Uitgevoerde KG-migraties | `scraper/migrate-kg-m1m2m3.cjs`, `scraper/migrate-kg-m4-seed.cjs` |
| Fase-3-migratie en gedeelde diff | `scraper/migrate-phase3.cjs`, `scraper/src/kg/phase3-core.cjs` |
| Fase-3-audit en backtest | `scraper/audit-phase3.cjs`, `scraper/backtest-phase3.cjs` |
| NDW-taak | `scraper/run-ndw-task.ps1` |
| Tests en fixtures | `scraper/__tests__/` |

Exacte schema-aannames moeten altijd tegen migraties en de actuele database
worden gecontroleerd; oude plannen zijn hiervoor geen gezaghebbende bron.
