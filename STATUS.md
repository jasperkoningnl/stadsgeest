# STATUS.md — Stadsgeest 033

## Cowork Scheduled Tasks (geverifieerd 2026-06-11)

- **stadsgeest-intake** — dagelijks 00:10 — raw_items verwerken, signalen bijwerken — laatste run: 2026-06-30 00:10 ✓ (scheduled, 0 onverwerkte items aangetroffen — niets te doen) — **matching-logica vervangen, zie Niet geverifieerd/Cowork-update**
- **stadsgeest-speurder** (analist nacht) — dagelijks 01:01 — signalen analyseren, kandidaten selecteren — laatste run: 2026-06-03 23:00 ✓
- **stadsgeest-researcher** — dagelijks 02:04 — achtergrondinfo verzamelen per kandidaat — laatste run: 2026-06-04 00:04 ✓
- **stadsgeest-schrijver** — dagelijks 06:05 — artikelen schrijven en publiceren naar Sanity — laatste run: 2026-06-04 04:05 ✓
- **stadsgeest-designer** — dagelijks 07:05 — afbeeldingen zoeken, homepage-indeling — laatste run: 2026-06-30 ✓ (7 artikelen kregen mainImage, top-artikel-dubbeling gecorrigeerd — zie Cowork-update)
- **stadsgeest-intake-middag** — ma-vr 11:36 — intake tweede run — laatste run: 2026-06-03 09:37 ✓ — bijgewerkt 2026-06-04: historische items → status 'watching'
- **stadsgeest-analist-middag** — ma-vr 12:02 — analyse tweede run — laatste run: 2026-06-03 10:02 ✓
- **stadsgeest-researcher-middag** — ma-vr 12:34 — research tweede run — laatste run: 2026-06-03 10:35 ✓
- **stadsgeest-schrijver-middag** — ma-vr 16:39 — schrijver tweede run — laatste run: 2026-06-03 14:39 ✓
- **stadsgeest-designer-middag** — ma-vr 17:04 — designer tweede run — laatste run: 2026-06-03 15:04 ✓
- **stadsgeest-weekreview** — zondag 09:00 — alle routine-rapportages analyseren, verbeterplan opstellen, STATUS.md kruischeck — eerste run: 2026-06-07

## PM2 Scraper Jobs (geverifieerd 2026-06-11)

- **scrape-browser** — cron 06:30 — Playwright scrapers (run-browser.js) — laatste run: 2026-06-10 23:00 ✓
- **scrape-dagelijks** — cron 07:00 — RSS/API scrapers (run-all.js) — laatste run: 2026-06-10 22:46 ✓
- **scrape-dagelijks-middag1** — cron 13:00 — RSS/API scrapers (run-all.js) — hersteld 2026-06-11 ✓
- **scrape-dagelijks-avond** — cron 19:00 — RSS/API scrapers (run-all.js) — hersteld 2026-06-11 ✓
- **scrape-wekelijks** — cron 08:00 — trage API's/HTML (run-weekly.js) — laatste run: 2026-06-10 22:50 ✓
- **scrape-nieuw** — cron ma 09:00 — 15 nieuwe primaire bronnen (run-nieuw.js) — stabiel (10 van 15 actief; RvS/Huurcommissie/OpenKvK/EP-online/EU-subsidies uitgeschakeld wegens JS/auth) — laatste run: 2026-06-10 22:51 ✓
- **dwarsverbanden-nacht** — cron 00:45 — co-occurrence analyse via entity_signals (dwarsverbanden.js) — status: stopped (wacht op cron)
- **dwarsverbanden-middag** — cron 11:50 ma-vr — zelfde als nacht, tweede run — status: stopped (wacht op cron)
- **Auto-herstel:** Windows Task Scheduler voert `pm2 resurrect` uit bij inloggen (ingesteld 2026-06-02).
- **Bug gefixed 2026-06-11:** db.js gebruikte `dotenv.config()` zonder pad — zocht .env in src/ ipv scraper/. Fix: explicit path `path.join(__dirname, '..', '.env')` (zoals dwarsverbanden.js). Scrapers waren daardoor 7 dagen gestopt (2026-06-04 t/m 2026-06-11).
- **Intake script:** scraper/intake-run.mjs aangemaakt als standalone intake-script (draait buiten Cowork tasks om als fallback).
- **PM2 opnieuw geregistreerd 2026-06-11:** dump.pm2 bevatte alleen dwarsverbanden-jobs. Scraper-jobs opnieuw aangemaakt en opgeslagen via pm2 save.

