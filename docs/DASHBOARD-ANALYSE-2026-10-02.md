# Analyse redactiedashboard Nieuwsplein33 — 2 oktober 2026

**Doel:** volledige doorlichting van `/nieuwsplein33` (wachtrij, tippagina,
dossiers, beheer) met een plan op volgorde van winst, plus een bronnenanalyse
voor Amersfoort en Leusden.
**Status:** voorstel voor Jasper; geen van de genoemde wijzigingen is gebouwd.
**Lees wanneer:** bij het kiezen van dashboardwerk voor oktober. Niet in de
standaard leesroute.

Basis: alle code onder `src/app/nieuwsplein33/` en `src/lib/dashboard/`, de
documentatie, en gerichte tellingen op de kleine tabellen `tips`, `tip_feedback`,
`dossier_facts` en `sources` (samen minder dan 700 rijen gelezen).

## 1. Waar het dashboard staat

| Meting (2 oktober) | Waarde |
|---|---|
| Tips sinds 7 augustus | 70 (26 nieuwsfeit, 29 verdieping, 13 patroon, 2 dossiersignaal) |
| In de wachtrij | 38, waarvan 31 ouder dan een week en 18 ouder dan een maand |
| Goedgekeurd of in behandeling | 3 |
| Gepubliceerd | 2 |
| Geparkeerd | 8 |
| Afgewezen | 19 (9× geen nieuwswaarde, 4× al bekend, 2× te dun) |
| Leusden | 9 van de 70 tips |
| Dossiers | 22 met 330 feiten, 273 daarvan officieel |
| Feedback op het dashboard zelf | 1 bericht sinds 24 augustus |
| Bronrijen | 163, ruim 110 actief |

De belangrijkste conclusie staat niet in de code maar in deze cijfers: de
informatie per tip is rijk en goed opgebouwd, maar de redactie handelt de
tips niet af. Meer dan de helft van alles wat ooit is aangemaakt staat nog in
de wachtrij en het meetpunt van de testperiode staat op 2 van de beoogde 3 tot
5 artikelen. Elke verbetering moet daarom één van twee dingen doen: de
beslissing per tip sneller en lichter maken, of de wachtrij vanzelf dunner
houden. Meer informatie toevoegen aan de tip helpt pas daarna.

## 2. Voorpagina (wachtrij)

**Wat goed werkt.** Dagkopjes, de supertip bovenaan, de dossierstrook met
"+n deze week", de meldingen rechts, de kaart in dezelfde vormtaal als de
tippagina. De lege staat en de foutafhandeling bij een Turso-blokkade zijn
netjes.

**Wat beter kan.**

1. **De kaart is te lang voor 38 stuks.** Titel, kern, een volledig
   "Waarom"-blok, bronchips en een documentregel maken elke kaart acht tot
   tien regels. Bij 38 tips is de wachtrij vooral scrollen. Voorstel: standaard
   compact (labels, titel, kern, bronnen op één regel) en het "Waarom" alleen
   op de tippagina, waar het nu ook staat onder "Hoe dit is gevonden".
2. **"Eerder" is een vergaarbak.** Achttien tips zijn ouder dan een maand en
   staan onopvallend tussen de rest. Voorstel ter beslissing: na 30 dagen in
   de wachtrij klapt een tip in onder een kopje "Ouder dan een maand" met één
   knop "alles hier afsluiten als niets mee gedaan" (met reden `oud_nieuws`),
   of de wekelijkse supertip-run zet ze zelf op `niet_gebruikt`. Dat houdt de
   wachtrij eerlijk en de leerloop gevoed; nu leert het systeem niets van een
   tip die stilletjes veroudert.
3. **Beslissen vanuit de lijst.** Een redacteur moet nu per tip naar de
   detailpagina. Een klein beslismenu op de kaart (oppakken, parkeren,
   afwijzen met redenkeuze in een popover) haalt de drempel weg voor de
   helft van de gevallen, die op titel en kern al te beoordelen zijn.
