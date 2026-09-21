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
- `scraper/run-phase5-evaluation.cjs`
- `scraper/retain-phase5-feedback.cjs`
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

## Fase-4-cadans en begrenzing

De dagelijkse detectietaak haalt fase-4-bronnen alleen op wanneer hun
minimuminterval is verstreken. UITagenda draait dagelijks; monumenten en
governance wekelijks; evenementenkalender wekelijks in augustus–december en
anders maandelijks; zorg wekelijks in maart–juni en september–oktober en anders
maandelijks; dPi en SEVESO maandelijks. Samen Meten draait alleen met
`STADSGEEST_ENABLE_SAMEN_METEN=1`.

Start de zorgadapter operationeel met een Node-heaplimiet van 768 MB. De
streamparser voorkomt volledig uitpakken, maar de vijf ODS-bestanden blijven
CPU-intensief. Een zorgfout mag nooit aanleiding zijn om de lock te verwijderen
zolang het proces nog bestaat. Gebruik `audit-phase4.cjs` en
`backtest-phase4.cjs` na een gecontroleerde dubbele nulmeting.

## Fase-5-evaluatie en retentie

Na de detectierun maakt dezelfde taak alleen indien nodig de evaluatie van de
vorige kalendermaand en voert zij de 24-maandsretentie uit. Beide stappen loggen
afzonderlijk, zijn idempotent en kunnen elkaars of de adapteruitkomst niet
overschrijven. Controleer met:

```powershell
node scraper/run-phase5-evaluation.cjs --scheduled
node scraper/audit-phase5.cjs
node scraper/retain-phase5-feedback.cjs
```

Het laatste commando is een dry-run. Gebruik `--apply` alleen voor de geplande
retentie of een bewuste beheerhandeling. Een evaluatie of maandreview geeft nooit
toestemming om drempels, brongewichten of regels automatisch te veranderen.

## Entitybeheer en fase-1-audit

Controleer de actuele dekking en openstaande fase-1-eisen met:

```powershell
node scraper/audit-phase1.cjs
node scraper/backfill-bag-locations.cjs
node scraper/backfill-permit-events.cjs
node scraper/manage-entity-merge.cjs list
```

De BAG-opdracht draait standaard als dry-run en accepteert alleen exacte
adresmatches in Amersfoort of Leusden. Gebruik `--apply` pas na beoordeling van
de uitvoer. Hiervoor worden bestaande volledige adressen naar de openbare PDOK
Locatieserver gestuurd; voer de opdracht daarom alleen uit met expliciete
toestemming voor die gegevensoverdracht.

Een merge wordt pas uitgevoerd met een expliciete actor en reden. De beheerder
kan iedere geaudite merge via `manage-entity-merge.cjs unmerge` transactioneel
terugdraaien. Handmatige seeds bewaren bron, reden en eerstvolgende reviewdatum.

De vergunningbackfill koppelt alleen bestaande records op exact
postcode-huisnummer aan een bevestigde BAG-locatie. Ook deze opdracht is
standaard een dry-run; gebruik `--apply` pas na controle van de aantallen.