## Routines — wat ze doen

- **Weekanalyse (toegevoegd 2026-06-11):** de speurder bevat nu een verplichte stap 5b — als er de afgelopen 7 dagen geen signaal met label WEEKANALYSE is aangemaakt, doet hij een archiefbrede analyse (signalen 90 dagen, entity-dwarsverbanden, Sanity-archief), kiest een thema en maakt een extra analysekandidaat aan (FORMAT: analysis, LABEL: WEEKANALYSE, prioriteit top, telt niet mee in max 3). Richtdag woensdag, zelfherstellend bij gemiste runs. Researcher geeft WEEKANALYSE-kandidaten dubbele onderzoeksdiepte (materiaal voor 700-1200 woorden); schrijver mag ze nooit downgraden naar news/brief en laat ze bij te mager materiaal op researching staan.
- **stadsgeest-speurder** — Haalt signalen met status `new` of `watching` op, zoekt dwarsverbanden tussen entiteiten, controleert clustering (meerdere incidenten van hetzelfde type op één nacht/dag = zelf een verhaal), checkt Sanity-archief op eerdere berichtgeving over elk veelbelovend signaal, controleert of signalen trending zijn (≥3 items/24u). Selecteert max. 3 artikelkandidaten op basis van min. twee onafhankelijke bronnen, schrijft briefing in `summary`-veld, zet status op `researching`. Ruimt signalen op ouder dan 7-14 dagen zonder activiteit. Markeert signals die voortbouwen op een bestaand artikel als `TYPE: update` met slug van het doelartikel.
- **stadsgeest-researcher** — Pakt signalen met status `researching`, verrijkt briefing met historische context via websearch, verdiept betrokken personen en organisaties, spoort lokale stemmen op via Nextdoor en Reddit. Noteert Nextdoor-posts als letterlijk citaat met naam, wijk, datum en foto-URL (FOTO_URL). Voegt `RESEARCH-AANVULLING`-blok toe aan `summary`-veld zonder status te wijzigen.
- **stadsgeest-schrijver** — Schrijft artikelen op basis van briefing + research-aanvulling, publiceert naar Sanity CMS. Bij `TYPE: update` in de briefing: PATCHt het bestaande Sanity-document (voegt entry toe aan `updates[]` en werkt `updatedAt` bij) in plaats van een nieuw artikel aan te maken. Verwerkt Nextdoor-quotes als blockquote in Portable Text met attributieregel; als FOTO_URL aanwezig is: downloadt foto en uploadt als mainImage naar Sanity met credit "Foto: [naam] via Nextdoor".
- **stadsgeest-designer** — Kiest per artikel bewust een beeldtype (sinds 2026-06-11): GRAFIEK via QuickChart bij cijfer-/statistiekverhalen (alleen met exacte cijfers uit het artikel), KAART via OpenStreetMap+Leaflet+Playwright bij locatiegebonden nieuws zonder foto van de exacte plek (cirkel i.p.v. marker bij wijkniveau; nooit exact huisadres bij misdrijven), FOTO via de bestaande zoektrap voor de rest. Stelt homepage-indeling samen. Beschouwt ook bijgewerkte artikelen (updatedAt binnen 48 uur) als kandidaat voor bump naar homepage of priority "top" — mits de update inhoudelijk significant is.
- **stadsgeest-analist-middag** — Identieke logica als speurder, inclusief clustering-check, Sanity-archief check en update-detectie. Draait op werkdagen op basis van ochtendmateriaal. Max. 3 kandidaten, schrijft briefings, voert opruiming uit. Beide analist-prompts bijgewerkt 2026-06-04: Stap 4 is nu verplicht proactief (WebSearch voor elk signaal novelty ≥ 3, hardcoded categorieën), briefing bevat nieuw veld ONDERZOEKSOPDRACHT VOOR RESEARCHER met concrete zoektermen, bronnen en vragen.

