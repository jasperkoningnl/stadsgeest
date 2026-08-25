# Stadsgeest Weekreview — 1 augustus 2026

**Periode:** 26 juli t/m 1 augustus 2026
**Vorige review:** 29 juni 2026 (de reviews van 6, 13 en 20 juli zijn nooit gedraaid of nooit opgeslagen — zie probleem 4)

## Samenvatting van de week

De pipeline heeft in deze zeven dagen precies één dag gedraaid: 1 augustus. Op de zes dagen daarvoor is geen enkele routine uitgevoerd, waardoor de homepage acht dagen lang hetzelfde topartikel toonde en een backlog van 471 onverwerkte raw_items ontstond. De ene dag die wél draaide, verliep inhoudelijk sterk: twee artikelen gepubliceerd, een onjuiste briefing-premisse door de researcher weerlegd en door de schrijver rechtgezet, en twee feitfouten in ouder werk ontdekt. De uitvoeringskwaliteit is dus goed; de betrouwbaarheid van het draaien is het probleem.

## Statistieken

- **Runs uitgevoerd:** 5 (intake, speurder, researcher, schrijver, designer — alle op 1 augustus)
- **Dagen zonder runs:** 6 van 7 (25 t/m 31 juli)
- **Artikelen gepubliceerd:** 2
  - `art-houtstook-warmtenet-amersfoort-2026-08-01` (nieuws, ~490 woorden, 7 bronnen)
  - `art-weekanalyse-subsidiebesluiten-2026-08-01` (analyse, ~950 woorden, 10 bronnen)
- **Kandidaten geselecteerd maar niet gepubliceerd:** 1 — signaal 526 (Duurzaam Wonen Lening), gediscard door de researcher als duplicaat van een Stadsgeest-artikel van 4 juni
- **Signalen afgevoerd:** 16 (watching ouder dan 7 dagen zonder nieuwe activiteit)
- **Nieuwe signalen aangemaakt:** 34 (14 op 'new', 20 backlog direct op 'watching')
- **Harde fouten/mislukte runs:** 1 (weekreview van vorige week, auth-fout) + 1 stille publicatiefout die binnen de run is hersteld
- **Databasestand einde week:** 371 discarded, 83 published, 29 watching, 11 new, 0 researching

## Terugkerende problemen (gesorteerd op impact)

### 🔴 Hoge prioriteit

**1. De pipeline heeft zes van de zeven dagen niet gedraaid** — 1× deze week, na een eerdere uitval van 25 juli t/m 31 juli — ⚠️ al bekend, urgenter geworden
STATUS.md meldde op 24 juli dat alle stadsgeest-taken op `enabled: false` stonden. Bij controle vandaag staan de vier bestaande taken (speurder, researcher, schrijver, designer) op `enabled: true` met een geldige `nextRunAt` voor 2 augustus — dus de tasks zijn ergens heractiveerd. Toch is er tussen 24 juli en 1 augustus niets gedraaid. Dat wijst niet op de task-configuratie maar op de omgeving: als de notebook uit staat of Cowork niet draait, vuurt de cron niet en wordt de gemiste run ook niet ingehaald.
*Fix:* dit is niet in een prompt op te lossen. Ofwel de pipeline verhuist naar een altijd-aan omgeving, ofwel er komt een dagelijkse melding wanneer `lastRunAt` van een stadsgeest-task ouder is dan 36 uur. Zie ook actie 1 voor Jasper.

**2. Er bestaat geen `stadsgeest-intake` scheduled task** — structureel — nieuw
De intake is de eerste stap van de pipeline (raw_items → signalen) maar staat niet in de scheduled-tasks lijst. De lijst bevat exact vier stadsgeest-routines: speurder (09:15), researcher (10:15), schrijver (11:15), designer (12:00). De intake-run van 1 augustus is dus handmatig of via een andere sessie getriggerd. Zonder intake produceren de andere vier routines niets — de speurder analyseert dan een bevroren signalenvoorraad.
*Fix:* maak `stadsgeest-intake` aan als scheduled task, dagelijks rond 08:30 (ná scrape-dagelijks van 07:00, vóór de speurder van 09:15). De prompt bestaat al; `scraper/intake-run.mjs` is de standalone fallback.

