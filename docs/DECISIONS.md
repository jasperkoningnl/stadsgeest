# Technische beslissingen

**Doel:** zwaarwegende afwijkingen van het leidende uitbreidingsplan verklaren.
**Status:** gezaghebbend.
**Lees wanneer:** bij roadmapafwijkingen of wanneer een eerdere ontwerpkeuze ter discussie staat.

## 2026-09-13 — Migratieplan geïntegreerd, niet langer zelfstandig leidend

De blijvende contracten uit het migratieplan zijn opgenomen in
`ARCHITECTURE.md`, `SOURCES.md`, `TESTING.md` en `PHASES/phase-0.md`. Actuele
migratiecode en de productiedatabase zijn leidend voor het schema; het oude plan
blijft alleen historische implementatienaslag. Reden: delen zijn uitgevoerd en
andere details zijn door productie-ervaring geëvolueerd.

## 2026-09-13 — Geen ongebruikte KG-featureflags toevoegen

De vijf voorgestelde `STADSGEEST_*`-flags zijn niet geïmplementeerd. KG-detectie
draait als afzonderlijke taak en wordt niet impliciet vanuit de klassieke intake
geactiveerd. Ongebruikte flags zouden schijnveiligheid en extra configuratie
toevoegen. Herbeoordeel dit wanneer beide paden worden geïntegreerd of een
onderdeel afzonderlijk teruggeschakeld moet kunnen worden.

## 2026-09-13 — Oorspronkelijke R5/R10 behouden; DUO wordt R11/R12

Het uitbreidingsplan is leidend voor de publieke regelidentiteit: R5 blijft de
anomaliedetector voor geregistreerde misdrijven en R10 blijft multi-source-
versterking. De tussentijds als R10 en R11 gebouwde DUO-regels worden daarom
R11 (leerlingaantallen) en R12 (prognoses). Inspectiekwaliteit krijgt R13 en
NDW-impact R14. De productie-audit vond geen bestaande DUO-signalen met de oude
R10/R11-provenance, zodat deze correctie geen historische signalen herschrijft.
R8 blijft gereserveerd voor de fase-4-regel uit het uitbreidingsplan.

## 2026-09-13 — Aparte KOOP-SRU-adapter na dekkingsaudit

De bestaande intake bevatte 6 van 280 bemonsterde officiële lokale publicaties
uit Staatscourant, Provinciaal blad, Waterschapsblad en Blad gemeenschappelijke
regeling (2,1%). Dat is ver onder de beslisgrens van 95%. Daarom is de bestaande
adapter niet alleen van classifiers voorzien, maar is een aparte SRU 2.0-route
gebouwd met twee dagen overlap en de officiële publicatie-ID als deduplicatie-
sleutel.

## 2026-09-13 — Bestaande database-enums blijven compatibel

De productievelden `category` en `scrape_frequency` accepteren bewust een kleine
vaste waardenset. Nieuwe fase-3-bronnen gebruiken daarom `registry` of `data` en
`hourly`, `daily` of `weekly`. Dit is geen verlies van betekenis: het bronmanifest
legt het precieze domein en de feitelijke cadans vast, en de taakplanner voert
NDW werkelijk iedere vijftien minuten uit. Zo blijft de migratie additief en
hoeven bestaande tabellen niet risicovol te worden herbouwd.

## 2026-09-13 — Fase-4-regels krijgen R8, R15 en R16

R8 krijgt conform het uitbreidingsplan de identiteit “veelgevraagde lokale
spreker/maker”. R15 wordt de materiële jaar-op-jaarverandering in openbare
zorgverantwoording en R16 de materiële verschuiving in lokale dPi-plannen. R3
wordt inhoudelijk uitgebreid met SEVESO-inspecties en -overtredingen, maar krijgt
geen nieuw nummer. Hiermee blijven R5, R10, R11, R12, R13 en R14 exact behouden.

## 2026-09-13 — Rijksmonumenten via officiële PDOK OGC-route

Het uitbreidingsplan noemt de dagelijkse `Extract_MRS`-ZIP. De actuele download
bevat echter uitsluitend een circa 336 MB groot Microsoft Access-bestand en is
zonder platformspecifieke driver niet veilig reproduceerbaar in de Node-keten.
Daarom gebruikt de adapter de officiële, dagelijks bijgewerkte RCE-collectie in
de PDOK OGC API Features, onder CC-BY 4.0. Monumentnummer/INSPIRE-ID en officiële
gemeentepolygonen blijven de identiteit en lokale bewijsroute bepalen.

## 2026-09-13 — Geen verzonnen Leusdense evenementenkalenderdekking

Amersfoort publiceert een jaarkalender met de expliciete waarschuwing dat
registratie geen vergunning is. Voor Leusden is geen vergelijkbare actuele,
officiële openbare jaarkalender gevonden. De gemeentekalenderadapter dekt daarom
alleen Amersfoort; Leusdense evenementen komen uitsluitend uit de op locatie
gevalideerde regionale UITagenda. Dit wordt als bekende dekkingsgrens getoond.

## 2026-09-13 — Samen Meten blijft experimenteel en standaard uit

De publieke RIVM SensorThings-API is technisch bruikbaar na lokale geoquery,
punt-in-polygooncontrole en gemeentecodecontrole. Goedkope sensoren hebben echter
geen zelfstandig journalistiek gezag. De adapter staat daarom achter
`STADSGEEST_ENABLE_SAMEN_METEN=1`, bewaart alleen meetcontext en emitteert nog
geen harde events. Activering van signalering vereist latere kalibratie op ten
minste drie sensoren, twee uur continuïteit en voldoende dekking, plus review.

## 2026-09-13 — Zorgcijfers krijgen een begrensde streamparser

De vijf definitieve ODS-bestanden over 2023 en 2024 bevatten samen honderdduizenden
rijen en pakken zeer groot uit. Volledig in geheugen uitpakken bedreigt de
dagelijkse keten. De adapter leest daarom alleen `content.xml` als stream, houdt
uitsluitend schemahoofden en exact lokale/hard-KVK-gematchte rijen vast en draait
operationeel met een begrensde Node-heap. Een fout raakt alleen deze adapter.

## 2026-09-13 — Live herhaalrun op gebruikersverzoek afgebroken

De volledige fase-4-productienulmeting is geslaagd voor alle acht adapters en
maakte nul events. De aansluitend gestarte identieke herhaalrun is op
uitdrukkelijk verzoek afgebroken om direct af te ronden. Dit geldt niet als
technisch bewijs van live idempotentie; de eerstvolgende geplande detectierun
moet aantonen dat productie uitsluitend ongewijzigde records ziet en niets
dupliceert.
