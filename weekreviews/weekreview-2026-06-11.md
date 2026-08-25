# Stadsgeest Weekreview — 11 juni 2026

## Samenvatting van de week

De pipeline draaide stabiel van 3 t/m 6 juni met ~25 bevestigde runs en 13 gepubliceerde artikelen plus 1 update. De kwaliteitsborging verbeterde zichtbaar: meerdere promptfixes zijn doorgevoerd en de designer-rotatieplicht werkt correct. Het grootste structurele probleem is Signal 98 (Rekenkamer 2015), dat de gehele week op 'researching' bleef staan ondanks drievoudige bevestiging dat het geen nieuwswaarde heeft — geen enkele routine nam de verantwoordelijkheid het te discareden. Secundair probleem: de OB-scraper importeert regelmatig historische bekendmakingen (2016–2021) als nieuwe items, wat elke speurderrun vervuilt.

---

## Statistieken

- **Runs bevestigd:** ~25 runs (3–6 juni; juni 7–9 niet of nauwelijks zichtbaar in transcripten)
- **Artikelen gepubliceerd:** 13 + 1 update
  - 3 juni: marathon-hitte, stroomnet-prioritering, gasexplosie Everard Meysterweg (+ update overlijden bewoner)
  - 4 juni: thuisonderwijs, parkeer-bezwaren, explosiegolf-analyse, stroomnet-woningbouw
  - 5 juni: starterslening, zakkenrollen, bijplaatsingen, geboortecijfers, meedoenbalie Van Dale
  - 6 juni: inclusie stadsgesprekken
- **Kandidaten niet gepubliceerd:** 1 persistent (Signal 98 Rekenkamer 2015), ~2 watching (treinongeval, Musicians Paradise festival)
- **Signalen afgevoerd:** ~36+ (niet-Amersfoort, verouderd, duplicaten, historische OB-documenten)
- **Fouten/mislukte runs:** 2 inhoudelijke fouten (zie Hoge prioriteit), 2 lege intake-middagruns (timing), 1 missing Unsplash-key

---

## Terugkerende problemen

### 🔴 Hoge prioriteit

**Signal 98 (Rekenkamer 2015) wordt nooit gediscarded** — 3× gezien (researcher 4 juni, researcher-middag 5 juni, researcher 6 juni) — De researcher bevestigt elke run dat de rapporten uit 2015 dateren en geen nieuwswaarde hebben, maar zet het signaal niet op 'discarded'. De schrijver doet het evenmin. Het signaal bezet elke run een researching-slot en krijgt een waarschuwing mee die verder nergens op wordt gehandeld.

Concrete fix: Voeg aan zowel de researcher- als schrijver-prompt toe:
> "Als een signaal in jouw onderzoek geen nieuwswaarde blijkt te hebben (verouderde data, al gepubliceerd, buiten scope), zet je het signaal zelf op 'discarded' via de database. Geef de reden mee in de summary. Je hoeft hier geen toestemming voor te vragen."

**Schrijver publiceerde artikel met verkeerde status bewoner** — 1× gezien (4 juni) — De schrijver publiceerde het explosie-artikel met "bewoner zwaargewond" in de titel, terwijl de briefing van de speurder het overlijden als feit #4 vermeldde. De schrijver had dit als TYPE: update van het bestaande artikel moeten herkennen en verwerken, maar hield vast aan het TYPE-veld ("nieuw artikel" voor criminele explosies). Jasper corrigeerde dit handmatig.

Concrete fix: Toevoegen aan schrijver-prompt onder TYPE-veld instructie:
> "Ongeacht het TYPE in de briefing: als de briefing een statuswijziging beschrijft van een persoon in een bestaand artikel (zwaargewond → overleden, verdachte → veroordeeld, etc.), geef dit altijd prioriteit als TYPE: update. Zoek het bestaande artikel op in Sanity en patcht het. Een TYPE-veld in de briefing is een voorkeur, geen harde instructie."


