# Stadsgeest Weekreview — 2026-06-29

## Samenvatting van de week

Dit is geen normale week: de **intake-routine is sinds 11 juni (18 dagen) geen nieuwe signalen meer gaan aanmaken**, waardoor de hele redactionele pipeline sindsdien stilstaat. Het laatst gepubliceerde artikel dateert van 12 juni. De scrapers draaiden wél door (320+ nieuwe raw_items in de laatste 3 dagen), maar die instroom werd nooit verwerkt tot signalen. De huidige (lopende) intake- en speurder-sessies van vandaag zijn dit zelf aan het herstellen. Vóór de stilstand (week van 5-12 juni) functioneerde de pipeline gezond: consistente conversie van signalen naar gepubliceerde artikelen, goede kwaliteitscontrole door researcher/schrijver, en correcte homepage-rotatie door de designer.

## Statistieken

- Runs bekeken: 15 sessies (10 routines, incl. 2 nachten + 1 middag-cyclus)
- Artikelen gepubliceerd in bekeken periode: 4 (2 op 12 juni, 2 op 5 juni middag) — **0 sinds 12 juni**
- Kandidaten geselecteerd maar niet gepubliceerd: 1 (signaal 98, Rekenkamer-rapport 2015 onterecht als nieuws 2026 aangemerkt — terecht tweemaal afgewezen door researcher/schrijver)
- Signalen afgevoerd deze periode: 21 (watching >7 dagen) + 1 (new >14 dagen) + 8 (oude bekendmakingen 2019-2021) + 7 (tier-3 single-source teruggezet naar watching)
- Fouten/mislukte runs: 1 kritiek (intake-stilstand 18 dagen), 2 zelf-gecorrigeerde scriptbugs (designer), 1 data-corruptie-bevinding (entity-matching)

## Terugkerende problemen (gesorteerd op impact)

### 🔴 Hoge prioriteit

**Intake-routine inactief sinds 11 juni, 18 dagen geen nieuwe signalen** — 1x ontdekt, vermoedelijk al die tijd actief — Oorzaak nog niet volledig vastgesteld door de lopende sessie; wel al gevonden dat bestaande signalen (98, 31, 35, 207) historisch corrupt waren (tot 349 gekoppelde items) door te losse entity-matching. Fix: zodra de lopende intake-sessie klaar is, verifiëren dat nieuwe signalen weer worden aangemaakt en de oorzaak (waarschijnlijk een crash of silent failure in de matching-logica) structureel documenteren in STATUS.md. Aanbevolen: een lichte gezondheidscheck toevoegen (bijv. in de speurder-prompt) die alarmeert als intake >24u geen nieuwe signalen heeft gemaakt — dit had de stilstand na 1 dag kunnen signaleren in plaats van na 18.

**Geen monitoring/alarmering op pipeline-stilstand** — gevolg van bovenstaand probleem — 18 dagen ongemerkt. Fix: voeg een expliciete check toe aan de speurder/analist-prompt (zoals vandaag al improviserend gedaan: "intake heeft sinds X geen signalen gemaakt → flag als kritiek") en/of laat de designer (die als eerste non-output opmerkt) dit automatisch als blocking issue naar STATUS.md schrijven i.p.v. alleen te rapporteren.

### 🟡 Gemiddelde prioriteit

**Entities-tabel CHECK constraint mismat met instructie** — 1x gezien (intake-rapport 12 juni én vandaag) — De tabel staat alleen `person/organization/location/address` toe, terwijl de intake-instructie ook `project/amount/legal_ref` verwacht. Projecten worden nu als `location` opgeslagen met uitleg in context, een workaround. Fix: ofwel de CHECK constraint uitbreiden met `project`, `amount`, `legal_ref`, ofwel de intake-instructie aanpassen zodat hij niet meer naar niet-bestaande types verwijst. Eerste optie is beter omdat projectentiteiten (bijv. "Wagenkwartier") inhoudelijk geen locatie zijn.

**Entity-matching te los, leidt tot databloat** — 1x gezien (signalen 98, 31, 35, 207 met tot 349 gekoppelde items) — Voorkomt betrouwbare trending-detectie omdat opgeblazen signalen valse trending-scores kunnen geven. Fix: de lopende intake-sessie bouwt al een strengere matching-logica; zorg dat dit wordt gedocumenteerd in STATUS.md en dat bestaande corrupte signalen (98, 31, 35, 207) handmatig worden opgeschoond na de fix.

### 🟢 Lage prioriteit / nice to have

**Intake-middag draait te vroeg t.o.v. scrape-dagelijks-middag1** — al bekend (zie Status-check) — geen actie nodig deze week, blijft openstaand.

**Signaal met lege content (item 2765, banengroei)** — 1x gezien — intake maakte signaal aan met notitie dat researcher de bron moet achterhalen; werkt als bedoeld maar is een teken dat sommige scrapers content-velden leeg laten. Geen directe actie nodig, researcher vangt het op.

