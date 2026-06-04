# Stadsgeest Weekreview — 3 juni 2026

## Samenvatting van de week

De pipeline heeft deze week ~15 artikelen gepubliceerd over 6 actieve dagen (28 mei t/m 3 juni), gemiddeld 2–3 per dag. De basismechanismen werken goed: scrapers leveren, researcher verrijkt correct en corrigeert feitelijk, schrijver past die correcties toe. Drie van de vijf geïdentificeerde problemen zijn dezelfde dag nog opgelost (archiefcheck analist, update-feature, Unsplash key). Twee structurele scraper-issues staan nog open: catchall-signaal #35 en de ongefilterde RTV Utrecht feed.

---

## Statistieken

- **Runs uitgevoerd:** ~40 (ochtend + middag, ma–wo + weekend)
- **Artikelen gepubliceerd:** 15 (geautomatiseerd) + 1 manueel (asielopvang)
- **Kandidaten geselecteerd maar niet gepubliceerd:** 0 — alle geselecteerde kandidaten zijn geschreven
- **Signalen afgevoerd:** ~3–5 (o.a. appende bestuurder A2/Abcoude, niet-Amersfoort)
- **Fouten/mislukte runs:** 2 (session limit ~31 mei: designer + schrijver), 1 lege intake (2 juni 00:10: scrapers hadden avond daarvoor niet gedraaid)

---

## Problemen — open

### 🔴 Hoge prioriteit

**Signaal #35 catchall + stopword "amersfoort" ontbreekt**
Gezien: 3×+ (30 mei, 1 juni, 2 juni intake middag).
Het woord "amersfoort" staat niet in de stopwoordenlijst van de clustering-matcher. Gevolg: signaal #35 heeft 107 items (Marktplaats-advertentie + al het overige nieuws door elkaar). De intake middag van 2 juni analyseerde de oorzaak volledig — ook bron #30 (RTV Utrecht ongefilterd `/nieuws/`) brengt provincie-breed nieuws binnen zonder Amersfoort-filter.

**Concrete fix (scraper-code):**
1. Voeg toe aan `STOPWORDS`: `["amersfoort", "de stad amersfoort", "gemeente amersfoort", "provincie utrecht", "regio", "nederland"]`
2. Verwijder bron #30 (RTV Utrecht `/nieuws/` — ongefilterd) — bron #40 (`/tag/amersfoort`) is de correcte vervanging
3. Voeg Nextdoor-filter toe: items waarvan `title` matcht op `/gratis|te koop|gevraagd|gezocht|spaarzegel|advertentie|marktplaats/i` worden gefilterd vóór signaalcreatie

---

### 🟡 Gemiddelde prioriteit

**Session limit op ~31 mei (designer + schrijver afgebroken)**
Gezien: 1× per sessie.
Beide runs werden afgebroken met "You've hit your session limit · resets 1pm". De designer had nog geen afbeeldingen verwerkt; de schrijver was halverwege.
**Concrete fix:** Controleer of scheduled tasks een eigen token gebruiken of de interactieve limieten delen. Als ze delen: verplaats zware runs (schrijver, designer) naar een tijdstip waarop Jasper minder actief is.

**Entiteitendatabase structureel onvolledig**
Gezien: elke schrijver-run.
Elke schrijver-run meldt 3–7 personen/organisaties die niet in de database staan en niet worden aangemaakt: Stedin, TenneT, Provincie Utrecht, Sabine Uitslag, Manon Spaander, Tjeerd Scheffer, etc. De persons/organizations-structuur is op 2 juni wel aangemaakt (60 personen, 8 organisaties) maar de schrijver vult dit niet automatisch aan.
**Concrete fix (schrijver-prompt):** voeg toe: *"Als een persoon of organisatie centraal staat in het artikel (≥2 keer genoemd, actieve rol), maak dan een nieuw Sanity-document aan van type `person` of `organization` met minimaal `name` en `slug`. Koppel aan het artikel."*

---

### 🟢 Lage prioriteit / nice to have

**Draft-artikel lekt in ongefilterde Sanity-queries**
Gezien: 1× (designer 1 juni).
`drafts.DNMuwfJSF291i1ATyZMAVK` verscheen in een top-5 query.
**Fix:** Voeg `&& !(_id in path("drafts.**"))` toe aan alle GROQ-queries over gepubliceerde artikelen.

**Marathon-afbeelding hergebruikt**
Gezien: 1× (dezelfde Wikimedia-foto gebruikt voor twee marathon-artikelen).
**Fix:** Verboden lijst uitbreiden naar 14 dagen voor Wikimedia Commons-afbeeldingen.

---

## Opgelost deze week ✅

