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
