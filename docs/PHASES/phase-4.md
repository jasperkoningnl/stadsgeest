# Fase 4 — periodieke en experimentele bronnen

**Status:** afgerond en productieactief op 13 september 2026; identieke live herhaalcontrole geslaagd.

## Opgeleverd

| Bron | Productieroute en lokale selectie | Gedrag |
|---|---|---|
| Jaarverantwoording Zorg | Dynamische ontdekking van de laatste twee definitieve boekjaren; ODS-streamparser; exacte vestigingsplaats of hard lokaal KVK | Jaarlijkse vergelijking 2023–2024, R15 alleen bij minstens €250.000 én 15%; CIBG-beperking altijd zichtbaar |
| dPi woningcorporaties | Officiële data.overheid.nl-catalogi 2024/2025; XLSX; exact `gemeente=Amersfoort/Leusden` | Vergelijking van hetzelfde doeljaar en dezelfde maatstaf; R16 bij minstens 25 eenheden of minstens 10 én 20%; prognose is geen realisatie |
| Tijd voor Amersfoort | Gepagineerde volledige UITagenda, detail-JSON-LD, exact `addressLocality`, horizon 90 dagen | `STRUCTURED_CONTEXT`; agenda-items zijn geen tips; R8 vereist vier evenementen, drie organisatoren/locaties en een al bewezen lokale persoon |
| Gemeentelijke evenementenkalender | Actuele officiële Amersfoortse PDF; naam + datum + locatie | Registratie is expliciet geen vergunning; Leusden heeft geen vergelijkbare openbare jaarkalender |
| Rijksmonumentenregister | RCE-data via officiële PDOK OGC API en officiële gemeentepolygonen GM0307/GM0327 | Diff op monumentnummer en inhoud; afvoering pas na twee volledige runs |
| SEVESO+ | Inrichtingen-XLSX, nalevings-PDF, zes regionale indexpagina’s en lokale inspectie-PDF’s | Eén lokale inrichting; site-, nalevings- en inspectie-identiteiten apart; R3 accepteert alleen inspectie/overtreding met lokale graphkoppeling |
| RIVM Samen Meten | SensorThings, geoquery plus officiële gemeentegrens en gemeentecode | Experimenteel achter `STADSGEEST_ENABLE_SAMEN_METEN=1`; meetcontext, nul harde events; deelsourcefouten geïsoleerd |
| Openbare governance | Brongebonden extractie van Portaal en de Alliantie | Geen persoonsmerge op naam; relaties sluiten pas na tweerunsbevestiging van verwijdering |

## Bron- en datacontract

Alle adapters hebben een manifest met eigenaar, gebruiksstatus, actuele route,
cadans, identiteit, lokale filter, semantische velden, onzekerheid en
verwijderingsbeleid. Ruwe officiële responses worden gecomprimeerd buiten Git
gearchiveerd en in `source_snapshots` voorzien van URL, hash, mediatype en
ophaaltijd. Baselines maken geen events; een identieke herhaalrun maakt geen
records, events of signalen. Afwezigheid wordt pas na twee volledige geslaagde
runs als verwijdering behandeld.

Schema- en volumegrenzen stoppen alleen de betrokken adapter. Lege geldige
scope, zoals geen lokale inrichting, is toegestaan; ontbrekende tabellen,
afgeschermde verplichte velden, te kleine landelijke exports en te veel
RIVM-deelsourcefouten zijn fouten. Zachte agenda-, kalender-, governance- en
sensordata kunnen geen zelfstandig hard nieuwsfeit maken.

## Regels en backtests

- R8: veelgevraagde lokale spreker/maker, uitsluitend met bestaande lokale
  persoonskoppeling en verplichte review.
- R15: materiële jaar-op-jaarverandering in openbare zorgcijfers.
- R16: materiële verschuiving in dPi-plannen voor hetzelfde lokale doeljaar.
- R3 is uitgebreid met `SEVESO_INSPECTION_PUBLISHED` en
  `SEVESO_VIOLATION_RECORDED`; de lokale graphvoorwaarde blijft gelden.

De vaste nummering R5/R10/R11/R12/R13/R14 is ongewijzigd. De historische
jaarparen en detectorversies staan idempotent in `phase4_backtests` en zijn te
controleren met `node scraper/backtest-phase4.cjs`.

## Planning en verificatie

De bestaande dagelijkse taak om 06.15 uur blijft de orkestrator. De code remt
de bronnen af op hun echte cadans: UITagenda dagelijks; zorg wekelijks in de
publicatiemaanden en anders maandelijks; monumenten en governance wekelijks;
evenementenkalender wekelijks in augustus–december en anders maandelijks; dPi en SEVESO maandelijks; Samen Meten ieder uur uitsluitend
na bewuste activering. NDW blijft onafhankelijk iedere vijftien minuten draaien.

Verificatie bestaat uit fixtures, offline regressies, dry-runs per officiële
route, de additieve migratie `migrate-phase4.cjs`, productie-nulmeting en herhaalrun,
`audit-phase4.cjs`, `backtest-phase4.cjs`, database-integratietests,
documentatiecontrole, lint en productiebuild.

## Gemotiveerde afwijkingen

- De RCE-website biedt `Extract_MRS` als een groot Microsoft Access-bestand.
  De officiële, dagelijks bijgewerkte PDOK OGC-route is gekozen omdat die
  reproduceerbaar en zonder platformspecifieke Access-driver te verwerken is.
- Voor Leusden is geen officiële openbare evenementenkalender gevonden die met
  de Amersfoortse jaarkalender vergelijkbaar is. De adapter verzint daarom geen
  dekking; Leusdense evenementen blijven via de gevalideerde UITagenda lopen.
- Samen Meten blijft uitgeschakeld totdat de redactie sensordrempels met
  voldoende dekking heeft gekalibreerd. De bron verrijkt nu alleen reproduceerbaar.
- De volledige productieherhaalrun zag bij zeven adapters uitsluitend
  ongewijzigde records en nul events. Governance kreeg een geïsoleerde timeout;
  de directe gerichte herhaling zag 17 ongewijzigde records en nul events. De
  gerepareerde audit leest ook `records_found` en is vervolgens volledig groen.

**Afsluitvoorwaarde:** gehaald. Nulmeting en identieke live herhaling zijn
vastgelegd; langzame bronnen zijn versieerbaar, schemawijzigingen worden
afgevangen en zachte bronnen genereren geen harde claims.
