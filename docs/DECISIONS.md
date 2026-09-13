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