### 🟡 Gemiddelde prioriteit

**OB-scraper importeert historische bekendmakingen als nieuwe items** — 2× gezien (speurder 5 juni, speurder 6 juni) — Signal 197 (Huisvestingsverordening 2020) had 49 items in 24u, maar dit waren bekendmakingen uit 2016–2021. Op 6 juni discardde de speurder 3 signalen (197, 178, 205) puur wegens verouderde data uit de OB-scraper. Dit vervuilt de pipeline structureel en kost analysecapaciteit.

Concrete fix (Jasper of Cowork technisch): Voeg een datumfilter toe aan de OB-scrapers zodat alleen bekendmakingen ≤30 dagen oud worden geïmporteerd. Controleer `officielebekendmakingen-split.js` op een `dcterms.issued` of `publicationDate` filter. Als dit niet via de API kan, voeg dan een post-processingstap toe in `lib.js` die items ouder dan 30 dagen weggooit vóór opslag.

**Intake-middag loopt consistent leeg** — 2× gezien (5 juni, 6 juni) — De intake-middag draait om 11:36, maar de scraper `scrape-dagelijks` draait om 13:00. Op beide dagen vond de intake-middag 0 nieuwe items ("scrapers zijn waarschijnlijk nog niet gedraaid"). De run is niet nutteloos (soms zijn er morning scraper-resultaten), maar de timing is suboptimaal.

Concrete fix: Verschuif `stadsgeest-intake-middag` van 11:36 naar 14:00 via de scheduler, zodat de 13:00-scraper zijn data altijd heeft aangeleverd. Dit geeft de analist-middag om 12:02 wél iets om op te reageren mits de ochtendrun items had achtergelaten.

**UNSPLASH_ACCESS_KEY niet beschikbaar in Cowork-omgeving** — 1× gezien (designer-middag 3 juni) — Designer meldde: "Geen UNSPLASH_ACCESS_KEY gevonden in omgeving — Unsplash overgeslagen." De key staat in `scraper/.env` maar Cowork tasks lezen die omgeving niet.

Concrete fix (Jasper): Voeg UNSPLASH_ACCESS_KEY toe aan de omgevingsvariabelen van de Cowork scheduled tasks. Dit is waarschijnlijk een `.env`-bestand of systeemvariabele buiten de scraper-map. Controleer waar Cowork tasks hun environment vandaan halen.

**Schrijver nam briefing-conclusie te letterlijk over (stroomnet)** — 1× gezien (3 juni) — De briefing sprak van "aansluitstop in Amersfoort", maar de researcher toonde aan dat Amersfoort in congestiegebied 1b valt (geen stop, wel prioritering). De schrijver verwerkte de correctie, maar de fout in de briefing werd al als headline gebruikt.

Concrete fix: Voeg aan de schrijver-prompt toe:
> "Als de research-aanvulling een feitelijke correctie bevat op de briefing (gemarkeerd met ⚠️ of 'correctie'), pas je altijd de kop en lead aan op basis van de gecorrigeerde informatie, ook als de briefing een andere invalshoek suggereerde."


### 🟢 Lage prioriteit / nice to have

**Entiteitsdatabase groeit langzaam** — De schrijver noteert consistent "Niet-gevonden entiteiten" (Stedin, TenneT, Provincie Utrecht, Marathon Amersfoort, etc.) na publicatie. Dit zijn legitieme Amersfoortse actoren die ontbreken in de database. Geen acuut probleem maar het beperkt het crossref-systeem.

Concrete fix: Voeg een stap toe aan de schrijver-prompt: "Maak ontbrekende organisaties automatisch aan in Turso als je ze tegenkomt in een artikel (naam + sanity_id). Gebruik INSERT OR IGNORE."

