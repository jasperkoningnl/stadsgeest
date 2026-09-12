# Architectuur

**Doel:** technische kaart van de actieve keten.
**Status:** actueel op hoofdlijnen per 12 september 2026.
**Lees wanneer:** bij frontend-, scraper-, database- of detectiewerk.

## Uitvoeringsomgeving

- Next.js/TypeScript-dashboard in `src/`, gedeployed via Vercel vanaf `main`.
- Node-scrapers en verwerkingsjobs in `scraper/` op een Windows-notebook.
- PM2 beheert periodieke scraper- en intakeprocessen; Windows Taakplanner start
  de zelfstandige detectierun.
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
| Tests en fixtures | `scraper/__tests__/` |

Exacte schema-aannames moeten altijd tegen migraties en de actuele database
worden gecontroleerd; oude plannen zijn hiervoor geen gezaghebbende bron.
