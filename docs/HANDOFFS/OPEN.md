# Open punten

**Doel:** één bijgehouden lijst van wat de overdrachten open laten.
**Status:** bijgewerkt 2026-10-05; samengesteld uit de overdrachten van week 40.
**Lees wanneer:** bij vervolgwerk aan keten, bronnen of dashboard.

Eén regel per punt, met de datum van de overdracht waar het uit komt. Schrap een
punt zodra het is opgelost; de uitleg staat in het weekbestand. Cijfers staan in
`../STAND.md`.

## Wacht op Jasper

- Turso: plan verhogen of verbruik terugbrengen; 35% van het maandquotum op 5 oktober.
- Statenstukken: strengere toets (treffers naar lengte) of achtergrondstatus voor grote provinciebrede stukken (10-02).
- Tier 3: andere oplossing dan niet meer opslaan (10-04). Rolcontrole in de API-routes en de weekmailroute zijn geparkeerd.
- Staan `WEEKMAIL_ONTVANGERS`, `CRON_SECRET` en `WACHTWOORD_BELEIDSADVISEUR` op Vercel? Vanuit de repo niet te controleren (10-02, 10-03).
- Dossiers: additieve velden voor baan (intern/openbaar) en open vraag/wederhoor (10-01).
- Dossiergraaf: niet-gekoppelde organisatienamen als eigen knoop, of eerst de KG verrijken (10-01).
- Clusteren op zaakkenmerk: steekproef beoordelen en beslissen wat er gebeurt als een nieuw stuk bij een al weggezette zaak hoort (10-05).
- Documentlezer: vijf uittreksels beoordelen en het opslagvoorstel in `operations/DOCUMENTLEZER.md` goedkeuren of aanpassen (10-05).

## Keten en bewaking

- Detectietaak eindigt op 1: op 5 oktober `ner=1` (libsql `SERVER_ERROR`, HTTP 400) en `registeradressen=1` (`RCE SPARQL HTTP 503`); op 4 oktober alleen de RCE (10-04).
- Kamp Amersfoort geeft sinds 4 oktober elke nacht `error` zonder foutmelding (10-04).
- Routinefilter in de intake is nog niet in werking gezien: de run van 5 oktober bevatte geen bekendmaking van die soort. Na een werkdag tellen op reden `routine:` (10-04).
- NDW in de gecombineerde detectierun: rond 11 oktober nakijken of `ndw` op `ok` staat binnen de heaplimiet (10-04).
- `lokale-kopie.cjs` eindigt op Windows met `EBUSY` bij het hernoemen; de kopie staat dan compleet als `.db.bezig` (10-05).
- `Kon scrape_runs niet bijwerken ... fetch failed` in het errorlog van `scrape-dagelijks`; oorzaak onbekend (10-03).
- De tests van de ANBI-bestuursmonitor schrijven bij elke testrun in de echte snapshotmap (10-04).
- Wekelijks archiefonderzoek mislukte op 30 september (`fetch failed`); geen herkansing ingebouwd.
- De weger slaat dagen over als het budget op is; dat wordt nergens gemeld.

## Bronnen en tekst

- Raad Amersfoort via Notubiz (bron 168): de achterstand loopt binnen en geeft tijdelijk meer signalen; tekst boven 200.000 tekens gaat bij deze scraper verloren (10-04).
- Ingekomen stukken: 458 met alleen metadata; de griffie hernummert, waardoor stukken dubbel worden opgeslagen (10-03).
- B&W-stukken worden bij het splitsen afgekapt op 50.000 tekens; een besluitenlijst op 500.000 tekens en 50 pagina's per pdf (10-02, 10-04).
- 23 uitspraken in bron 17 hebben alleen metadata; signalen van vóór 1 september zijn niet opnieuw aangeboden (10-03).
- Didam-patronen van de bron 'Grond en vastgoed' de eerste weken nakijken op gemiste en valse treffers (10-03).
- B&W-besluitenlijsten Leusden ontbreken; op de notebook nagaan of Notubiz Leusden ze heeft (10-02).
- OCR-drempel voor leesbaarheid (0,08) is op 45 teksten bepaald (10-03).
- R5: de stijging van verkeersmisdrijven (1.3.1) kan een registratiewijziging zijn; niet nagevraagd (10-02).
- B&W-stukken (bron 131): `full_text` bevat de paginatekst van de besluitenlijst en gaat in `weger-workset.cjs` vóór `content`; de weger ziet het stuk zelf niet (10-05).
- Documentlezer: het oordeel nieuwswaarde onderscheidt niet en de grens van twintig feiten werkt als doel; leesinstructie pas bijstellen na het oordeel van Jasper (10-05).

## Dashboard

- De beslisflow, de bulkafsluiting en de andere wijzigingen van 3 oktober zijn niet in een browser tegen productie geklikt (10-03).
- Rond 10 oktober de tab Beheer > Redactie lezen: daalt de ouderdom van de wachtrij, wordt de bulkafsluiting gebruikt (10-03).
- Maandag de weekmail controleren (10-03).

## Leerloop

- De augustus-reviewcyclus van fase 5 staat open.
- Golden set fase 1: met de huidige beoordelingen is 98% precisie niet haalbaar; de vijf afwijkingen bekijken.
