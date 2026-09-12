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
wijzigingen leveren events en mogelijke signalen op. De prognoseversie is die
van 3 juli 2026. Inspectieoordelen uit de oude DUO-set zijn uitgesloten wegens
peildatum 1 september 2018; VO-prognoses wegens de sinds 2023 niet vernieuwde,
alleen instellingsgebonden dataset.

De klassieke Onderwijsinspectiebron volgt nu exact Amersfoort en Leusden: 116
instellingen (95 en 21) en momenteel 15 inhoudelijke rapporten in het
tweejaarsvenster. De eerste Leusdense run leverde drie nieuwe bronitems op; een
identieke herhaalrun schreef niets dubbel.

## Laatste verificatie

- Voor deze wijziging stonden `main` en `origin/main` gelijk op `990eb10`.
- Aangewezen offline tests: 63/63 geslaagd; database-integratietests: 33/33.
- Documentatiecontrole en productiebuild slagen; lint heeft één bestaande
  waarschuwing en geen fouten.
- Integrale detectie-dry-run: tien adapters, negen regels, geen failures.
- DUO-, LRK- en asbestadapters zijn op herhaalbaarheid gecontroleerd.
- Windows-taken Intake en Detection eindigden voor het laatst met resultaat 0;
  PM2-healthcheck bevestigde 11/11 jobs actief. De Codex-automatisering
  `Stadsgeest-weger` staat bewust actief.

Deze cijfers zijn een momentopname, geen vervanging voor een nieuwe controle na
codewijzigingen.

## Open risico's en eerstvolgende stappen

1. Laat de geplande intake de drie nieuwe Onderwijsinspectie-items verwerken;
   controleer daarna gericht de uitkomst. Ontwerp vervolgens de koppeling aan de
   DUO-vestigingssleutel en de journalistieke wijzigingsdrempel, zonder brede
   historische import.
2. Ongeveer 286 oudere Notubiz-documenten missen nog fulltext; urgente stukken
   kunnen via browserimport worden aangevuld.
3. De repository bevat onbekende niet-gevolgde bestanden. Niet verwijderen of
   automatisch committen; afzonderlijk classificeren.
4. De niet-gevolgde detection-engine-testmap behoort niet tot deze wijziging;
   classificeer die afzonderlijk.

De actuele uitwerking staat in `PHASES/phase-3.md`.
