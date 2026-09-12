# Dagelijkse pipeline en operaties

**Doel:** veilige bediening van scraper-, intake- en detectieketen.
**Status:** actief.
**Lees wanneer:** bij operationeel werk of aanpassing van planning.

## Volgorde

De Windows-notebook voert klassieke scrapers, fulltext, entiteitsextractie en
intake uit. De zelfstandige taak `Stadsgeest Detection` start de KG-adapters en
detectieregels. Exacte tijden moeten uit PM2 en Windows Taakplanner worden
gelezen; kopieer oude tijden niet uit historische documenten.

Belangrijke ingangen:

- `scraper/intake-run.mjs`
- `scraper/src/kg/detection-run.cjs`
- `scraper/run-detection-task.ps1`
- `scraper/pm2-healthcheck.ps1`

## Veiligheidsregels

1. Controleer actieve processen en logs vóór herstelacties.
2. Roep nooit `pm2 save` aan als `pm2 jlist` leeg is.
3. `stopped` kan tussen cronruns normaal zijn; beoordeel runs en opbrengst.
4. Verwijder locks alleen nadat is vastgesteld dat geen proces meer draait en
   de lock aantoonbaar stale is.
5. Start geen tweede intake, detectie of weger naast een actieve run.
6. Laat `scraper/node_modules` onafhankelijk van de frontendinstallatie.
7. Laat geheimen in `scraper/.env`; toon ze niet in uitvoer of documentatie.

Brongezondheid wordt per actieve run gemeten. Kalenderdagen zonder nieuwe
records zijn op zichzelf geen storing.
