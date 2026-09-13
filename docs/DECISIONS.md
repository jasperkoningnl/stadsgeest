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
