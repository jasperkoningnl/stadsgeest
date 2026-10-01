# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** actueel per 1 oktober 2026.
**Lees wanneer:** bij iedere nieuwe taak. Historische details staan elders.

## Productie

Stadsgeest is de lokale journalistieke signalerings- en tipmachine voor
Amersfoort en Leusden. De keten loopt van publieke bronnen via bronrecords,
events, entiteiten, signalen en de weger naar tips, dossiers en het
redactiedashboard op `stadsgeest.nl/nieuwsplein33`. Vercel host het dashboard;
Jaspers Windows-notebook voert de operationele keten uit. Het dashboard bevat
22 dossiers met ruim 300 feiten, inclusief overzicht, feitenlijst, tijdas en
partijengraaf.

`Stadsgeest Detection` start dagelijks om 06.15 uur; NDW draait iedere vijftien
minuten. Na de dagrun volgen de geplande fase-5-maandevaluatie en
privacyretentie. Adapter-, evaluatie- en retentiefouten zijn geïsoleerd en
idempotente invoer levert geen dubbele uitkomsten op. Beide taken eindigen
normaal met resultaatcode 0; dode proceslocks worden opgeruimd. De gecombineerde
detectierun heeft een heaplimiet van 1,5 GB.

De supertip-run draait donderdag om 09.00 uur en schrijft hoogstens één tip met
`supertip = 1`; nul is geldig. Een supertip blijft tot de maandag erna bovenaan.
Alleen deze run mag het veld zetten.

## Actieve oplevering

Fase 0 en fase 2 zijn gesloten en groen. Fase 1 heeft operationele baselines
voor ANBI, GLEIF en OpenStreetMap; herhaalruns leverden nul wijzigingen en nul
events op. De BAG-backfill koppelde 79 van 82 locaties exact en legde drie
niet-eenduidige gevallen vast. De handmatige organisatie-golden-set staat nog
op 0 van 200 beoordelingen.

Fase 3 en 4 zijn productieactief. Hun herhaalcontroles zagen uitsluitend
ongewijzigde records en nul events. De zorgparser scheidt organisatienamen van
persoons- en bestandsvelden; 178 verkeerd benoemde importorganisaties zijn via
KVK-identiteitsregels hersteld. De iBabs-keten heeft een begrensde OCR-naloop
voor scans zonder tekstlaag. De bronnenwacht meldt na herstel en gemotiveerde
uitschakelingen nul verdachte en nul dode bronnen.

De fase-5-leerloop legt redactionele besluiten idempotent vast met reden,
dimensie en bevroren context van tip, signalen, regels, bronnen en entiteiten.
Gepubliceerde artikelen worden eenmaal per canonieke URL geteld en vereisen een
expliciet oordeel of het verhaal zonder Stadsgeest was ontstaan. Het Jasper-only
leerscherm toont uitkomsten, steekproeven, ongebruikte signalen, brongezondheid
en maandreviews. Evaluaties zijn reproduceerbaar en wijzigen nooit automatisch
drempels, brongewichten, regels of rangschikking. Vrije feedbacktekst wordt na
24 maanden verwijderd; telbare categorieën blijven behouden.

R1–R16 blijven de beschermde regelidentiteiten. Zwaar archiefonderzoek gebruikt
een lokale incrementele FTS-kopie; Turso blijft de productiebron. Handmatige
kernseeds hebben bron-, reden- en reviewmetadata; merge, review en unmerge zijn
transactioneel en geaudit.

## Bewijsgrens en risico's

De leerdata bewijst reproduceerbaarheid, nog geen kwaliteitsverbetering of
causaliteit. Rapporteer cijfers pas vanaf 10 beoordelingen; overweeg handmatige
kalibratie vanaf 30; beoordeel een wijzigingsvoorstel pas vanaf 50 per bron of
regel én twee maandreviews. Een geleerd rankmodel blijft uit tot minimaal 200
voorbeelden, waaronder 50 positieve en 50 negatieve, plus expliciete menselijke
goedkeuring. De augustus-reviewcyclus staat nog open.

RVO-graphmatches, NDW-bufferrecords en experimentele Samen Meten-data behouden
hun onzekerheidswaarschuwing en menselijke beoordeling. Fase 1 blijft open tot
de organisatie-golden-set is afgerond.

Het Turso-leesquotum is 500 miljoen bekeken rijen per maand. Een overschrijding
legde productie op 26 september stil. Zware analyses en tekstsweeps horen daarom
op de lokale kopie; gerichte productiequeries volgen `DATABASE-LEZEN.md`.

Details: `PHASES/phase-5.md`, `EDITORIAL-LEARNING.md`, `NER.md` en
`ADRESKOPPELING.md`.