**3. Documentatie en werkelijkheid lopen sterk uiteen** — structureel — nieuw
De projectinstructies en STATUS.md beschrijven tien actieve stadsgeest-taken met tijden 00:10 / 01:01 / 02:04 / 06:05 / 07:05 plus vijf middagvarianten. In werkelijkheid bestaan er vier taken, op heel andere tijden, en geen enkele middagvariant. Iedereen die op die documentatie stuurt (Claude Chat, Code, toekomstige Cowork-sessies) redeneert vanaf een verkeerd beeld.
*Fix:* de sectie "Cowork Scheduled Tasks" in STATUS.md en de tabel in de projectinstructies vervangen door de werkelijke vier taken met hun echte cron-tijden. Middagvarianten expliciet als "verwijderd" markeren in plaats van als "gepauzeerd".

**4. De weekreview zelf draait niet** — 4 gemiste weken — nieuw
`stadsgeest-weekreview` staat op `enabled: false`. De laatste opgeslagen review is van 29 juni. De run die daarna wel startte (sessie `ba5cbb22`) is direct afgebroken met: *"Your organization has disabled Claude subscription access for Claude Code — use an Anthropic API key instead."* Er is geen rapport en geen foutmelding buiten dat transcript.
*Fix:* task heractiveren en de auth-fout uitzoeken. Zolang die fout terugkeert, faalt de review stil — de enige zichtbare uitkomst is een ontbrekend bestand in `weekreviews/`.

**5. Twee feitfouten in een gepubliceerd artikel, geen rectificatie op het origineel** — 1× — nieuw
De researcher stelde vast dat het Stadsgeest-artikel van 4 juni over de Duurzaam Wonen Lening twee fouten bevat: de lening is niet rentevrij maar heeft 1,7–2% rente, en de startdatum is 28 juli, niet 25 juli. De schrijver heeft de correctie opgenomen in het nieuwe weekanalyse-artikel van 1 augustus. Het foute artikel van 4 juni staat echter ongewijzigd online.
*Fix:* voeg aan de schrijver-prompt toe: *"Wanneer de research een feitfout in een eerder Stadsgeest-artikel vaststelt, is de correctie in het nieuwe stuk niet voldoende. PATCH altijd óók het oorspronkelijke Sanity-document: corrigeer de feitelijke tekst en voeg een entry toe aan `updates[]` met datum en de formulering 'Correctie: [wat er onjuist stond] — [wat juist is].'"* En doe dit alsnog handmatig voor het juni-artikel.

### 🟡 Gemiddelde prioriteit

**6. De archiefcheck van de speurder kijkt alleen naar titels** — 1× deze week, patroon — nieuw
Signaal 526 werd als losse kandidaat geselecteerd terwijl het onderwerp al gepubliceerd was (4 juni) én al opgenomen zat in weekanalyse 546. De researcher moest het weggooien. De speurder verspilde een van zijn drie kandidaatslots; de researcher verspilde een onderzoeksronde.
*Fix (speurder, stap archiefcheck):* *"Zoek in het Sanity-archief niet alleen op de kop van het signaal maar ook op de kernentiteiten uit het summary-veld (regeling, bedrag, organisatie, straat). Controleer daarnaast of het onderwerp al voorkomt in een openstaand WEEKANALYSE-signaal van deze week; is dat zo, dan is het geen aparte kandidaat."*

**7. De speurder toetst datums niet, waardoor een briefing op een onjuiste premisse rustte** — 1× — nieuw
De briefing van weekanalyse 546 luidde "Nieuw college opent subsidiekraan: zes regelingen in twee weken". De researcher haalde de acht onderliggende collegebesluiten op en constateerde het tegendeel: zes van de acht dateren van 7 juli of eerder, vóór de collegewissel van 8 juli — vier ervan uit één vergadering op de laatste dag van het oude college. De invalshoek moest volledig worden omgedraaid. Dat de keten dit ving is goed nieuws, maar de fout was aan de bron vermijdbaar.
*Fix (speurder, weekanalyse-stap):* *"Bij een weekanalyse die een oorzakelijk verband legt met een gebeurtenis (collegewissel, verkiezing, besluit), controleer eerst de vaststellingsdatum van elk onderliggend besluit tegen de datum van die gebeurtenis. Noem in de briefing per onderdeel de datum. Leg geen verband dat je niet op datum kunt onderbouwen."*

