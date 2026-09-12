# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** actueel per 12 september 2026.
**Lees wanneer:** bij iedere nieuwe taak. Historische details staan elders.

## Productie

Stadsgeest is een lokale journalistieke signalerings- en tipmachine voor
Amersfoort en Leusden. Publieke bronnen worden opgeslagen, tot signalen
geclusterd, via entiteiten en detectieregels verbonden en door de weger omgezet
in redactietips en dossierfeiten. Het redactiedashboard draait op
`stadsgeest.nl/nieuwsplein33`; de applicatie staat op Vercel en de operationele
pipeline op Jaspers Windows-notebook.

De hoofdketen is:

`bronnen → raw_items/source_records → events en entiteiten → signalen → weger → tips/dossiers → dashboard`

Fase 2 is productierijp gemaakt met een zelfstandige dagelijkse detectierun via
Windows Taakplanner. De laatste vastgelegde controle gaf resultaat 0, exacte
herhaalverwerking en geen adapterfouten. Intake en detectie hebben eigen locks.

## Actieve fase

Fase 3 breidt sectorregisters en statistiek uit. Aangesloten DUO-bronnen:

- 86 BO- en VO-vestigingen in Amersfoort en Leusden als registerbaseline;
- leerlingaantallen voor 83 vestigingen, met terughoudende groeidrempels;
- prognoses voor 60 lokale BO-vestigingen, 1.200 waarden voor 2026–2045;
- detectieregels R10 en R11 voor opvallende realisatie- en prognosewijzigingen.

Baselines veroorzaken bewust geen historische tips. Alleen latere betekenisvolle
wijzigingen leveren events en mogelijke signalen op.

## Laatste verificatie

- `main` en `origin/main` stonden bij de migratie gelijk op `65cb647`.
- Laatst gerapporteerde volledige scraper-teststand: 98/98 geslaagd.
- Integrale detectie-dry-run: tien adapters, negen regels, geen failures.
- DUO-, LRK- en asbestadapters zijn op herhaalbaarheid gecontroleerd.

Deze cijfers zijn een momentopname, geen vervanging voor een nieuwe controle na
codewijzigingen.

## Open risico's en eerstvolgende stappen

1. De Codex-weger en dagelijkse taak zijn gereed; de taak staat bewust
   gepauzeerd. Activeer hem pas nadat de Claude/Cowork-weger is uitgeschakeld.
2. Volgende fase-3-bron: officieel toezicht- en kwaliteitsoordeel per school.
   Stel eerst broncontract en journalistieke drempel vast.
3. Ongeveer 286 oudere Notubiz-documenten missen nog fulltext; urgente stukken
   kunnen via browserimport worden aangevuld.
4. De repository bevat onbekende niet-gevolgde bestanden. Niet verwijderen of
   automatisch committen; afzonderlijk classificeren.
5. Een detection-engine-testmap en onderwijsinspectiewerk zijn lokaal maar niet
   gevolgd en behoren niet tot deze migratie. Classificeer ze afzonderlijk.

De actuele uitwerking staat in `PHASES/phase-3.md`.
