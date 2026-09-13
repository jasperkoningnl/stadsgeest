# Documentatiekaart

**Doel:** minimale, betrouwbare leesroute voor Stadsgeest-taken.
**Status:** gezaghebbend; bijgewerkt 2026-09-12.
**Lees wanneer:** altijd, direct na `AGENTS.md`.

## Standaard

Lees `CURRENT.md`. Kies daarna alleen de route die bij de taak past:

| Taak | Lees daarnaast |
|---|---|
| Productdoel of begrippen | `PROJECT-OVERVIEW.md` |
| Frontend of dashboard | `ARCHITECTURE.md`, `TESTING.md` |
| Scraper, intake, detectie of database | `ARCHITECTURE.md`, `SOURCES.md`, `RUNBOOKS/operations.md`, `TESTING.md` |
| Productiestoring of herstel | `RUNBOOKS/incident-response.md` en daarna alleen relevante logs |
| Deployment | `RUNBOOKS/deployment.md`, `TESTING.md` |
| Roadmap of uitbreidingsplan | `ROADMAP.md`, `PHASES/README.md`, daarna zo nodig het volledige `Stadsgeest_uitbreidingsplan_Claude.md` |
| Werk aan een specifieke fase | `PHASES/README.md`, daarna alleen het betreffende fasebestand |
| Dagelijkse redactionele weging | `../operations/WEGER.md`, `EDITORIAL-PROFILE.md` |
| Historische vraag | `HISTORY/INDEX.md`, daarna gericht zoeken |

## Niet standaard lezen

- `STATUS.md`: alleen een verwijzer.
- `LOGBOEK.md`: productinhoud voor het dashboard.
- `HANDOFFS/`: alleen voor recente uitvoering of overdracht.
- `HISTORY/`, oude weekreviews, rapporten, exports en ontwerpen.
- Grote bronbestanden of onderzoeksnotities, tenzij de taak ze noemt.

## Eén gezaghebbende plek

Actuele toestand staat alleen in `CURRENT.md`; duurzame projectuitleg in
`PROJECT-OVERVIEW.md`; techniek in `ARCHITECTURE.md`; bronbeleid in `SOURCES.md`;
uitvoering in `RUNBOOKS/`; roadmap in `ROADMAP.md`; actieve scope in `PHASES/`. Andere bestanden linken
hiernaar en kopiëren de inhoud niet.