## Database Turso (geverifieerd 2026-06-30)

- **raw_items:** 3.232 items, alle is_processed=1 (ongewijzigd t.o.v. 06-29 — geen nieuwe scrape-data binnengekomen, laatste scraped_at nog steeds 2026-06-29 17:34)
- **signals (2026-06-30, na researcher-run):** 1 new, 15 watching, 7 researching, 51 published, 269 discarded — totaal 343 signalen. Verschuiving t.o.v. eerdere telling vandaag (92 new/1 watching/4 researching/195 discarded) komt door een speurder-run later op de dag die buiten deze sessie om heeft gedraaid — niet door de researcher veroorzaakt.
- **sources:** 105+ bronnen — ongewijzigd sinds 2026-06-04
- **entities:** 729 totaal — entity_type beperkt door CHECK-constraint tot person/organization/location/address (kvk_number/amount/legal_ref/project bestaan NIET in het schema, ondanks dat de intake-instructies die wel noemen — zie Niet geverifieerd)
- **Bekende databevuiling (gevonden 2026-06-29, niet door mij veroorzaakt vandaag):** 12 signalen hebben absurd hoge confirmations/item-counts door een matching-bug uit eerdere sessies (vóór 2026-06-29), o.a. #98 "Rekenkamer Amersfoort" met 349 gekoppelde items, #31 (ECLI-zaak) met 157, #35 (Falk-stadsplattegrond) met 110, #33/#197/#41/#207/#32/#97/#209/#80/#210 met 16-50. Dit komt doordat eerdere intake-runs nieuwe items op basis van 2 gedeelde woorden aan signalen koppelden — generieke woorden (bijv. "extra", "plan", "nieuwe") veroorzaakten valse matches tussen volledig ongerelateerde berichten. Niet opgeschoond vandaag (buiten scope van een routine-run, risico op verdere schade). Aanbeveling: apart, mens-begeleid opschoningsmoment voor deze 12 signalen.
- **is_historical kolom:** toegevoegd aan raw_items 2026-06-04 (ALTER TABLE)
- **Personen/relaties-schema:** persons, organizations, roles, org_relations, person_relations, decisions, decision_persons, annual_reports
- **Personenvulling (2026-06-02):** 8 organisaties, 60 personen, 60 rollen (B&W, raad, Meander, De Alliantie, Waterschap, Portaal)
- **Sanity sync (2026-06-02):** 60 personen + 8 organisaties hebben sanity_id

## Bronnen live

**Dagelijks (run-all.js):** gemeente-amersfoort, vru, de-stad-amersfoort, eemland1, nos-amersfoort, rijksoverheid, tenderned, cbs-statline, reddit-amersfoort, amersfoort-nieuws, waterschap, politie-amersfoort, 112nu-amersfoort, officielebekendmakingen (BROKEN — fallback), **officielebekendmakingen-split** (Omgevingsvergunning/Verkeersbesluit/overig), ns-verstoringen, bluesky

**Browser dagelijks (run-browser.js):** nieuwsplein33, rtvutrecht, raadsinformatie (fallback), raadsinformatie-types (vergaderingen catch-all), **raadsinformatie-api** (Notubiz modules: schriftelijke vragen/moties/RIB/ingekomen stukken — 4+0+2+9 items eerste run), nextdoor, igj-nvwa, omthuis