**Signalen in 'watching' zonder doorstroom** — Signal 95 (treinongeval Stoutenburgerlaan) en Signal 100 (Musicians Paradise) staan al meerdere dagen op 'watching' zonder dat er nieuwe bevestigingen binnenkomen. De speurder herhaalt ze elke run als "meer onderbouwing nodig" maar onderneemt geen actie.

Concrete fix: Voeg aan de speurder-prompt toe: "Signalen die ≥5 dagen watching zijn zonder nieuwe items en geen T1/T2-bron hebben: discard, tenzij er een concrete reden is om te wachten."

---

## Promptverbeteringen voorgesteld

**stadsgeest-researcher + stadsgeest-schrijver**
- Huidig gedrag: Signalen die geen nieuwswaarde hebben (verouderde data, etc.) worden herhaaldelijk gerapporteerd maar nooit gediscarded. De status 'researching' blijft hangen.
- Voorgestelde toevoeging: Voeg aan beide prompts toe onder "Wat te doen na de run":
  > "Een signaal dat je na research als geen nieuwswaarde beoordeelt (verouderde data bevestigd, incident buiten Amersfoort, al gepubliceerd, etc.) zet je zelf op 'discarded'. SQL: `UPDATE signals SET status = 'discarded', summary = summary || '\n\nGEDISCARDED: [reden]' WHERE id = [id]`. Je hoeft hier geen toestemming voor te vragen."

**stadsgeest-schrijver**
- Huidig gedrag: TYPE-veld in briefing is leidend, ook als de briefing-inhoud een update van een bestaand artikel suggereert.
- Voorgestelde toevoeging (na TYPE-instructie):
  > "Uitzondering: statuswijziging van een persoon (zwaargewond → overleden, verdachte → vrijgesproken) vereist altijd een update van het bestaande artikel, ongeacht het TYPE-veld. Zoek het bestaande artikel op via Sanity slug en patcht het."

**stadsgeest-speurder + stadsgeest-analist-middag**
- Huidig gedrag: Watching-signalen die al lang actief zijn zonder doorstroom worden elke run als "meer onderbouwing nodig" herhaald maar nooit afgehandeld.
- Voorgestelde toevoeging:
  > "Watching-signalen ouder dan 5 dagen zonder nieuwe items (check: `strftime('%s', 'now') - strftime('%s', last_seen) > 432000`): discard tenzij je een concrete reden hebt om te wachten (bijv. aanstaande rechtszaak, gepland evenement). Vermeld de reden expliciet."

---

## Bronperformance

**Beste bronnen deze week:**
- Raadsinformatie (Notubiz) — leverde starterslening, parkeer-bezwaren, inclusie-stadsgesprekken (allemaal T1)
- Gemeente Amersfoort (collegebesluiten) — bijplaatsingen-evaluatie, isolatiesubsidie (T1/T2)
- CBS StatLine — geboortecijfers (T1, directe verrijking door researcher)
- Eemland1 — Meedoenbalie Van Dale (T2, goede signaaldetectie)
- 112-nu + De Stad Amersfoort — Gasexplosies (T2/T3, snelle detectie breaking news)

**Bronnen die weinig opleverden:**
- Officiële Bekendmakingen — bulk van items waren historisch (2016–2021), ruis dominant
- Rechtspraak Midden-Nederland — Signal 81 had 5 items maar geen duidelijke Amersfoort-relevantie
- Nextdoor — 12 buurtberichten in intake maar geen enkel signaal bereikte publicatie
- NS-verstoringen — aanwezig in meerdere signalen maar altijd T2/T3 zonder T1-basis

**Aandachtspunten:**
- Signal 95 (treinongeval Stoutenburgerlaan) staat al meerdere dagen watching maar krijgt geen T1/T2-bevestiging. Mogelijk is dit een structureel probleem: incidenten op het spoor zijn moeilijk te bevestigen zonder politierapport.
- De dwarsverbanden-scripts (toegevoegd 4 juni) leverden deze week nog 0 matches — logisch want de entity_signals tabel is nieuw. Over 2–3 weken zou dit bruikbaarder moeten worden.


