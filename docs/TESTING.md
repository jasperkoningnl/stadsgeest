# Testen en verifiëren

**Doel:** reproduceerbare minimale controles.
**Status:** gezaghebbend.
**Lees wanneer:** bij iedere codewijziging.

## Commando's

Vanuit de repowortel:

```powershell
npm run lint
npm test
npm run build
```

`npm test` draait de offline scraper-, detectie- en weger-tests via het eigen
package in `scraper/`. `npm run check` voert alle drie controles achter elkaar
uit. Database-afhankelijke schema- en entity-tests staan apart onder
`npm --prefix scraper run test:integration`; draai die alleen met geldige
productietoegang en behandel ze als gerichte livecontrole.

## Bewijsniveau

- Unit- en integratietests bewijzen het gedrag van code en fixtures.
- Een dry-run bewijst dat adapters en regels zonder productiewrites doorlopen.
- Een gerichte livecontrole bewijst aantallen, planning of database-effecten.
- Een exitcode 0 zonder controle van uitvoer, rijen of zichtbare toestand is
  geen volledige verificatie.

## Adapter- en migratiecontract

Een nieuwe bron krijgt kleine, geanonimiseerde fixtures met de vastgelegde
bronrespons en verwachte genormaliseerde records; voeg verwachte entiteiten toe
wanneer matching onderdeel van de adapter is. Dek minimaal af:

- parsercontract en lokale filtering;
- identieke herhaalrun/idempotentie;
- baseline zonder historisch event;
- betekenisvolle wijziging versus parser- of metadatawijziging;
- schema-drift, lege of afgeschermde waarden en verwijderingsgedrag;
- foutisolatie en dry-run zonder productiewrites.

Schema- en seedmigraties vereisen daarnaast controle van tabellen, kolommen,
indexen, herhaalbaarheid en behoud van bestaande data. Gebruik de ingebouwde
Node-testrunner en voeg geen testdependency toe zonder concrete noodzaak.

Gebruik nooit productiegeheimen in testfixtures of CI. GitHub Actions bouwt
zonder `.env` en mag daarom alleen paden uitvoeren die netjes met ontbrekende
productievariabelen omgaan.

De lokale map `scraper/__tests__/detection-engine/` was bij de migratie nog
niet gevolgd. Classificeer en commit die niet automatisch.

## Fase-3-verificatie

De gevolgde suite `scraper/__tests__/phase3/adapters.test.cjs` gebruikt kleine
fixtures voor AFM XML/CSV, DNB, RVO, KOOP en NDW. Zij dekt daarnaast Inspectie-
BRIN/oordeeldrempels, politie-kleine-aantallen en robuuste trigger, geometrische
buffer, broncadans, stabiele feedidentiteit, tweerunsverwijdering en beide
24-maandsbacktests. De volledige AFM-ZIP, RVO-export, NDW-gzip en CBS-OData
blijven live/dry-run-controles en worden niet in Git opgenomen.

Voor fase 3 is naast `npm test` vereist:

```powershell
node scraper/audit-phase3.cjs
node scraper/backtest-phase3.cjs
node scraper/src/kg/detection-run.cjs --dry-run --skip-rules --adapters=<bron>
npm --prefix scraper run test:integration
```

Een productiebaseline moet `baseline:true` en nul events tonen; de onmiddellijke
herhaalrun moet `baseline:false`, uitsluitend `unchanged` en nul events tonen.
Controleer na installatie van `Stadsgeest NDW` zowel het log als
`LastTaskResult = 0`.

## Fase-4-verificatie

De fixture-suite `scraper/__tests__/phase4/adapters.test.cjs` dekt exacte lokale
filters, XLSX/ODS inclusief streaming, JSON-LD, kalender- en governancegrenzen,
SensorThings-geometrie, stabiele SEVESO-naamvarianten, R8 en de drempels voor
R15/R16. Het gedeelde fase-3-diffcontract blijft de idempotentie, baseline en
tweerunsverwijdering bewijzen.

Voer na de additieve migratie en bron-dry-runs uit:

```powershell
node scraper/audit-phase4.cjs
node scraper/backtest-phase4.cjs
npm --prefix scraper run test:integration
```

De audit vereist per fase-4-bron een baseline, twee geslaagde productieruns en
een laatste run zonder nieuwe, gewijzigde of verwijderde records. Samen Meten
wordt voor die gecontroleerde nulmeting tijdelijk aangezet en blijft daarna in
de gewone planning uitgeschakeld.
