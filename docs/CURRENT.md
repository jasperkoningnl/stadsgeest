# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** actueel per 26 september 2026.
**Lees wanneer:** bij iedere nieuwe taak. Historische details staan elders.

## Productie

Stadsgeest is de lokale journalistieke signalerings- en tipmachine voor
Amersfoort en Leusden. De keten loopt van publieke bronnen via bronrecords,
events, entiteiten, signalen en de weger naar tips, dossiers en het
redactiedashboard op `stadsgeest.nl/nieuwsplein33`. Vercel host het dashboard;
Jaspers Windows-notebook voert de operationele keten uit.

De dagelijkse taak `Stadsgeest Detection` start om 06.15 uur. NDW draait apart
iedere vijftien minuten. Na iedere dagelijkse detectierun worden de geplande
fase-5-maandevaluatie en privacyretentie uitgevoerd. Adapter-, evaluatie- en
retentiefouten zijn van elkaar geïsoleerd; dezelfde invoer levert geen dubbele
metingen of uitkomsten op.

Iedere donderdag om 09.00 uur draait de supertip-run: een Claude-taak in
Cowork op Jaspers notebook met de prompt `stadsgeest-werk\PROMPT-supertip.md`.
Die kiest één spoor, duikt het archief in en schrijft hoogstens één tip met
`tips.supertip = 1` weg; nul is een geldige uitkomst. Het dashboard zet een
supertip bovenaan de wachtrij tot de maandag erna. Alleen deze run mag
`supertip` zetten; `weger-apply.cjs` dwingt dat af via `run: "supertip"`.

De dagelijkse taak en de NDW-taak eindigen met resultaatcode 0. Een dode
proceslock wordt direct herkend en opgeruimd. De gecombineerde detectierun heeft
een heaplimiet van 1,5 GB.

De fase-0-audit is groen. Ook fase 2 is gesloten: de productie-replay vond 37
graph-afhankelijke signalen en nul R3-matches zonder graphcontext. Zes bestaande
vergunningrecords zijn exact via BAG aan lokale organisaties gekoppeld.

## Afgeronde implementatie

Fase 3 en fase 4 zijn productieactief. De vereiste fase-4-herhaalcontrole is op
13 september voltooid: alle acht adapters zagen uitsluitend ongewijzigde
records en schreven nul events. Alleen governance liep eerst tegen een
geïsoleerde timeout aan; de directe gerichte herhaling zag 17 ongewijzigde
records en nul events. `audit-phase4.cjs` is groen. De audit leest nu ook het
werkelijk gevonden recordaantal; deze reparatie verandert geen fase-4-gedrag.

De fase-5-leerloop is technisch en operationeel opgeleverd:

- goedkeuren, parkeren en afwijzen leggen een idempotent besluit, een
  afzonderlijke reden/dimensie en een bevroren koppeling naar tip, signalen,
  regels, bronnen en entiteiten vast;
- gepubliceerde artikelen worden eenmaal per canonieke Nieuwsplein33-URL
  geteld, kunnen aan meerdere tips hangen en vereisen een expliciet ja/nee op
  “hadden we dit zonder Stadsgeest gehad?”;
- het beheerscherm heeft een tab Leren met uitkomsten, redenen, bron- en
  regelsteekproeven, ongebruikte signalen, onzekerheidslabels en een compacte
  maandreview voor false positives, gemiste entiteiten en brongezondheid;
- evaluaties zijn reproduceerbaar op periode en invoerhash. Zij wijzigen geen
  drempel, brongewicht, regel of rangschikking automatisch;
- feedbacknotities zijn alleen voor ingelogde redacteuren zichtbaar; het
  leer-/reviewscherm blijft Jasper-only. Vrije tekst wordt na 24 maanden gewist
  en de actor geanonimiseerd, terwijl telbare categorieën behouden blijven.

De fase-1-bronnen ANBI, GLEIF en OpenStreetMap zijn operationeel gebaselined.
ANBI leest het actuele XML-bestand van de Belastingdienst (707 lokale records),
GLEIF gebruikt de actuele fulltext-API met exact lokaal nafilter (2.073 records)
en OSM gebruikt de correcte gemeentegrenzen (15.521 contextobjecten). Directe
herhalingen leverden voor alle drie nul wijzigingen en nul events op.

De zorg-ODS-parser scheidt organisatienamen nu van persoons- en bestandsvelden.
178 verkeerd benoemde importorganisaties zijn hersteld uit KVK-identiteitsregels.

