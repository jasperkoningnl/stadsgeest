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
- DUO-prognoseversie 3 juli 2026. De oude inspectieoordelen (peildatum 1
  september 2018) en VO-prognoses (sinds 2023 niet vernieuwd en alleen per
  instelling) zijn bewust uitgesloten.
- De klassieke Onderwijsinspectiescraper dekt exact Amersfoort en Leusden,
  bewaart actuele oordelen met officiële toelichting en ontdubbelt rapporten op
  rapportnummer/detail-URL. Oudersamenvattingen worden onderdrukt wanneer op
  dezelfde datum een inhoudelijk rapport bestaat.

## Eerstvolgende afgebakende stap

Laat de geplande intake eerst de drie nieuwe Leusdense bronitems verwerken en
controleer gericht hoe zij zijn geclusterd en gewogen. Ontwerp daarna, zonder
historische import:

1. de koppeling van Inspectie-elementen aan de DUO-vestigingssleutel;
2. de betekenis van ontbrekende en gecorrigeerde oordelen;
3. een journalistieke wijzigingsdrempel met concrete voorbeelden;
4. baseline, semantische diff en provenance met kleine echte fixtures;
5. pas daarna een KG-adapter en detectieregel.

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