**Wekelijks (run-weekly.js):** pdok-bag, rechtspraak, ftm-amersfoort, alliantie, odu, prorail, regio-amersfoort, archiefeemland, subsidieregister, uwv-amersfoort, amersfoort-cijfers, financien-amersfoort, ibabs-woo, org-rss, bedrijven-amersfoort, erfgoed-natuur, onderwijs-cultuur, bw-besluiten, meander, **officielebekendmakingen-wekelijks** (gem.regelingen/prov.blad/waterschapsblad)

## Bronladder (ingevoerd 2026-06-03)

- **Tier 1** (publicatiebronnen — zelfstandig artikelkandidaat): 30 bronnen — o.a. TenderNed, CBS StatLine, Rechtspraak, Raadsinformatie, IGJ/NVWA, PDOK BAG, Subsidieregister, B&W besluiten, iBabs, UWV, ODU, BIG-register, LRK, Insolventieregister + 15 nieuwe (Rekenkamer, RvS, OpenKvK, etc.)
- **Tier 2** (corroboratiebronnen): 42+ bronnen — o.a. Gemeente Amersfoort, VRU, Eemland1, De Alliantie, Meander, Regio Amersfoort, Rijksoverheid, ProRail, NS
- **Tier 3** (detectiebronnen — alleen trigger): 20 bronnen — o.a. De Stad Amersfoort, NOS, Politie, 112-nu, Nextdoor, Reddit, Bluesky, RTV Utrecht, Nieuwsplein33
- **Novelty-score + artikeltype** actief in speurder en analist-middag (nov. 2026-06-03)

## Bronnen gepland (niet actief)

- ggd-regio-utrecht, waaroverheid, onderwijsinspectie, provincie-utrecht
- alarmeringen (P2000 alternatief), bigregister, insolventieregister, lrk-kinderopvang
- KvK nieuwe inschrijvingen (API-key vereist), TED Europese aanbestedingen
- PDOK omgevingsdocumenten, Portaal en SWEV (woningcorporaties)
- Luchtmeetnet RIVM, NDOV/OpenOV, CBS kerncijfers wijken/buurten
- Waarstaatjegemeente.nl, Subsidietrekker.nl, RVO-subsidies, Provincie Utrecht subsidieregister

## Frontend — in te vullen door Code

### Actieve routes en pagina's

- `/` — Homepage (`src/app/page.tsx`) — hero + kortCards + analyseblok + normale artikelkaarten, revalidate 60s
- `/artikel/[slug]` — Artikelpagina
- `/nieuws` — Nieuwsoverzicht
- `/archief` — Archief
- `/112` — 112-nieuws
- `/tag/[slug]` — Tag-overzichtspagina
- `/persoon/[slug]` — Persoonsprofielpagina
- `/over` — Over Stadsgeest
- `/privacy` — Privacyverklaring
- `/login` — Inlogpagina (wachtwoordbeveiliging via cookie-authenticatie, ingevoerd 2026-06-02)

### API-routes

- `POST /api/auth` — cookie-authenticatie (wachtwoordbeveiliging)
- `POST /api/report` — meldingsfunctie
- `GET /feed.xml` — RSS-feed
- `GET /robots.txt` / `GET /sitemap.xml` — SEO

### Sanity-integratie

- **Client:** `next-sanity` via `src/lib/sanity.ts`
- **Project ID:** `60u1z6xa`, dataset `production`, apiVersion `2026-05-28`
- **CDN:** ingeschakeld (`useCdn: true`)
- **Gebruik:** homepage haalt data op via `homepageQuery`; client ook in gebruik voor rapport-API (`src/app/api/report/route.ts`)
- **Inhoud Sanity (artikelen etc.):** niet geverifieerd — site is wachtwoordbeveiligd

### Laatste succesvolle Vercel deploy

- Niet rechtstreeks geverifieerd (geen `gh` CLI / Vercel CLI beschikbaar in deze omgeving)
- Laatste merge naar `main`: 2026-06-04 — PR #39 "Redesign article sidebar: featured related card, rename labels, remove bottom grid"
- Vercel deployt automatisch bij push naar `main`; verwachte deploy: 2026-06-04 ✓ (niet geverifieerd via Vercel dashboard)