**8. Grote Sanity-mutaties worden stil afgekapt in PowerShell** — 1× — nieuw
De eerste publicatiepoging van het weekanalyse-artikel faalde zonder foutmelding: de JSON-payload werd bij verzending naar PowerShell afgekapt. De schrijver loste het op door de body in zes patches te splitsen. Zonder die opmerkzaamheid was er een leeg of half artikel gepubliceerd.
*Fix (schrijver-prompt):* *"Verstuur nooit een Sanity-mutation met een payload groter dan ongeveer 4.000 tekens in één PowerShell-call — die wordt stilzwijgend afgekapt. Splits de body in blokken en publiceer met opeenvolgende patches. Verifieer na afloop altijd met een GROQ-query dat het aantal body-blokken in Sanity gelijk is aan wat je verstuurde."*

**9. Nextdoor en Reddit leveren structureel niets bruikbaars op** — 6 van 6 kandidaten deze en vorige run — nieuw als patroon
Bij alle vier kandidaten van 24 juli en beide van 1 augustus vond de researcher geen enkele citeerbare lokale stem, ondanks gerichte zoekopdrachten. Dit is inmiddels de regel, niet de uitzondering. Er gaat per kandidaat onderzoekstijd naar een stap die vrijwel nooit rendeert.
*Fix:* degradeer de Nextdoor/Reddit-stap in de researcher-prompt van verplicht naar "één zoekopdracht, bij nul resultaten direct door". Zoek de journalistieke meerwaarde liever in de raadsinformatie (schriftelijke vragen, moties, ingekomen stukken) — die bron is tier 1 en levert wél consistent materiaal.

**10. destadamersfoort.nl blokkeert geautomatiseerde toegang (403)** — 1× deze week, terugkerend — ⚠️ al bekend, breidt uit
De drie obstakels rond het warmtenetcontract konden niet geverifieerd worden omdat de bron 403 geeft. De schrijver heeft de claim daarom terecht weggelaten uit het artikel — inhoudelijk juist gehandeld, maar het kost wel substantie. STATUS.md meldde dit eerder al voor amersfoort.nl en raadsinformatie.nl.
*Fix:* onderzoek of de bestaande Playwright-route (`run-browser.js`) ook voor destadamersfoort.nl gebruikt kan worden, zoals eerder voor raadsinformatie is gedaan.

### 🟢 Lage prioriteit / nice to have

**11. Geen bruikbaar standaardbeeld voor bestuursnieuws** — ⚠️ al bekend (STATUS.md, 1 augustus)
De designer heeft nu tweemaal een compromisbeeld moeten kiezen (Eemhuis in plaats van stadhuis). Op Wikimedia Commons bestaat geen bruikbare kleurenfoto van het Amersfoortse stadhuis; vier "Stadhuisplein"-bestanden blijken verkeerd getagd.
*Fix:* zie actie 3 voor Jasper.

**12. AI-illustratie is structureel onbeschikbaar** — ⚠️ al bekend
`OPENAI_API_KEY` ontbreekt in zowel `scraper/.env` als `stadsgeest033/.env.local`. Beeldroute 3D is daarmee permanent dicht. Tot nu toe geen praktisch probleem — elk artikel kreeg een grafiek, kaart of foto — maar het vangnet ontbreekt.

**13. Rekenfout in de research bleef staan** — 1×
De buurtbudget-optelling in de briefing was intern tegenstrijdig (555.900 + 20.000 organisatiekosten tegenover een wijktabel die op 575.900 uitkomt). De schrijver ving het op door alleen het totaal te noemen. De researcher zou zo'n tegenstrijdigheid zelf moeten signaleren.
*Fix (researcher-prompt):* *"Als je een bedrag opsplitst, tel de onderdelen op en vergelijk met het genoemde totaal. Klopt het niet, meld dat expliciet als ⚠️ in de research-aanvulling in plaats van beide getallen naast elkaar te zetten."*

