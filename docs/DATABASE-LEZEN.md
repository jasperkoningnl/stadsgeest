# Zuinig lezen uit Turso

**Doel:** voorkomen dat Stadsgeest het leesquotum van Turso opmaakt.
**Status:** gezaghebbend; bijgewerkt 2026-09-26.
**Lees wanneer:** bij elke taak die een query toevoegt of wijzigt, data analyseert
of een backfill, migratie of hulpscript draait.

## Waarom

Het gratis plan geeft 500 mln gelezen rijen per maand voor het hele account, circa
16 mln per dag. De nachtketen en een weger-run gebruiken daar al het grootste deel
van. Boven het quotum weigert Turso alle leesopdrachten: dashboard, scrapers en
routines liggen dan stil tot de 1e van de maand. Dat gebeurde op 26 september 2026.

Turso telt elke rij die de database **bekijkt**, niet de rijen die terugkomen. Een
query zonder passende index leest de hele tabel; `count`/`sum`/`min`/`max` tellen
elke meegenomen rij; joins en subqueries tellen alle bekeken rijen van alle tabellen.

## Regels

1. `LIKE '%…%'` op vrije tekst leest de hele tabel. Eén zoekopdracht over
   `raw_items` kost zo'n 14.000 reads, over `source_records` zo'n 86.000; dat mag.
   Nooit in een lus (per adres, per signaal) of als correlated subquery: dan wordt
   het miljoenen. Meer dan een paar tientallen zoekopdrachten: lokale kopie.
2. Analyse en verkenning draaien op een lokale kopie, niet op Turso. De hele database
   kopiëren kost circa 250.000 reads, minder dan drie scans van `source_records`.
   Hulpscripts als `weger-query.cjs` en `stadsgeest-werk\q.cjs` zijn voor enkele
   gerichte queries, niet voor sweeps.
3. Draai `EXPLAIN QUERY PLAN` op elke nieuwe of gewijzigde query. Op `raw_items`,
   `source_records`, `raw_item_attachments` en `document_mentions` moet
   `SEARCH … USING INDEX` staan, geen `SCAN`. Zo niet: index toevoegen of herschrijven.
4. Geen query per rij (N+1). Eén query met een join op een geïndexeerde kolom.
5. Dashboard: elke paginaweergave telt. Tellers en zware lijsten in
   `unstable_cache` met revalidate, of vooraf berekenen. De verkenner (`LIKE`) is
   een bekend probleem.
6. `CREATE INDEX`, `ALTER TABLE` en backfills lezen de hele tabel. Eén keer mag;
   nooit in code die bij elke run of deploy opnieuw draait.
7. Tabelgroottes via `dbstat` of `sqlite_stat1`; die kosten geen reads. `count(*)` wel.
8. Meet na afloop in Beheer → Verbruik (per uur) en noem het verbruik in de
   overdracht. Grote queries eerst met Jasper afstemmen.

## Bekende grote verbruikers

- `operations/WEGER.md` sectie 3a en 3b: verbandencheck en sweep zoeken in vrije
  tekst. Een normale run kost circa 13 mln.
- 23 september 2026: 240 mln in twintig minuten door adres-`LIKE` over
  `raw_items` en `source_records` tijdens een analysesessie.
- `scrape-browser` (circa 9 mln per nacht) en NDW (circa 100.000 per uur).