4. **Wie pakt het op.** Met vijf redactieaccounts toont "Mee bezig" niet wie
   een tip heeft opgepakt. De naam staat al in `tip_feedback`; toon hem op de
   kaart en in de lijst. Klein werk, groot verschil voor afstemming.
5. **Score is onzichtbaar maar bepaalt wel de volgorde.** Binnen een dag
   staat de sterkste tip bovenaan, maar de redacteur ziet dat niet. Toon de
   score als stil getal of laat de volgorde binnen een dag op soort of tier
   lopen. Een keuze voor Jasper; het huidige midden is het minst uitlegbaar.
6. **Twee kleine filters** zouden nuttig zijn nu het soortfilter weg is: alleen
   Leusden (9 tips, dunne bezetting) en alleen tips die nog nergens zijn
   gebracht (geen spiegelbron). Beide zijn al bekend in de data.
7. **Nieuw sinds je laatste bezoek.** Een markering per browser (localStorage,
   zoals bij het logboek) laat een redacteur die twee dagen weg was meteen
   zien wat erbij kwam.

## 3. Tippagina

**Wat goed werkt.** Het verhaal in blokken (weten, niet weten, context, zo kom
je verder, eerdere berichtgeving, let op, wie), bronchips met host en
documentnummer, namen als chips naar de verkenner, de documenten per spoor,
de wegingstabel, de dossiertab, de meetknop en de append-only geschiedenis.
Alle 70 tips hebben briefing, vervolgvragen, herkomst en weging; 53 hebben een
"elders gebracht"-veld en 51 een dossier. De parser is tolerant en valt
zichtbaar terug op platte tekst.

**Wat beter kan.**

1. **De snelle beslisknoppen in de vaste balk doen niets (bug).**
   `BeslisNavigatie.tsx` stuurt geen `request_id` en geen reden mee; de route
   `/api/tip/[id]/beslis` weigert dat met 400 en de component slikt de fout
   in (`if (!res.ok) return`). Oppakken, Parkeren en Afwijzen bovenaan lijken
   te werken maar slaan niets op. Dit is de eerste reparatie.
2. **Eén beslisflow in plaats van twee.** Naast de vaste balk staat het
   volledige redenpaneel (`TipActies`). Twee knoppenrijen voor dezelfde
   handeling verwarren, en de snelle variant zou de reden missen die de
   leerloop nodig heeft. Voorstel: de vaste balk opent hetzelfde redenpaneel
   als popover; na "Vastleggen" ga je automatisch naar de volgende tip (nu
   blijf je op de pagina). Toetsen voor volgende, vorige en de drie keuzes.
3. **Kopiëren en delen.** De redactie werkt in mail en Slack. Een knop
   "Kopieer als tekst" (titel, kern, feiten met bronlinks, vervolgvragen) en
   een mailto-link kosten weinig en worden direct gebruikt.
4. **Vervolgvragen als werklijst.** "Zo kom je verder" is nu een opsomming.
   Afvinkbare punten (per browser, zonder databasewrite) maken het een
   werkdocument tijdens het uitzoeken.