**14. Entity-schema wijkt af van de intake-instructies** — ⚠️ al bekend
De instructies noemen `amount`, `legal_ref`, `kvk_number` en `project`; de CHECK-constraint staat alleen `person`, `organization`, `location` en `address` toe. `project` wordt gemapt naar `organization`, `amount` en `legal_ref` gaan verloren.

## Promptverbeteringen voorgesteld

**stadsgeest-speurder**
- *Huidig gedrag:* archiefcheck alleen op titel, waardoor al gepubliceerde onderwerpen opnieuw als kandidaat worden geselecteerd (signaal 526).
- *Voorgestelde toevoeging:* zie fix bij probleem 6.
- *Huidig gedrag:* weekanalyses leggen oorzakelijke verbanden zonder de datums van de onderliggende besluiten te controleren (signaal 546).
- *Voorgestelde toevoeging:* zie fix bij probleem 7.

**stadsgeest-researcher**
- *Huidig gedrag:* verplichte Nextdoor/Reddit-zoektocht die in zes van zes gevallen niets oplevert.
- *Voorgestelde wijziging:* één zoekopdracht per kandidaat, bij nul resultaten direct door; raadsinformatie (schriftelijke vragen, moties, RIB) toevoegen als verplichte vervangende stap.
- *Huidig gedrag:* geeft opgesplitste bedragen door zonder controlesom.
- *Voorgestelde toevoeging:* zie fix bij probleem 13.

**stadsgeest-schrijver**
- *Huidig gedrag:* corrigeert feitfouten in het nieuwe artikel maar laat het foute originele artikel ongewijzigd.
- *Voorgestelde toevoeging:* zie fix bij probleem 5.
- *Huidig gedrag:* verstuurt grote mutation-payloads in één call, die stil worden afgekapt.
- *Voorgestelde toevoeging:* zie fix bij probleem 8.

**stadsgeest-designer**
- Geen promptwijziging nodig. De routine handelde deze week volgens de regels: verouderd topartikel binnen stap 0 gedowngraded, kleurcheck uitgevoerd, geen gokwerk bij twijfelachtige beelden.

## Bronperformance

**Beste bronnen deze week**
- Officiële bekendmakingen / collegebesluiten (tier 1) — leverden de acht onderliggende besluiten waarmee de researcher de weekanalyse kon onderbouwen én de premisse kon weerleggen. Alle harde bedragen komen hiervandaan.
- gemeente.nl (tier 2) — betrouwbare corroboratie bij subsidie- en beleidssignalen.
- ACM (tier 1) — leverde de tariefcontext bij het warmtenetverhaal, al haalde die niet het artikel.
- rechtspraak (tier 1) — werkt technisch goed, maar de zaak van deze week (opkoopbescherming) bleek Utrecht te betreffen, niet Amersfoort.

**Bronnen die weinig opleverden**
- Nextdoor en Reddit — 0 bruikbare citaten in zes kandidaten over twee runs.
- destadamersfoort.nl — 403 op geautomatiseerde toegang; wel bruikbaar als detectiesignaal, niet als leesbare bron.
- Bluesky/AD (tier 3) — signaal 537 (salarisverhoging bestuurders) bleef hangen op gebrek aan tier 1/2-bevestiging.
- Wikimedia Commons voor Amersfoort-specifiek beeld — vier lege zoekopdrachten op biomassacentrale, warmtebedrijf en rioolwaterzuivering.

**Aandachtspunten**
- Tier-3-only signalen blijven structureel steken op watching. Signaal 519 (petitiestrijd Stadsring) is breed online gedekt maar heeft geen enkele Amersfoortse tier 1/2-bron. Overweeg of een expliciet gelabeld "onbevestigd, alleen tier 3"-artikel journalistiek verantwoord is, of dat deze signalen definitief moeten worden afgevoerd in plaats van eindeloos te blijven wachten.
- De rechtspraak-scraper haalt zaken binnen die niet over Amersfoort gaan. Een filter op arrondissement plus expliciete gemeentenaam scheelt de speurder werk.