**Analist controleert Sanity-archief niet vóór selectie → OPGELOST (3 juni)**
De analist selecteerde signaal 64 (marathon hitte/datum 2027) zonder te checken of er al marathon-artikelen stonden — resulteerde in 4 artikelen over hetzelfde evenement in 3 dagen. Opgelost: speurder en analist middag hebben nu verplichte archiefcheck in de prompt, inclusief detectie van `TYPE: update` + doelartikel-slug. Zie STATUS.md: *"checkt Sanity-archief op eerdere berichtgeving over elk veelbelovend signaal"*.

**Update-mechanisme Sanity → OPGELOST (3 juni)**
Analist middag stelde voor om vervolgberichten als update van een bestaand artikel te verwerken. Volledig geïmplementeerd: `updates[]` array in Sanity article schema (deployed), analist markeert `TYPE: update`, schrijver PATCHt het bestaande document, designer bumpt bijgewerkte artikelen naar homepage. Frontend (PR #35): ArticleUpdates-component, "bijgewerkt"-label op artikelkaarten.

**Unsplash API key ontbrak → OPGELOST (3 juni)**
`UNSPLASH_ACCESS_KEY` is toegevoegd aan `scraper/.env`. Designer tasks zijn ook bijgewerkt: geen zwart-wit/archiefbeelden tenzij het artikel expliciet over een historisch onderwerp gaat.

**PM2 auto-herstel bij reboot → OPGELOST (2 juni)**
Windows Task Scheduler voert nu `pm2 resurrect` uit bij inloggen. De lege intake van 2 juni 00:10 was een timing-kwestie (scrapers draaien pas vanaf 06:30; de avond daarvoor hadden ze geen nieuwe items geproduceerd), niet een daemon-crash. PM2-status op 2 juni bevestigd: alle drie jobs draaien, exit 0.

**Nextdoor-quotes feature → GEÏMPLEMENTEERD (3 juni, experimenteel)**
Researcher noteert nu letterlijke Nextdoor-quotes met naam, wijk, datum en FOTO_URL. Schrijver verwerkt quotes als blockquote met attributie; als FOTO_URL aanwezig: download en upload als mainImage naar Sanity. Marktplaats-filter (zie openstaand punt) is hier nog niet bij inbegrepen.

---

## Promptverbeteringen nog nodig

**Stadsgeest intake (scraper-code)**
- Stopword "amersfoort" toevoegen (zie hoge-prioriteit probleem hierboven)
- Nextdoor marketplace-filter toevoegen

**Stadsgeest schrijver**
- Auto-aanmaken van centrale personen/organisaties (zie gemiddelde prioriteit hierboven)

---

## Bronperformance

**Beste bronnen deze week:**
- De Stad Amersfoort — primaire bron voor vrijwel alle lokale verhalen
- 112-nu.nl — onmisbaar voor breaking news (gasexplosie, brand Lindeboomseweg)
- Gemeente Amersfoort — officiële besluiten (Skaeve Huse, Familieschool, parkeren)
- Nieuwsplein33 — aanvullend en consistent; bracht asielopvang-verhaal in
- NOS (Amersfoort-tag) — nationale context bij lokale verhalen
- Wikimedia Commons — betrouwbare beeldbron, altijd lokaal relevant beeld te vinden

**Bronnen die weinig opleverden / problematisch:**
- RTV Utrecht ongefilterd (bron #30) — provincie-breed nieuws; OPEN FIX
- Rechtspraak.nl (signaal #31) — 59+ ECLI-items, vrijwel nooit Amersfoort-relevant; overweeg hogere drempel
- Nextdoor (Marktplaats-items) — structureel marktplaatsspam; OPEN FIX
- Bluesky — sporadisch bruikbaar; bevestigde 1 brand-signaal, verder weinig

---

## Wat goed ging

**Researcher corrigeert actief en consequent.** Twee significante feitencorrecties deze week: de gasexplosie was in Leusderkwartier (niet Vathorst), en de aansluitstop stroomnet geldt niet voor Amersfoort zelf (congestiegebied 1b, geen pauze). Beide correct verwerkt door de schrijver.

**Schrijver publiceert consistent zonder kwaliteitsproblemen.** Nul afwijzingen deze week. Bronvermelding (≥2 onafhankelijke bronnen) gehaald bij alle artikelen. Correcties uit researcher-briefing worden altijd verwerkt.

**Designer vindt lokaal relevant beeld.** In >80% van de gevallen Amersfoort-specifieke foto gevonden via Wikimedia Commons of Openverse — geen generieke stockfoto's.

---

## Acties voor Jasper

1. **Signaal #35 + stopwords fix in scraper-code** — dit is de enige openstaande hoge-prioriteit issue. Kan in één scraper-sessie worden doorgevoerd.
2. **Session limits** — nagaan of scheduled tasks de interactieve daglimiet delen.

---

*Weekreview gegenereerd door stadsgeest-weekreview scheduled task*
*Bijgewerkt na kruischeck met STATUS.md — Cowork-update: 2026-06-03*
