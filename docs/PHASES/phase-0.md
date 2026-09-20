# Fase 0 — inventarisatie en contracten

**Status:** afgerond; formele slotaudit geslaagd op 20 september 2026.

Het datamodel, adaptercontract, provenancecontract, testfundament en de
productiebaseline zijn aangelegd. De duurzame migratieprincipes staan nu in
`../ARCHITECTURE.md`, `../SOURCES.md` en `../TESTING.md`; besluiten over schema-
autoriteit en feature flags staan in `../DECISIONS.md`. Vóór definitieve
afsluiting zijn de fase-0-punten opnieuw tegen productie getoetst.

`audit-phase0.cjs` herleidt de oorspronkelijke nulmeting van 4 september
(8.084 bronitems, 1.717 signalen, 4.644 klassieke entiteiten, 105 dubbele
URL-groepen en 131 bronnen) naar het historische overdrachtsbewijs. De actuele
meting telt 9.369 bronitems, 2.399 signalen, 114 dubbele URL-groepen op 9.151
unieke URL's en 715 adapterruns, waarvan zeven mislukt. Alle vereiste tabellen
bestaan en 75.935 bronrecords bevatten herverwerkbare ruwe invoer.

De aparte KOOP-SRU-route heeft nul dubbele eventidentifiers en nul dubbele
bronrecordversies. Schemafouten, tijdelijke lege bronnen, tweerunsverwijdering,
terugkeer na tijdelijke afwezigheid en identieke herhaling zijn door de vaste
adaptertests afgedekt. Daarmee zijn baseline, deduplicatie en herstelgedrag
reproduceerbaar in plaats van alleen historisch beschreven.

**Afsluitvoorwaarde:** behaald. Draai `node scraper/audit-phase0.cjs` voor de
actuele productiecontrole en `npm test` voor het herstel- en regressiecontract.