## Wat goed ging

1. **De keten corrigeert zichzelf.** De speurder leverde een briefing met een onjuiste premisse; de researcher haalde de primaire besluiten op en weerlegde die; de schrijver draaide de invalshoek om en publiceerde het juiste verhaal. Precies waarvoor de gelaagde opzet bedoeld is.
2. **Niets wordt ingevuld wat niet is gevonden.** In elke run wordt expliciet gemeld wat níet gevonden is — geen lokale stemmen, geen raadsvragen, geen vergelijkingscijfers — in plaats van het aan te vullen met aannames. De schrijver liet ook de onverifieerbare "drie obstakels" weg. Dit is de belangrijkste kwaliteitseigenschap van de pipeline en moet zo blijven.
3. **De designer handhaaft de harde regels zonder aansporing.** Het acht dagen oude topartikel werd in stap 0 direct gedowngraded, de kleurcheck leidde tot vier afgekeurde kandidaten, en er is geen enkel beeld geplaatst dat de kwaliteitstoets niet doorstond.

## Status-check

- **Problemen al opgelost:** 2
  - PM2-daemon lag stil sinds 5 juli (19 dagen geen scrape-data) — ✅ opgelost op 2026-07-24 via `pm2 resurrect` + handmatige inhaalrun
  - Alle stadsgeest scheduled tasks op `enabled: false` — ✅ deels opgelost: de vier bestaande routines staan nu op `enabled: true` met geldige `nextRunAt`. De weekreview-task staat nog op `false` (zie probleem 4)
- **Problemen al bekend:** 4
  - Sites die geautomatiseerde toegang blokkeren (403) — nu ook destadamersfoort.nl, urgenter geworden
  - Geen bruikbare kleurenfoto van het stadhuis op Wikimedia Commons
  - `OPENAI_API_KEY` ontbreekt, AI-illustratie structureel onbeschikbaar
  - Entity-schema CHECK-constraint wijkt af van de intake-instructies
- **Nieuwe bevindingen:** 8 (problemen 2, 3, 4, 5, 6, 7, 8, 9 — plus 13 als kleine variant)

## Acties voor Jasper

1. **Beslis over de draaiomgeving.** De pipeline draaide zes van zeven dagen niet, en dat is dit kwartaal al de derde langere uitval (5–13 juli scrapers, 5–24 juli PM2-daemon, 25–31 juli hele pipeline). Cron op een notebook die niet altijd aanstaat, haalt gemiste runs niet in. Ofwel de routines verhuizen naar een altijd-aan omgeving, ofwel er komt een simpele dagelijkse melding wanneer een task langer dan 36 uur niet is gedraaid. Zonder een van beide blijft dit terugkeren.
2. **Los de auth-fout op die de weekreview blokkeert.** *"Your organization has disabled Claude subscription access for Claude Code"* — de review van vorige week is hierop stukgelopen en er is vier weken geen rapport geschreven. Zet de task daarna weer op `enabled: true`.
3. **Maak een eigen kleurenfoto van het stadhuis of Stadhuisplein.** De designer loopt hier bij elk bestuursartikel op vast. Eén bruikbare foto in Sanity lost dat structureel op.
4. **Corrigeer het artikel van 4 juni over de Duurzaam Wonen Lening.** Twee feitfouten staan nog online: "rentevrij" (moet zijn 1,7–2% rente) en startdatum 25 juli (moet zijn 28 juli). De correctie staat nu alleen in het nieuwe stuk van 1 augustus.
5. **Bevestig of de middagroutines definitief weg zijn.** Ze staan nog in de projectinstructies en in STATUS.md, maar bestaan niet meer als scheduled task. Als ze niet terugkomen, kan de documentatie worden opgeschoond; als wel, moeten ze opnieuw aangemaakt worden.

---
*Weekreview uitgevoerd op 2026-08-01. Gebaseerd op de transcripten van de runs van 1 augustus (speurder, researcher, schrijver, designer), de runs van 24 juli als vergelijkingsmateriaal, de actuele output van `list_scheduled_tasks` en een kruischeck met STATUS.md.*
