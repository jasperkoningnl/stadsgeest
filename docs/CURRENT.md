# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** vaste tekst, bijgewerkt 4 november 2026. Tellingen staan
in `STAND.md` (`npm run stand`).
**Lees wanneer:** bij iedere nieuwe taak. Historische details staan elders.

## Productie

Stadsgeest maakt journalistieke signalen en tips voor Amersfoort en Leusden.
Publieke bronrecords, events en entiteiten voeden signalen, weger, tips en
dossiers. Vercel host `stadsgeest.nl/nieuwsplein33`; Jaspers Windows-notebook
voert de operationele keten uit. Het dashboard bevat een beslisflow,
bulkafsluiting, entiteitenverkenner en Beheer > Redactie.

`Stadsgeest Detection` staat momenteel dagelijks om 05.15 uur gepland; NDW draait daarin wekelijks mee. Na de dagrun volgen de geplande fase-5-maandevaluatie en
privacyretentie. Adapter-, evaluatie- en retentiefouten zijn geïsoleerd en
idempotente invoer levert geen dubbele uitkomsten op. Het laatste resultaat per
taak staat in `STAND.md`; dode proceslocks worden opgeruimd. De gecombineerde
detectierun heeft een heaplimiet van 1,5 GB.

Intake hervat bestaande besluiten en bronkoppelingen zonder extra bevestiging
of signaalverversing. Verbroken leesverbindingen krijgen begrensde herkansing;
onzekere writes niet. Uitvoer en foutdetails staan in `scraper/logs/intake-*`.
Het stiltealarm controleert de laatste uitkomst én het laatste geslaagde einde.

OpenKvK staat tijdelijk uit wegens een verlopen abonnement. Hervatten kan met
`STADSGEEST_ENABLE_OPENKVK=1` en heractivering van de bron, na herstel van het
abonnement; de bestaande gegevens en dagcursor blijven behouden. Zie `SOURCES.md`.

De supertip-run draait donderdag om 09.00 uur en schrijft hoogstens één tip met
`supertip = 1`; nul is geldig. Een supertip blijft tot de maandag erna bovenaan.
Alleen deze run mag het veld zetten.

De weger gebruikt `redactioneel-2`: onderzoeksvragen eerst, daarna signaaltriage.
De schrijfvalidator bewaakt voorwaarden, ontdekking, bewijs en gevolgen.
Oudere scores blijven intact. Een afzonderlijke dagelijkse onderzoekstaak volgt
open vragen en eerder aangehouden signalen op en verkent daarnaast zelfstandig
een onderzoeksspoor. Voortgang en herbeoordeling staan in `research_cases` met
een append-only audit. Voldoende onderbouwde vondsten kunnen direct een tip of
gecontroleerde aanvulling opleveren volgens `operations/ONDERZOEK.md`. Het oudere
lokale onderzoeksprototype blijft een afzonderlijk hulpmiddel.

## Actieve oplevering

Woo-onderzoek: [functiecontract](WOO-FACTOR.md).

Fase 0 en 2 zijn gesloten. Fase 1 heeft operationele baselines voor ANBI, GLEIF
en OpenStreetMap en BAG-koppelingen met expliciete uitzonderingen. De organisatie-
golden-set vereist 200 menselijke beoordelingen en 98% precisie; zie `STAND.md`.

Fase 3 en 4 zijn productieactief. De zorgparser scheidt organisaties van persoons-
en bestandsvelden; importnamen zijn via KVK-identiteit hersteld. iBabs heeft een
begrensde OCR-naloop voor scans. De bronnenwacht meldt dode bronnen, herhaald
falende scrapers en lang stille tier-1-bronnen.

Documenten boven 200.000 tekens hebben sinds 3 oktober deelitems (`#deel=N`,
tabel `raw_item_parts`): verwerkt en historisch; tel ze niet als losse stukken.

Sinds 2 oktober leest de keten ook de Statenstukken van de provincie Utrecht
(alleen stukken over Amersfoort of Leusden, tier 1); de Leusder Krant en De
Stadsbron zijn spiegelbron (bronnen 165 en 166, sinds 3 oktober).

R5 vergelijkt stijgende en dalende misdaadregistraties over drie en twaalf
maanden met een jaar eerder en Nederland. Gemeenten krijgen ook aantallen per
1.000 inwoners; wijken niet. Mogelijke locatieclusters en registratiewijzigingen
houden hun waarschuwingen. Details en terugtests: `PHASES/phase-3.md`.

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

De weger bereidt bij geselecteerde signalen documentverbanden voor via actuele
bronstukken en het lokale archief: zaakkenmerken, specifieke agendacontext en
inhoudelijke titelwoorden, met gerichte passages en oorspronkelijke datums.
Fractienamen en bestuurlijke sjabloonwoorden dragen geen kandidaat. Codex
beoordeelt document-, zaak- en dossieridentiteit afzonderlijk, inclusief
onvoldoende informatie. Gewijzigde archiefpartners vallen weg. De bevroren
Jev-pilot kan daarnaast gecontroleerde context leveren. De voorbereiding doet
geen betaalde API-aanroepen, nieuwe signalen, merges of scorewijzigingen.
Jev blijft een afzonderlijk gestart vergelijkingshulpmiddel met een gezamenlijk
proefbudget. Codex-controle heeft herkomst `ai` en telt niet als menselijke
golden set of redactionele feedback.

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