De iBabs-bijlagenketen heeft nu een begrensde Tesseract-OCR-naloop voor scans
zonder tekstlaag. De eerste productierun herstelde één document; mislukte scans
stoppen na twee pogingen. De bronnenwacht staat na herstel van onder meer
Rijksoverheid, Bluesky, De Alliantie, drie cultuurbronnen en UWV op nul
verdachte en nul dode bronnen. De niet-renderende brede Reddit-stroom r/Utrecht
en vier bronnen zonder unieke lokale opbrengst zijn gemotiveerd uitgeschakeld.

Handmatige kernseeds hebben bron-, reden- en reviewmetadata. Merge/review en
unmerge zijn transactioneel en geaudit. De BAG-backfill koppelde 79 van 82
locaties exact; drie niet-eenduidige gevallen zijn vastgelegd. In Beheer staat
onder Controleren een Jasper-only beoordelingsscherm voor de resterende
handmatige golden set.

## Laatste verificatie en bewijsgrens

De productiedatabase bevat 38 feedbackregels. Eén exacte dubbele handeling is
gemarkeerd en telt niet mee; 37 regels blijven over, verdeeld over 29 tips met
een actueel besluit. Alle feedback heeft een bevroren context. Er zijn twee
unieke gepubliceerde artikeluitkomsten; ontbrekende of dubbele uitkomsten zijn
nul.

De identieke rollende evaluatie over 17 augustus–14 september leverde tweemaal
evaluatie 4 en invoerhash
`668e7d2537f0010445d07bc53cc17effd4bbc9c5eee80c4fd81fcd169549522d`.
Zij bevat 23 unieke beoordeelde tips, waarvan 8 bruikbaar. De maandmeting over
augustus bevat 15 beoordelingen. Dit is uitsluitend beschrijvend bewijs: geen
bron of regel haalt de minimumsteekproef en één artikel bewijst geen causale
verbetering.

De beschermde regelidentiteiten blijven R1–R16. In het bijzonder zijn R5
misdrijfanomalie, R10 multibronversterking, R11 leerlingontwikkeling, R12
schoolprognose, R13 Onderwijsinspectie en R14 verkeersmaatregel ongewijzigd.

## Databasequotum

Gratis Turso-quotum: 500 mln bekeken rijen per maand, daarna worden alle reads
geweigerd (26/9 gebeurd; tot 1/10 Developer-plan). Beheer > Verbruik bewaakt
dit. Doorzoek de hele database nooit rechtstreeks op Turso.

## NER en adressen

Los van de KG, dagelijks: zie `NER.md` en `ADRESKOPPELING.md`.

## Open bewijs en risico's

1. Verzamel meerdere maandcycli en echte redactionele uitkomsten. Pas vanaf 10
   beoordelingen wordt een cijfer gerapporteerd, vanaf 30 mag handmatige
   kalibratie worden overwogen en vanaf 50 per bron/regel én twee maandreviews
   mag een wijzigingsvoorstel worden beoordeeld.
2. Een geleerd rankmodel blijft buiten gebruik tot ten minste 200 voorbeelden,
   waaronder 50 positieve en 50 negatieve, plus expliciete menselijke
   goedkeuring. Er is nu geen bewijs voor zelfoptimalisatie.
3. De ene positieve “zonder Stadsgeest”-uitkomst is een productiemeting, geen
   aangetoonde verbetering tegenover de baseline. De afsluitvoorwaarde van fase
   5 blijft daarom observationeel open.
4. RVO-graphmatches, NDW-bufferrecords en experimentele Samen Meten-data houden
   hun bestaande onzekerheidswaarschuwing en menselijke beoordeling.
5. Onbekende niet-gevolgde bestanden blijven buiten de fase-5-wijziging.
6. Fase 1 blijft open op de handmatig gelabelde organisatie-golden-set: 0 van
   200. Het dashboard bevat 223 naamvariant-versus-organisatieparen om met ja,
   nee of “weet ik niet” te beoordelen; alleen ja en nee tellen mee.
7. De augustus-reviewcyclus van fase 5 staat nog open. Het totaal is groot
   genoeg voor een handmatige, productbrede analyse, maar nog niet voor een
   automatische of bron-/regelspecifieke kalibratie.

Details staan in `PHASES/phase-5.md` en `EDITORIAL-LEARNING.md`.