## Sanity Studio (geverifieerd 2026-06-02)

- **Live URL:** https://stadsgeest033.sanity.studio
- **Project ID:** `60uiz6xa`, dataset `production`
- **Actief project (notebook):** `C:\Users\Jasper Koning\projects\amersfoort-lokaal` — heeft node_modules, is de deploy-bron
- **Kopie (notebook):** `C:\Users\Jasper Koning\projects\stadsgeest033\studio` — zelfde schema's, geen aparte deploy
- **Deploy commando:** `.\node_modules\.bin\sanity.cmd deploy --yes` vanuit `amersfoort-lokaal`
- **AppId:** `khxzgwe6mplsxjjvnd5aorpq` (vastgelegd in sanity.cli.ts)
- **Schema's uitgebreid 2026-06-02:** person (+birthYear, gender, photo, party, currentRoles, isPublicFigure), organization (+kvkNumber, logo, annualReportUrl, relatedOrganizations, housing/water types)
- **Schema's uitgebreid 2026-06-03:** article + `updates[]` array (elk element: `date` datetime + `text` portable text). Deployed naar stadsgeest033.sanity.studio.

## Niet geverifieerd

- Inhoud van Sanity (artikelen, publicaties)
- Inhoud gepubliceerde artikelen (site wachtwoordbeveiligd)
- Of de scheduled intake-runs tussen 2026-06-11 en 2026-06-29 daadwerkelijk hebben gedraaid — de matchingbug (zie hieronder) lijkt in die periode te zijn ontstaan, maar ik kan niet vaststellen via welke run(s) precies
- Volledige entiteitsextractie (person/location/address) is dit run NIET uitgevoerd — alleen "gemeente amersfoort"-vermeldingen (organization) zijn via regex herkend. Personen, locaties en adressen vereisen betrouwbaardere NLP-extractie dan haalbaar in een ongesuperviseerde scheduled run; dit blijft open
- De intake-instructies noemen entity_type-waarden amount/legal_ref/kvk_number/project — deze bestaan niet in het entities-schema (CHECK staat alleen person/organization/location/address toe). Instructie en schema lopen hier uit elkaar; nog niet besproken met Jasper
- OPENAI_API_KEY ontbreekt in scraper/.env — designer-run 2026-06-30 kon stap 3D (AI-illustratie fallback) daardoor niet gebruiken. Was deze run niet nodig (alle 7 artikelen kregen grafiek/kaart/foto), maar blijft een gat zodra een artikel ooit geen van de drie oplevert.
- PowerShell-valkuil ontdekt 2026-06-30: `Get-Content x.json | ConvertFrom-Json` zet ISO-datumstrings (cutoff24h/48h/7d) automatisch om naar `[datetime]`-objecten, die bij hergebruik in een GROQ-querystring naar VS-cultuurformaat (`MM/dd/yyyy`) serialiseren i.p.v. ISO — daardoor faalt de lexicografische datumvergelijking in GROQ stilzwijgend (filter laat alles door i.p.v. alleen recente items). Cutoffs moeten per PowerShell-call vers met `Get-Date` berekend worden, nooit via een tussenliggend JSON-bestand. Trof deze run de stap 1-verbodenlijst (gaf 54 i.p.v. 7 assets — niet schadelijk, alleen te ruim) en de eerste stap 6-poging (gaf alle artikelen sinds mei i.p.v. laatste 48u — gecorrigeerd vóór er iets mee gedaan werd). Designer-prompts zijn nog NIET aangepast met deze waarschuwing — aanbevolen voor volgende sessie.

---