## Promptverbeteringen voorgesteld

**stadsgeest-speurder / stadsgeest-analist-middag**
- Huidig gedrag: routine ontdekt soms toevallig dat intake al dagen niets heeft aangemaakt (zoals vandaag), maar dit is geen gestructureerde check — het hangt af van of de agent het zelf opmerkt.
- Voorgestelde toevoeging: een verplichte stap 0 die controleert `SELECT MAX(created_at) FROM signals` en als dit ouder is dan 24 uur, dit als KRITIEK PROBLEEM bovenaan de rapportage zet (zoals vandaag spontaan gedaan) én een regel toevoegt aan de samenvatting die voor de weekreview makkelijk te detecteren is, bijv. `INTAKE-ALARM: [n] dagen geen nieuwe signalen`.

**stadsgeest-intake / stadsgeest-intake-middag**
- Huidig gedrag: instructie verwijst naar entity-types `project/amount/legal_ref` die niet bestaan in de database CHECK constraint, waardoor de agent improviseert.
- Voorgestelde wijziging: ofwel schema-migratie (CHECK constraint uitbreiden) ofwel instructie aanpassen naar de daadwerkelijke 4 toegestane types, met expliciete richtlijn hoe projectnamen dan te taggen (bijv. als `location` met `context`-veld, zoals nu al gebeurt — maak dit de officiële regel in plaats van een ad-hoc workaround).

## Bronperformance

- Beste bronnen deze week: Waterschap Vallei en Veluwe en RWS Droogtemonitor (tier 1, leidde tot top-artikel over onttrekkingsverbod), Gemeente Amersfoort (formatie nieuw college, tier 1), Politie.nl (getuigenoproep explosie Arnhemseweg, tier 1), CBS StatLine (geboortecijfers, tier 1 met preciezere cijfers dan de secundaire bron)
- Bronnen die weinig opleverden: Officiële bekendmakingen (oude documenten 2019-2021 die als 'new' binnenkwamen — moeten gefilterd worden op publicatiedatum), Raadsinformatie-document Zonnehof 10 (3 jaar oud, ten onrechte als trending gemarkeerd)
- Aandachtspunten: meerdere malen kwamen oude/historische documenten (Huisvestingsverordening 2020 met 49 items, Zonnehof 10 uit 2021) door de trending-detectie heen vóórdat ze als ruis werden herkend. Dit is een terugkerend filterprobleem bij officiële bekendmakingen en raadsinformatie — overweeg een publicatiedatum-check vóór signaal-aanmaak.

## Wat goed ging

- Toen de pipeline (vóór de stilstand) draaide, werkte de kwaliteitscontrole uitstekend: researcher en schrijver discardeden samen tweemaal hetzelfde stale Rekenkamer-signaal met concrete onderbouwing (rapport uit 2015, niet 2026), en de researcher corrigeerde zelfstandig een afgeronde cijfer-samenvatting (2,0→1,5) met de exacte CBS-cijfers (1,86→1,56).
- De designer-routine is robuust: hij handhaaft de 48u-top-artikel-regel hard (ook toen er niets nieuws was om te bumpen, downgradede hij het verlopen top-artikel correct in plaats van het te laten staan), en loste zelfstandig twee scriptbugs op (datumparsing, env-fallback) zonder de run te laten falen.
- De speurder van vandaag toonde goed initiatief: in plaats van te wachten op een herstelde intake, maakte hij proactief signalen aan voor de belangrijkste gemiste items van de afgelopen dagen, zodat de pipeline meteen weer kandidaten heeft zodra intake herstelt.

## Acties voor Jasper (indien van toepassing)

- Geen externe acties nodig deze week — het kritieke probleem (intake-stilstand) wordt momenteel zelfstandig opgelost door de lopende Cowork-sessies. Wel aandachtspunt: als de oorzaak van de 18-dagen-stilstand niet eenduidig wordt gevonden (bijv. een silent crash zonder logging), kan het de moeite waard zijn om bij gelegenheid te kijken of de scheduled-task-omgeving fouten beter kan loggen/alarmeren richting jou, zodat zulke stiltes niet pas na 18 dagen worden opgemerkt.

## Status-check

- Problemen al opgelost: 0
- Problemen al bekend: 1 — "Intake-middag draait te vroeg t.o.v. scrape-dagelijks-middag1" (al genoemd in weekreview 2026-06-11, nog niet gefixed; urgentie ongewijzigd, lage prioriteit)
- Nieuwe bevindingen: 5 — intake-stilstand 18 dagen, gebrek aan monitoring/alarmering, entities CHECK constraint mismatch, entity-matching databloat, oude documenten die door trending-filter glippen

---
Cowork-update: 2026-06-29
