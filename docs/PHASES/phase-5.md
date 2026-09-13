# Fase 5 — redactionele leerloop

**Status:** productierijp geïmplementeerd op 13 september 2026; de vereiste
observatie voor aantoonbare verbetering loopt nog.

## Opgeleverd

### Betrouwbare feedback

Ieder besluit krijgt een door de browser herbruikbaar verzoek-ID. Een herhaling
maakt daardoor geen tweede feedbackregel. De actuele beslissing per tip telt;
historische en heropende beslissingen blijven controleerbaar. Afwijzen vereist
een reden. Redenen zijn gescheiden in:

- tipkwaliteit: te zwak, duplicaat of feitelijke fout;
- bronkwaliteit: een aantoonbaar bronprobleem;
- clustervorming: verkeerde samenvoeging of scheiding;
- timing: al bekend of parkeren;
- redactionele relevantie: niet lokaal of niet relevant;
- artikeluitkomst: gepubliceerd met expliciete attributie.

Bij elk besluit wordt de toenmalige herkomst bevroren: tip, signalen,
detectieregels, bronnen, entiteiten en onzekerheid. Latere wijzigingen aan een
cluster herschrijven dit bewijs niet.

### Artikeluitkomsten zonder dubbeltelling

Een artikelresultaat vereist een geldige `nieuwsplein33.nl`-URL en een expliciet
ja of nee op “hadden we dit zonder Stadsgeest gehad?”. Trackingparameters en
fragments verdwijnen uit de canonieke URL. Eén artikel kan aan meerdere tips
worden gekoppeld maar telt eenmaal; conflicterende attributie wordt geweigerd.
Ontbrekende antwoorden worden niet als nee geïnterpreteerd. Zowel uitkomst als
koppeling heeft een append-only eventspoor.

### Reproduceerbare evaluatie en menselijke controle

`run-phase5-evaluation.cjs` maakt een vaste kalendermaandmeting of een expliciete
rollende meting. Periode, beleidsversie, metrics en hash van de gebruikte rijen
worden opgeslagen; identieke invoer hergebruikt dezelfde evaluatie. Rapportage
toont totaal, reden/dimensie, bron, regel, unieke artikeluitkomsten en ongebruikte
signalen. Kleine steekproeven hebben een zichtbaar onzekerheidslabel.

Het Jasper-only beheerscherm toont deze cijfers en een maandreview met drie
verplichte controles: false positives, gemiste entiteiten en brongezondheid.
Een review-ID voorkomt dubbel afronden. De interface gebruikt dezelfde korte
beslissingen die redacteuren al nemen en voegt buiten de artikelvraag geen
dagelijkse administratie toe.

Er is geen automatische zelfoptimalisatie. De vaste grenzen zijn:

| Gebruik | Minimum |
|---|---:|
| Beschrijvend rapporteren | 10 beoordelingen |
| Handmatige kalibratie overwegen | 30 beoordelingen |
| Bron- of regelwijziging voorstellen | 50 per bron/regel en 2 maandcycli |
| Geleerd rangmodel overwegen | 200, met minstens 50 positief en 50 negatief |

Een voorstel bevat bewijs en blijft concept totdat een mens het goedkeurt.
Productiecode past geen brongewicht, drempel of regel zelfstandig toe.

### Privacy, retentie en planning

Besluitdata en categorieën zijn redactionele kwaliteitsgegevens. Vrije notities
zijn optioneel, niet publiek en worden na 24 maanden gewist; actornamen worden
dan geanonimiseerd. `retain-phase5-feedback.cjs` draait standaard als dry-run en
alleen in de dagelijkse taak met `--apply`. Iedere retentierun wordt vastgelegd.
De evaluatie en retentie draaien na detectie en zijn onderling foutgeïsoleerd.

## Productiebewijs op 13 september 2026

- fase-4-herhaalrun: acht bronnen ongewijzigd, nul events; geïsoleerde
  governance-timeout gevolgd door 17 ongewijzigde records en nul events;
- migratie tweemaal identiek: 30 feedbackregels en 1 artikeluitkomst;
- fase-5-audit: nul verweesde of ongeldig gehashte feedbackcontexten, nul
  ongeldige toegepaste kalibraties en nul ontbrekende of dubbele
  artikeluitkomsten;
- rollende evaluatie tweemaal exact evaluatie 4 met dezelfde invoerhash, 23
  unieke beoordelingen en 8 bruikbare tips;
- augustusmeting: evaluatie 1, 15 beoordelingen, status `descriptive`;
- retentie-dry-run: nul verlopen feedback- of dashboardnotities;
- fixtures beschermen deduplicatie, attributie, dimensies en de vaste identiteit
  van R1–R16; schema-integratie controleert alle additieve tabellen en indexen.

## Wat nog niet geconcludeerd mag worden

Geen bron- of regelsteekproef is groot genoeg voor kalibratie. Slechts één uniek
artikel heeft een expliciete positieve Stadsgeest-attributie. Daarmee is het
mechanisme productiegeschikt, maar zijn hogere precisie, betere brondekking en
causale redactionele meerwaarde nog niet aangetoond. Er worden daarom geen
gewichten, drempels, detectieregels of rangmodellen aangepast.

**Afsluitvoorwaarde:** de implementatievoorwaarden zijn gehaald. De fase wordt
pas ook op effect gesloten wanneer voldoende echte redactionele data over
meerdere maandcycli aantoonbare verbetering tegenover de baseline laat zien,
zonder verlies van provenance, uitlegbaarheid of menselijke controle.