*Cowork-update: 2026-06-29 — Intake handmatig gedraaid (handmatige trigger, niet de scheduled task — onduidelijk of/hoe vaak deze tussen 06-11 en 06-29 automatisch liep). 413 onverwerkte raw_items gevonden. BUG ONTDEKT EN GEFIXED: de voorgeschreven matchingregel ("2 gedeelde inhoudelijke woorden") bleek bij uitvoering ernstig over-matchend — eerste poging voegde 404 van 425 items toe aan een handvol signalen (één signaal liep op tot 412 confirmations). Direct teruggedraaid via added_at/created_at-tijdstempels (signal_items, signals) en is_processed terug op 0 gezet voor de getroffen raw_items — geen permanente schade van deze sessie. Bij het uitzoeken bleek dat 12 bestaande signalen al vóór vandaag enorm waren opgeblazen door dezelfde soort bug in een eerdere sessie (zie Database Turso) — dat is niet vandaag ontstaan en niet door mij opgeschoond. Voor de resterende verwerking is een striktere, conservatievere matchingheuristiek gebruikt (Jaccard-overlap ≥0.4 + minimaal 3 gedeelde woorden, en signalen met al >10 gekoppelde items worden nooit meer gevoed) — resultaat: 93 nieuwe signalen (status new), 0 valse matches, geen enkel signaal kreeg een vreemde piek. Alle 3.232 raw_items zijn nu is_processed=1. Entiteitsextractie alleen voor "gemeente amersfoort"-organisatievermeldingen (15 entities, 11 gekoppeld aan signalen) — bredere extractie bewust overgeslagen, zie Niet geverifieerd. Aanbeveling aan Jasper: de matchingregel in de intake-instructies ("2 gedeelde woorden") is in de praktijk te zwak gebleken en moet worden herzien — voorstel: vaste woordenlijst uitbreiden of overschakelen op entity-gebaseerde matching i.p.v. los woordoverlap.*
*Cowork-update: 2026-06-03 — Bronladder ingevoerd (tier 1/2/3 op alle 93 bronnen), novelty-score + artikeltype actief in speurder/analist, entity_signals koppeltabel aangemaakt, intake bijgewerkt met entity_type classificatie, schrijver bijgewerkt met artikellengte per type en doorverwijzing. 15 nieuwe primaire bronnen geregistreerd + scrape-nieuw PM2-job gedebugged en stabiel (0 fouten). Werkend: Rekenkamer PDF, GR via OB SRU, Regio/COELO/BuurtBudget/GGD via RSS, ACM/Monumenten via HTML. Uitgeschakeld (JS/auth): RvS, Huurcommissie, OpenKvK, EP-online, EU-subsidies.*
*Cowork-update: 2026-06-03 — stadsgeest-weekreview scheduled task aangemaakt (zondag 09:00): leest transcripten van alle 10 routine-sessies, analyseert rapportages, kruischeckt met STATUS.md en schrijft verbeterplan naar weekreviews/weekreview-[datum].md*
*Cowork-update: 2026-06-03 — UNSPLASH_ACCESS_KEY toegevoegd aan scraper/.env; beide designer tasks (ochtend + middag) bijgewerkt: geen zwart-wit/archiefbeelden tenzij artikel expliciet over historisch onderwerp gaat.*
*Cowork-update: 2026-06-04 — run-weekly.js + run-all.js + run-browser.js + alle 47 scrapers hersteld uit git stash (waren kwijtgeraakt). PM2 scrape-wekelijks draait nu opnieuw correct.*
*Cowork-update: 2026-06-04 — stadsgeest-intake en stadsgeest-intake-middag bijgewerkt: historische items (is_historical=1) krijgen status 'watching' ipv 'new', [HISTORISCH] tag in summary, geen 48u-blokkade, tier-3 historische items worden overgeslagen. Entiteitsextractie geldt wel voor historische items.*
*Cowork-update: 2026-06-04 — dwarsverbanden.js gebouwd en geregistreerd in PM2 (dwarsverbanden-nacht 00:45, dwarsverbanden-middag 11:50 ma-vr). Script checked entity_signals op co-occurrences over bronklassen heen, schrijft crossref_briefing (apart veld, idempotent). Handmatig getest: 100 signalen gecheckt, 0 matches — correct, entiteitsextractie is nieuw en er is nog geen overlap. Nieuwe DB-kolommen: signals.crossref_checked, crossref_score, crossref_briefing.*
*Cowork-update: 2026-06-04 — Historische backfill volledig: 409 raw_items (is_historical=1) in Turso. Rechtspraak 267 (RBMNE+GHARL 2025+2026), bekendmakingen 71, raadsinformatie 58 (Notubiz JSON API), jaarverslagen 10, CBS wijken 2, subsidieregister 1. TenderNed: v2 API negeert alle filters, backfill gebruikt RSS feed (identiek aan dagelijkse scraper) — historische data al gedekt door dagelijkse scraper die continu draaide. lib.js bijgewerkt (is_historical param + ensureSource URL-deduplicatie). Intake getriggerd 10:30 voor verwerking naar watching-signalen.*
*Cowork-update: 2026-06-03 — update-feature volledig geïmplementeerd: Sanity article schema + updates[] (date + text, deployed), analist markeert TYPE: update + slug, schrijver PATCHt bestaand artikel, designer bumpt bijgewerkte artikelen naar homepage bij significante update; alle zes relevante tasks bijgewerkt. Frontend-kant nog te doen door Code: updates[] tonen op artikelpagina + updatedAt in artikelkaarten.*
*Code-update: 2026-06-04 — Artikelpagina (/artikel/[slug]): Tags-sectie verwijderd uit artikeltekst (alleen Onderwerpen-sidebar blijft); gerelateerde artikelen grid gebruikt nu CSS-klassen (acard/acard-img-wrap/acard-cat/acard-title) i.p.v. inline styles — hover-animatie op afbeelding en titelkleur nu correct; sectietitel hernoemd naar "Gerelateerde artikelen" (PR #38)*
*Code-update: 2026-06-04 — Artikelpagina sidebar herontworpen (PR #39): eerste gerelateerd artikel toont als featured kaart met afbeelding (16/9), categorie-label en hover-animatie; overige items blijven compacte tekst-links; "Onderwerpen" hernoemd naar "Gerelateerde onderwerpen"; grid onderaan artikel verwijderd — sidebar is nu enige plek voor gerelateerde artikelen. Nieuwe CSS-klassen: .rel-card, .rel-card-img, .rel-card-cat*
*Code-update: 2026-06-03 — updates[] feature geïmplementeerd (PR #35): nieuw ArticleUpdates client-component toont updatebalk op artikelpagina (niet-inklapbaar bij één update, inklapbare geschiedenis bij meerdere); updates[] en updatedAt toegevoegd aan GROQ-queries; "bijgewerkt" label op ArticleCard wanneer updatedAt na publishedAt valt*
*Code-update: 2026-06-02 — /persoon/[slug] herbouwd naar Stitch-design: foto met grayscale/hover, AI-dossier glassmorphism card, gerelateerde entiteiten chips, timeline met verticale lijn en bolletjes, 'Laad meer'-knop; personBySlugQuery uitgebreid met foto + embedded artikelen (PR #33)*
*Code-update: 2026-06-03 — Personen-blok toegevoegd aan artikel-sidebar: persons[] waren al opgehaald via articleBySlugQuery maar niet getoond; sidebar toont nu naam, rol/org en link naar /persoon/[slug] voor alle gekoppelde personen (PR #36)*
*Cowork-update: 2026-06-04 — Scrapers opsplitst per documenttype. OB-split: officielebekendmakingen-split.js gebouwd met GET-endpoint (zoek.officielebekendmakingen.nl). Bevestigd werkend: ob-omgevingsvergunningen (24 items), ob-verkeersbesluiten (25 items), ob-gemeenteblad-overig (23 items). Wekelijks: ob-gemeenschappelijke-regelingen / ob-provinciaal-blad / ob-waterschapsblad geregistreerd (0 items — dcterms.type filter geeft geen resultaten voor 