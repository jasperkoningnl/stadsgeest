# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** actueel per 13 september 2026.
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

## Laatste verificatie en bewijsgrens

De productiedatabase bevat 30 historische feedbackregels. Eén exacte dubbele
handeling is gemarkeerd en telt niet mee. Alle feedback heeft nu een bevroren
context. Er is één unieke gepubliceerde artikeluitkomst, expliciet gemarkeerd
als een vondst die zonder Stadsgeest niet was ontstaan; ontbrekende of dubbele
artikeluitkomsten zijn nul.

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

Details staan in `PHASES/phase-5.md` en `EDITORIAL-LEARNING.md`.