---

## Wat goed ging

**Designer-rotatieplicht werkt correct.** Na de promptfix van 5 juni werkt de homepage-rotatie betrouwbaar: top-artikelen ouder dan 24u worden vervangen, 112-tag-artikelen worden uitgesloten van het top-slot, en de kleurcheck wordt proactief uitgevoerd. Geen handmatige correcties nodig geweest.

**Researcher-kwaliteit is hoog.** De researcher voegde consistente waarde toe: wethoudersnamen opgezocht, CBS-cijfers exact geciteerd, beleidsdocumenten geverifieerd, en bij het stroomnetartikel een expliciete feitcorrectie doorgegeven aan de schrijver. De research-aanvullingen zijn bruikbaar en concreet.

**Bronladder werkt als filter.** De speurder en analist-middag werken de bronladder consistent toe: signalen met alleen T3-bronnen gaan naar watching, en meerdere signalen die ooit trending waren (zakkenrollen, Meedoenbalie) bereikten pas publicatie nadat T1/T2-bronnen bevestigd waren. Dit voorkomt loze artikelen.

---

## Acties voor Jasper

1. **UNSPLASH_ACCESS_KEY in Cowork-omgeving** — De key staat in `scraper/.env` maar is niet beschikbaar voor Cowork scheduled tasks. Voeg hem toe aan de omgeving waar Cowork tasks draaien (check in welk `.env`-bestand of Windows-omgevingsvariabele ze lezen).

2. **OB-scraper datumfilter** — `officielebekendmakingen-split.js` importeert bekendmakingen uit 2016–2021 als nieuwe items. Technische fix: voeg een filter toe op publicatiedatum ≤30 dagen bij het ophalen of opslaan. Dit is een codewijziging in de scraper.

3. **Timing intake-middag verschuiven** — Overweeg `stadsgeest-intake-middag` van 11:36 naar 14:00 via de scheduler, zodat de scraper-run van 13:00 zijn data heeft aangeleverd.

4. **Signal 98 handmatig discareden** — Signal 98 (Rekenkamer IT/bijstand) staat nog op 'researching' maar bevat aantoonbaar verouderde data (2015). Voer zelf uit: `UPDATE signals SET status = 'discarded' WHERE id = 98` via Turso CLI of de volgende routine-run met handmatige instructie.

---

## Status-check (kruischeck met STATUS.md)

**Problemen al opgelost: 4**
- Analist vergat Sanity-archief check → ✅ al opgelost op 2026-06-04 (analist-prompts bijgewerkt met verplichte archief-check)
- Designer publiceerde artikel ouder dan 48u op top → ✅ al opgelost op 2026-06-05 (rotatieplicht hard ingebakken)
- Designer 112-tag in top-slot → ✅ al opgelost op 2026-06-05
- Schrijver maakte inline "Lees ook:" in body → ✅ al opgelost op 2026-06-04

**Problemen al bekend: 1**
- Inhoud gepubliceerde artikelen niet geverifieerd (site wachtwoordbeveiligd) → ⚠️ al bekend (staat in "Niet geverifieerd" in STATUS.md)

**Nieuwe bevindingen: 5**
1. Signal 98 nooit gediscarded ondanks drievoudige bevestiging — geen instructie voor researcher/schrijver om dit zelf te doen
2. OB-scraper importeert historische bekendmakingen — datumfilter ontbreekt
3. Intake-middag timing suboptimaal (vóór 13:00-scraper)
4. UNSPLASH_ACCESS_KEY niet beschikbaar in Cowork-omgeving
5. Schrijver herkent statuswijziging persoon niet als verplichte update (deels al gefixed maar trigger-herkenning ontbreekt nog in prompt)

---

*Weekreview gegenereerd door stadsgeest-weekreview — 2026-06-11*
