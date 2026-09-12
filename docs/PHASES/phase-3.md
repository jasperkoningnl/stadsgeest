# Fase 3 — sectorregisters en statistiek

**Doel:** actieve scope en acceptatiecriteria.
**Status:** actief per 12 september 2026.
**Lees wanneer:** bij planning of werk aan fase 3.

## Gereed

- DUO BO/VO-vestigingen: 86 lokale vestigingen als baseline.
- DUO-leerlingaantallen: 83 bruikbare vestigingen en R10-drempels.
- DUO BO-prognoses: 60 vestigingen, twintig jaren per vestiging en R11.
- Baseline-, diff-, schemadrift- en idempotentietests.
- Detectiesignalen krijgen onderliggend bewijs via `raw_items` en
  `signal_items`.

## Volgende bron

Sluit het officiële toezicht- of kwaliteitsoordeel per school aan. Doe eerst:

1. actuele officiële dataset en gebruiksvoorwaarden vaststellen;
2. lokale dekking en stabiele vestigingssleutel verifiëren;
3. betekenis van ontbrekende en gecorrigeerde records bepalen;
4. journalistieke drempel met voorbeelden vastleggen;
5. baseline, semantische diff, provenance en kleine echte fixtures ontwerpen;
6. pas daarna adapter en detectieregel bouwen.

## Acceptatiecriteria

- Exacte lokale filtering voor Amersfoort en Leusden.
- Geen event of signaal tijdens de eerste baseline.
- Identieke herhaalrun schrijft niets nieuws.
- Alleen betekenisvolle wijzigingen veroorzaken maximaal één passend event.
- Elk signaal heeft een officiële bron, versie/peildatum en bewijsrecord.
- Parser- of metadatawijzigingen veroorzaken geen journalistieke verandering.
- Tests dekken schemafouten, afgeschermde waarden en verwijderingsgedrag.

## Buiten deze stap

Geen uitbreiding naar nieuwe sectoren voordat de schoolkwaliteitsbron stabiel
en redactioneel beoordeeld is. Oude faseplannen zijn historie, geen backlog.