5. **Namen leiden naar een dure zoekactie.** Elke klik op een naamchip doet
   zeven query's, waaronder `LIKE` over `raw_items`; `DATABASE-LEZEN.md` noemt
   de verkenner al als bekend probleem. Voorstel: de verkenner zoekt eerst in
   `kg_entities`, aliassen en `document_mentions` (geïndexeerd) en doorzoekt
   `raw_items` alleen op uitdrukkelijk verzoek ("zoek ook in alle
   documenten").
6. **Status `in_behandeling` is onbereikbaar.** De UI kent alleen
   "goedgekeurd"; het onderscheid is dood gewicht of mist een knop "ik ben
   hiermee bezig". Kies één van beide.
7. **De gepubliceerde tip toont geen artikel.** Na de meetknop staat de
   artikel-URL alleen in het invulveld. Toon hem als chip in de kop, zodat de
   lijst en de tip laten zien welk stuk eruit kwam.

## 4. Dossiers

**Wat goed werkt.** Het overzicht met maandstrook, de tijdas met zekerheid als
kleur, filters via de URL, feiten per maand met bron- en tipchips, de graaf
met een eerlijke verantwoording. Het is de rijkste laag van het dashboard en
grotendeels onbekend bij de redactie: de dossierstrook boven de wachtrij
bestaat pas sinds 1 oktober.

**Wat beter kan.**

1. **De dossierpagina begint met het verkeerde.** Afbakening, dan tips, dan de
   tijdas, dan filters, en pas daarna de feiten. Voorstel: tijdas direct onder
   de kop, tips naar een eigen tab naast Feiten en Graaf, de nieuwste feiten
   meteen zichtbaar.
2. **Geen "waar staat het".** Een dossier mist een korte stand van zaken. De
   goedkoopste vorm: het nieuwste feit als eerste regel in het overzicht en in
   de kop van het dossier ("laatste ontwikkeling: …"). De duurdere vorm: de
   weger onderhoudt per dossier drie regels stand van zaken naast de
   afbakening.
3. **Feitenlijst meenemen.** Een redacteur die een stuk schrijft wil de
   feiten met bronnen in zijn tekstverwerker. "Kopieer feitenlijst" (met het
   actieve filter) is één knop en vervangt handmatig overtikken.
4. **Partijen als ingang.** De graaftabel somt partijen op; maak van elke
   partij een chip naar de verkenner, zoals bij "Wie hierin voorkomen". De
   graaf zelf verder uitbouwen loont pas als de entiteitskoppeling meer
   bevestigde partijen oplevert; dat staat in de verantwoording zelf.
5. **Een feit melden.** Dossiers zijn puur lezend, en dat moet zo blijven,
   maar "dit feit klopt niet" als korte melding naar Jasper (via de bestaande
   feedbacktabel) voorkomt dat fouten blijven staan.
6. **Overzicht toont de omschrijving niet.** Eén regel afbakening per dossier
   in het overzicht maakt duidelijk wat "milieu" of "politiek" hier betekent.

## 5. Beheer

**Wat goed werkt.** Verbruik als standaardtab zonder databasereads, laden per
tab, intake-trechter, weging met afgewezen signalen, de leerloop met
bewijsdrempels, de twee controlewachtrijen.

**Wat beter kan.**

1. **Het ontbrekende tabblad is "Redactie".** Beheer meet de machine, niet de
   doorstroom. Juist die bepaalt nu het succes: tips per week gemaakt
   tegenover afgehandeld, mediane tijd tot eerste beslissing, ouderdom van de
   wachtrij, beslissingen per gebruiker. Alle data staat in `tips`,
   `tip_feedback` en `tip_events`; de tabellen zijn klein.
2. **De weekmail klopt niet meer met de schaal.** `scoreKleur` in
   `src/app/api/weekmail/route.ts` kleurt vanaf 80, 60 en 40 punten, terwijl
   tips rond de 6 tot 20 scoren: alles is grijs. De mail gaat naar twee van de
   vijf redactieaccounts en toont alle tips van de week ongeacht status.
   Voorstel: alleen wachtrij en supertip, de juiste kleurdrempels, ontvangers
   in een omgevingsvariabele.
3. **Golden set staat op 0 van 200.** De controle onder Controleren is een
   klus zonder ritme. Een dagelijkse portie van tien kandidaten met
   toetsenbediening, en een teller in de navigatiestip, maakt het haalbaar.
4. **Feedbackbalk komt zelden.** Hij verschijnt pas na een drempel aan
   beslissingen per dag, die nu zelden wordt gehaald; vandaar één bericht in
   zes weken. Een vaste, kleine "Opmerking?"-link in de kop is eerlijker dan
   de balk.

## 6. Techniek en opmaak dwars door alles heen

- Elke pagina is `force-dynamic` en de kop doet per weergave drie query's;
  bij deze tabelgroottes is dat in orde. De verkenner is de enige zware
  lezer (zie 3.5).
- Twee tabsystemen (tippagina client-side, dossier server-side via routes)
  en twee werkbalken ogen gelijk maar gedragen zich anders. Dat kan blijven,
  maar nieuwe tabs horen de dossiervariant te volgen: deelbaar via URL.
- `globals.css` is ruim 2.500 regels met de persbureau-voorpagina, het
  redactiedashboard en oudere artikelstijlen door elkaar. Een splitsing in
  `np.css` voor het dashboard, zoals `woon.css` al apart staat, maakt
  wijzigen veiliger.
- Er zijn geen frontendtests. De briefingparser (`briefing.ts`) en de
  naamontleding (`TipBlokken.tsx`) zijn pure functies en verdienen een kleine
  testset met echte briefings als fixture; een nieuw briefingformat van de
  weger breekt anders stil de tippagina.
- Mobiel is bruikbaar; de vaste beslisbalk en de graaf zijn de twee plekken
  om op 390 px na te lopen.

## 7. Plan op volgorde van winst

Stap 1 is een bugreparatie en kan los; stappen 2 tot en met 5 zijn zichtbare
productkeuzes en vragen Jaspers akkoord vooraf (werkafspraak in `AGENTS.md`).

| # | Wat | Winst | Omvang | Afhankelijk van |
|---|---|---|---|---|
| 1 | Snelle beslisknoppen repareren: `request_id` meesturen, afwijzen vraagt reden, fout tonen | Beslissen bovenaan werkt echt; leerloop blijft gevoed | 1 bestand, 1 route | niets |
| 2 | Eén beslisflow met popover, daarna automatisch naar volgende tip, toetsen | Doorlooptijd per tip omlaag | `BeslisNavigatie`, `TipActies` | 1 |
| 3 | Compacte kaart, naam van wie oppakte, filters Leusden en "nog nergens gebracht", nieuw-sinds-bezoek | Wachtrij in één blik te overzien | `TipRegel`, `page.tsx`, `tipQueries` | akkoord Jasper |
| 4 | Veroudering: groep "ouder dan een maand" met één afsluitknop, of automatisch `niet_gebruikt` via de supertip-run | Wachtrij blijft eerlijk, 18 tips weg uit het zicht | wachtrij of `supertip-run` | keuze Jasper |
| 5 | Dossierpagina herordenen: tijdas boven, tips als tab, nieuwste feit in kop en overzicht, kopieer feitenlijst | Dossiers worden werkmateriaal | `dossiers/*` | akkoord Jasper |
| 6 | Beheer-tab Redactie: doorstroom en ouderdom | Jasper ziet het echte knelpunt wekelijks | `beheerQueries`, nieuwe tab | niets |
| 7 | Verkenner eerst via entiteiten en vermeldingen, `raw_items` op verzoek | Minder Turso-reads per klik op een naam | `verkennerQueries` | niets |
| 8 | Kopieer als tekst op tip en dossier; artikelchip bij gepubliceerde tip | Kleine dagelijkse gemakken | tippagina | niets |
| 9 | Weekmail: kleurschaal, alleen wachtrij, ontvangers in env | Mail klopt weer | `weekmail/route.ts` | niets |
| 10 | Tests voor briefingparser en naamontleding; CSS splitsen | Veiliger wijzigen | `scraper/__tests__`, css | niets |

Buiten dit plan, maar het grootste hefboom van allemaal: de wachtrij wordt pas
korter als de redactie er dagelijks vijf minuten in zit. Een korte
ochtendmelding (de tips van vandaag plus de supertip, via de bestaande
Resend-route) is goedkoper dan welke dashboardwijziging ook en ondersteunt
stappen 1 tot en met 4.

## 8. Bronnen: wat er al is en wat Amersfoort nog mist

**Al gedekt (hoofdlijnen).** Gemeente en raad Amersfoort (bekendmakingen per
soort, raadsstukken via ORI, moties via RaadKijker, B&W-besluitenlijsten,
iBabs met Woo-bijlagen), Leusden (bekendmakingen, Notubiz, moties), KOOP
niet-gemeentelijk (Staatscourant, Provinciaal blad, Waterschapsblad, GR-blad),
provincie, waterschap, ODU en VRU als nieuwsbron, rekenkamer, GR's, subsidies,
TenderNed met winnaars, rechtspraak, Raad van State, insolventies, NVWA, LRK,
DUO, Onderwijsinspectie, AFM, DNB, ACM, AP, Arbeidsinspectie, asbest, Liander,
NDW, politie/CBS, RVO, ANBI, GLEIF, OSM, OpenKvK, zorgjaarverantwoording,
dPi, monumenten, SEVESO, tuchtrecht, UWV, CBS, spiegels (De Stad, Eemland1,
RTV Utrecht, amersfoort.nieuws.nl, Nieuwsplein33).

**Niet of nauwelijks gedekt, op volgorde van waarde.** Alle suggesties volgen
de broncriteria uit het uitbreidingsplan: openbaar, machineleesbaar, zonder
betaalde sleutel, formele stukken boven nieuwspagina's.

1. **Provinciale Staten en Gedeputeerde Staten Utrecht — vergaderstukken.**
   De provincie wordt nu alleen via haar nieuwspagina gevolgd (bron 39,
   negen berichten per keer). De Statenstukken staan in Open
   Stateninformatie, dezelfde API die `raadsinformatie-ori.js` al leest:
   index `osi_provincie-utrecht_*`, 375.000 documenten; sinds januari 2026
   zijn er 132 stukken met "Amersfoort" in naam of tekst (gecontroleerd op 2
   oktober, bijvoorbeeld de Kadernota 2027-2030 en het MIP Mobiliteit). Het
   bronsysteem zelf is GemeenteOplossingen, geen iBabs of Notubiz; via de
   OSI-index is dat niet relevant. Inhoud: Statenvoorstellen, GS-brieven,
   schriftelijke Statenvragen, Kadernota en begroting, OV-concessie,
   knooppunt Hoevelaken en A1/A28, Westelijke ontsluiting, natuur en stikstof
   rond Leusderheide en Heuvelrug, Regionale Energiestrategie, provinciale
   subsidies. Bouw: een tweede pass in de ORI-scraper met tekstfilter op
   Amersfoort, Leusden, Hoevelaken, Eemland, Vathorst, Isselt; stukken ouder
   dan een week als achtergrond. Omvang: één pass plus bronrij; geen nieuwe
   infrastructuur.
2. **Provinciaal subsidieregister.** De provincie publiceert jaarlijks wie
   subsidie kreeg; de pagina gaf vanuit deze omgeving een 403 (Cloudflare),
   vanaf de notebook vermoedelijk niet. Het past direct in `subsidies` naast
   het gemeentelijke register en voedt `organisatie_verbanden` (rol geld).
   Verifieer het bestandsformaat en de licentie eerst.
3. **Leusder Krant en De Stadsbron als spiegelbron.** Beide staan in
   `EDITORIAL-PROFILE.md` als spiegel maar hebben geen bronrij. Zonder
   Leusder Krant kan de weger bij Leusdense tips de "al bekend"-controle niet
   doen, en vier van de negentien afwijzingen waren juist "al bekend".
   RSS of HTML, een middag werk.
4. **Woo-besluiten van rijk en provincie over Amersfoort.** Het platform
   open.overheid.nl bundelt Woo-publicaties van alle bestuursorganen
   (ministeries over de Bernhardkazerne, spoor, COA-opvang, de provincie over
   Amersfoortse dossiers). De SRU-ingang met product-area `woo` gaf vanuit
   hier nul records; de juiste collectie- of API-naam moet nog worden
   vastgesteld. Zelfde scanmethode als de iBabs-Woo-bijlagen, dus de
   zware termenlijst is herbruikbaar.
5. **Waterschap Vallei en Veluwe — bestuursstukken.** Nu alleen nieuws (bron
   12) en het Waterschapsblad via KOOP. Het algemeen bestuur publiceert
   vergaderstukken (dijkversterking Eem, rioolwaterzuivering Amersfoort,
   droogte; er is al een dossier droogte). Controleer of ook dit via Open
   Raadsinformatie wordt ontsloten; anders het bestuursinformatiesysteem van
   het waterschap.
6. **Autoriteit woningcorporaties — oordeelsbrieven.** De ILT publiceert per
   corporatie jaarlijks een oordeel over governance en financiën. Voor De
   Alliantie, Portaal en Omnia Wonen is dat een formele, gedateerde bron die
   nu ontbreekt en direct in het woningbouwdossier past.
7. **B&W-besluitenlijsten Leusden.** Amersfoort heeft bron 131; Leusden niet,
   terwijl het redactieprofiel Leusden als dun bezet gebied noemt. Controleer
   of de besluitenlijsten in de Notubiz-omgeving van Leusden (organisatie
   2090) staan; zo ja, is het een extra categorie in `notubiz-leusden.js`.
8. **IGJ-rapporten opnieuw aanzetten.** Bron 46 staat uit omdat de zoekpagina
   JavaScript-gerenderd is. IGJ publiceert toezichtdocumenten met
   vestigingsplaats op een apart documentenportaal; onderzoek of dat een
   open zoekingang heeft. Zorgtoezicht is een kernthema in het redactieprofiel
   en er is al een dossier zorgtoezicht.
9. **DUO financiële gegevens per schoolbestuur.** DUO publiceert jaarlijks
   open data over baten, lasten, solvabiliteit en liquiditeit per bestuur.
   Samen met de bestaande leerlingaantallen en inspectieoordelen maakt dat
   een patroonregel mogelijk: krimp plus zwak oordeel plus dalende
   solvabiliteit. Jaarlijkse bron, lage last.
10. **Didam-publicaties als detectieregel.** Geen nieuwe bron maar een
    classificatie binnen bron 111: de gemeente moet elk voornemen tot
    verkoop of uitgifte van grond en vastgoed publiceren. Die publicaties
    noemen partij, locatie en vaak de prijsvorm en zijn vrijwel altijd nieuws.
    Nu verdwijnen ze tussen "Gemeenteblad overig".
11. **Nationale ombudsman — rapporten over Amersfoort en Leusden.** Beide
    gemeenten vallen onder de Nationale ombudsman; rapporten zijn zeldzaam
    maar altijd een verhaal. Wekelijks zoeken op gemeentenaam volstaat.
12. **Meldingen collectief ontslag (UWV, per arbeidsmarktregio).** Maandelijkse
    cijfers per regio Amersfoort; alleen als trendcontext, geen tipdrager.

**Bewust niet voorgesteld.** Kadaster-transacties en KVK-deponeringen (betaald,
uitgesloten in het uitbreidingsplan), EP-online en Huurcommissie (sleutel of
JavaScript nodig, staan al als lege bronrij), sociale media buiten Bluesky en
Reddit, en nieuwspagina's van instanties die al via formele stukken binnenkomen.

**Volgorde.** Begin met 1 en 3: beide hergebruiken bestaande scrapers, kosten
geen Turso-leesbudget van betekenis en raken direct de twee zwakke plekken in
de huidige dekking, namelijk de bestuurslaag boven de gemeente en de
"al bekend"-controle voor Leusden. Daarna 2 en 6 voor de geldstromen, en 4 en 8
zodra de ingang is geverifieerd.
