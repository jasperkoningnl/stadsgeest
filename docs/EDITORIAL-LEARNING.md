# Redactionele leerloop en meting

**Doel:** blijvend contract voor feedback, evaluatie, privacy en aanpassing.
**Status:** productieactief vanaf 13 september 2026.
**Lees wanneer:** bij dashboardfeedback, kwaliteitsmeting of regelkalibratie.

## Eenheden en herkomst

Een tipbesluit en een artikeluitkomst zijn verschillende eenheden. Per tip telt
alleen het laatste niet-gedupliceerde besluit in een evaluatie. Een artikel telt
eenmaal op zijn canonieke Nieuwsplein33-URL, ook wanneer meerdere tips eraan
bijdragen. De ja/nee-attributie “zonder Stadsgeest” is verplicht en mag niet uit
een ontbrekend antwoord worden afgeleid.

Bij feedback wordt een onveranderlijke context opgeslagen met de toenmalige
signalen, regels, bronnen, entiteiten en onzekerheid. Daardoor zijn bron- en
regelevaluaties later reproduceerbaar zonder de huidige clustertoestand als
historische waarheid te gebruiken.

## Betekenis van labels

`bruikbaar` meet tipkwaliteit. `al_bekend` en `parkeren` meten timing.
`niet_lokaal` en `niet_relevant` meten redactionele relevantie. `duplicaat` en
`feitelijk_fout` meten tipkwaliteit; `bron_fout` en `verkeerd_geclusterd` hebben
ieder hun eigen dimensie. Deze categorieën mogen niet als één generiek negatief label
worden gebruikt om een bron af te waarderen.

Precisie is uitsluitend `bruikbaar / (bruikbaar + te_zwak + niet_lokaal +
niet_relevant + duplicaat + feitelijk_fout)`. Bekende of geparkeerde tips vallen
erbuiten, omdat zij niets bewijzen over inhoudelijke kwaliteit.

## Bewijsniveaus en verandering

- Onder 10 beoordelingen: onvoldoende voor rapportage.
- Vanaf 10: alleen beschrijvend.
- Vanaf 30: handmatige kalibratie mag worden onderzocht.
- Vanaf 50 voor dezelfde bron of regel en na twee maandreviews: een uitlegbaar
  wijzigingsvoorstel mag ter menselijke goedkeuring worden aangeboden.
- Een geleerd rangmodel vereist minstens 200 voorbeelden, waaronder 50
  positieve en 50 negatieve, offline vergelijking en expliciete goedkeuring.

Geen script past productiegedrag automatisch aan. Een voorstel bevat de oude en
nieuwe waarde, steekproef, periode, onzekerheid, verwacht effect en goedkeurder.
R1–R16 houden hun vaste betekenis; een inhoudelijk nieuw patroon krijgt een
nieuwe identiteit en detectorversie.

## Privacy en toegang

Feedback is uitsluitend zichtbaar voor ingelogde redacteuren; geaggregeerde
leer- en reviewinformatie is Jasper-only. Schrijf geen persoonsgegevens of
bronbescherming in vrije notities. Na 24 maanden wist de retentietaak vrije tekst
en anonimiseert zij de actor, maar behoudt zij categorie, tijd, herkomsthash en
telbare uitkomst voor trendcontrole. Retentieruns hebben een auditspoor.

## Maandreview

De maandreview controleert false positives, gemiste entiteiten en brongezondheid.
Zij registreert wie afrondde en wanneer, maar vraagt geen extra beoordeling per
tip. De review is geen toestemming voor automatische wijziging. Een periode met
weinig data blijft open als bewijsperiode; ontbrekende praktijkdata wordt nooit
door een veronderstelde succesvolle evaluatie vervangen.
