# De Woo Factor — eerste proef

**Datum:** 17 oktober 2026. **Beoordelaar:** Codex (AI), geen redactioneel besluit.
**Selectie:** drie bestaande dossiers uit de lokale kopie van 17 oktober,
09:55 UTC. Geen actuele productiesweep. De kopie kan latere toevoegingen missen.

## Resultaten voor de redactie

| Dossier | Onderzochte informatie | Uitkomst | Voorstel |
|---|---|---|---|
| Gemeentefinanciën Amersfoort | Onderbouwing terugvordering wijkteams over 2025 | Onderbouwde informatieleemte, bestaan onderliggende stukken afgeleid | Beoordeel gericht concept over vaststelling, verantwoording en capaciteitsafspraken; verdieping bestaande tip 63 |
| Wind op Isselt | Extern veiligheidsonderzoek bij de vergunningaanvraag | Document gevonden | Lees het openbare onderzoek; geen Woo-verzoek voor dit rapport |
| Parkeerbeleid Amersfoort | Interne mails over afzonderlijke uitbreidingen | Onvoldoende aanwijzingen voor een nieuw verzoek | Bestaand Woo-besluit lezen; alleen met nieuwe aanwijzingen verder |

## 1. Wijkteams: gericht op de terugvordering

De [Zomerrapportage 2026](https://api.notubiz.nl/document/17198704/2)
verbindt het financiële voordeel aan een terugvordering over 2025 en aan minder
ingezette capaciteit. Het [auditadvies](https://api.notubiz.nl/document/17210897/1)
vraagt om beter inzicht in de gevolgen voor beleidsdoelen. Dat rechtvaardigt een
onderzoeksvraag, geen conclusie dat noodzakelijke hulp is uitgebleven.

**Technische controle:** bronitems 6124 en 6125 bevatten volledige tekst;
38 respectievelijk 2 pagina's zijn rechtstreeks opnieuw opgehaald en uitgelezen.
Er zijn voor deze items geen losse bijlagen of deelitems geregistreerd. De
bijlagenzoekslag op wijkteamtitels leverde een ander, goed verwerkt stuk op.
Geen vastgesteld download- of OCR-probleem verklaart deze leemte. Dit bewijst
niet dat alle gemeentelijke bijlagen zijn geïndexeerd.

**Online controle:** gezocht op wijkteams, Amersfoort, verantwoording,
kwartaalrapportage, subsidievaststelling, 2025 en 2026, inclusief de gemeentelijke
Woo-publicaties. De officiële wijkteamsite, bestuurspagina, ‘Wijkteam van
Waarde’, financiële stukken en de gemeentelijke Woo-instructie zijn bekeken.
Openbare jaarstukken geven wel bredere financiële en uitvoeringscontext; de
gezochte onderliggende afrekening en capaciteitsafspraken zijn daarbij niet
aangetroffen. De verhalenbundel is geen financiële afrekening.

**Beoordeling:** een terugvordering maakt onderliggende verantwoordings- en
afrekenstukken aannemelijk. Een specifieke beschikking of rapporttitel is niet
expliciet vastgesteld. De gemeente is de vermoedelijke houder van de door haar
ontvangen verantwoording en eigen vastlegging van de afrekening; geen aanname
dat de zelfstandige stichting rechtstreeks onder de Woo valt.

**Afbakening concept:** bestaande stukken over verantwoording 2025,
vaststelling/terugvordering en de daarbij gebruikte capaciteit- en
prestatieafspraken, opgesteld of ontvangen van 1 januari 2025 t/m 17 oktober
2026. Geen cliëntdossiers, individuele personeelsgegevens of opdracht tot een
nieuwe analyse. Een gewone informatievraag aan de gemeente is ook mogelijk.

**Tegenverklaring:** vacatures kunnen extra uitbreiding betreffen; lagere
kosten en uitstelbaar werk bewijzen geen gemiste noodzakelijke hulp. De
vergaderingssamenvatting is alleen zoekcontext, geen zelfstandig bewijs.

## 2. Isselt: ontbrekend in de eerste lezing is niet ontbrekend in het openbaar

Het [externe veiligheidsonderzoek](https://api.notubiz.nl/document/17386606/1)
staat al als bronitem 12150 met 83.753 tekens tekst in de kopie. De rechtstreekse
controle leverde HTTP 200, 56 pagina's en leesbare tekst op. De
[gemeentelijke projectpagina](https://www.amersfoort.nl/wind-op-isselt)
is eveneens bereikbaar. Er is voor dit bronitem geen los bijlagen- of deelrecord.
Een naburig bronitem 12151 heeft alleen agendametadata: dat maakt het gevonden
veiligheidsonderzoek niet ontbrekend en is geen grond om dit rapport op te vragen.
Dit oordeel betreft uitsluitend dit rapport, niet ieder mogelijk intern advies.

## 3. Parkeerbeleid: eerder Woo-besluit blokkeert een herhaalverzoek

Bronitem 13587 bevat [Woo-besluit 601169 van 7 oktober 2026](https://amersfoort.bestuurlijkeinformatie.nl/Document/View/c0ba2ec8-c5a5-42aa-ad15-e1b65363318f).
Bijlage 2424 heeft status `ok`; rechtstreeks opnieuw ophalen leverde HTTP 200
en drie leesbare pagina's op. Het besluit beschrijft interne uitvraag na
precisering en geen aangetroffen inhoudelijke e-mails binnen die reikwijdte.
Openbare besluitvorming en mogelijk oud materiaal bij Archief Eemland zijn
alternatieve routes. Dit is geen bewijs dat er nooit mails bestonden.
Zoeken op zaaknummer en onderwerp leverde geen nieuwe dragende aanwijzing op.
Zonder zo'n aanwijzing volgt geen nieuw concept met dezelfde reikwijdte.

## Bewijsbestanden en grenzen

De lokale query-uitvoer, gerichte passages en rechtstreekse broncontroles staan
genegeerd onder `scraper/tmp/kopie/woo-*.json` en `woo-*.sql`. Rechtstreekse
responses bewaren URL, eind-URL, tijdstip, HTTP-status en SHA-256; bij PDF's ook
paginatal en uitgelezen tekst. De eerste netwerkpoging binnen de sandbox
mislukte; de directe controle buiten die beperking slaagde. Geen netwerkfout
is gebruikt als bewijs dat een document niet bestaat.

De machineleesbare analyses bevatten de zoekvragen en beperkingen. Geen
exhaustieve doorzoeking van alle gemeentelijke systemen, geen toezegging van
openbaarmaking, geen redactionele goedkeuring en geen verzending. De proef
toont één kandidaat en twee nuttige afwijzingen; dat is geen gemeten
kwaliteitsverbetering. De uitvoering volgt [het functiecontract](WOO-FACTOR.md).
