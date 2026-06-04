# STATUS.md — Stadsgeest 033

## Cowork Scheduled Tasks (geverifieerd 2026-06-04)

- **stadsgeest-intake** — dagelijks 00:10 — raw_items verwerken, signalen bijwerken — laatste run: 2026-06-04 10:30 (handmatig getriggerd voor historische backfill-verwerking) ✓
- **stadsgeest-speurder** (analist nacht) — dagelijks 01:01 — signalen analyseren, kandidaten selecteren — laatste run: 2026-06-03 23:00 ✓
- **stadsgeest-researcher** — dagelijks 02:04 — achtergrondinfo verzamelen per kandidaat — laatste run: 2026-06-04 00:04 ✓
- **stadsgeest-schrijver** — dagelijks 06:05 — artikelen schrijven en publiceren naar Sanity — laatste run: 2026-06-04 04:05 ✓
- **stadsgeest-designer** — dagelijks 07:05 — afbeeldingen zoeken, homepage-indeling — laatste run: 2026-06-04 05:04 ✓
- **stadsgeest-intake-middag** — ma-vr 11:36 — intake tweede run — laatste run: 2026-06-03 09:37 ✓ — bijgewerkt 2026-06-04: historische items → status 'watching'
- **stadsgeest-analist-middag** — ma-vr 12:02 — analyse tweede run — laatste run: 2026-06-03 10:02 ✓
- **stadsgeest-researcher-middag** — ma-vr 12:34 — research tweede run — laatste run: 2026-06-03 10:35 ✓
- **stadsgeest-schrijver-middag** — ma-vr 16:39 — schrijver tweede run — laatste run: 2026-06-03 14:39 ✓
- **stadsgeest-designer-middag** — ma-vr 17:04 — designer tweede run — laatste run: 2026-06-03 15:04 ✓
- **stadsgeest-weekreview** — zondag 09:00 — alle routine-rapportages analyseren, verbeterplan opstellen, STATUS.md kruischeck — eerste run: 2026-06-07

## PM2 Scraper Jobs (geverifieerd 2026-06-04)

- **scrape-browser** — cron 06:30 — Playwright scrapers (run-browser.js) — laatste run: 2026-06-04 06:30 ✓
- **scrape-dagelijks** — cron 07:00, 13:00, 19:00 — RSS/API scrapers (run-all.js) — laatste run: 2026-06-04 07:00 ✓
- **scrape-wekelijks** — cron 08:00 — trage API's/HTML (run-weekly.js) — hersteld 2026-06-04 (scripts waren kwijtgeraakt uit git) — laatste run: 2026-06-04 08:00 ✓
- **scrape-nieuw** — cron ma 09:00 — 15 nieuwe primaire bronnen (run-nieuw.js) — laatste run: 2026-06-03 20:04 — stabiel (10 van 15 actief; RvS/Huurcommissie/OpenKvK/EP-online/EU-subsidies uitgeschakeld wegens JS/auth)
- **dwarsverbanden-nacht** — cron 00:45 — co-occurrence analyse via entity_signals, schrijft crossref_briefing naar signalen (dwarsverbanden.js) — toegevoegd 2026-06-04
- **dwarsverbanden-middag** — cron 11:50 ma-vr — zelfde als nacht, tweede run — toegevoegd 2026-06-04
- **Auto-herstel:** Windows Task Scheduler voert `pm2 resurrect` uit bij inloggen (ingesteld 2026-06-02).
- **Scripts hersteld 2026-06-04:** run-weekly.js, run-all.js, run-browser.js, db.js, utils.js, browser.js + 47 scrapers in scraper/src/scrapers/ — waren verloren als git untracked files in stash.

## Routines — wat ze doen

- **stadsgeest-speurder** — Haalt signalen met status `new` of `watching` op, zoekt dwarsverbanden tussen entiteiten, controleert clustering (meerdere incidenten van hetzelfde type op één nacht/dag = zelf een verhaal), checkt Sanity-archief op eerdere berichtgeving over elk veelbelovend signaal, controleert of signalen trending zijn (≥3 items/24u). Selecteert max. 3 artikelkandidaten op basis van min. twee onafhankelijke bronnen, schrijft briefing in `summary`-veld, zet status op `researching`. Ruimt signalen op ouder dan 7-14 dagen zonder activiteit. Markeert signals die voortbouwen op een bestaand artikel als `TYPE: update` met slug van het doelartikel.
- **stadsgeest-researcher** — Pakt signalen met status `researching`, verrijkt briefing met historische context via websearch, verdiept betrokken personen en organisaties, spoort lokale stemmen op via Nextdoor en Reddit. Noteert Nextdoor-posts als letterlijk citaat met naam, wijk, datum en foto-URL (FOTO_URL). Voegt `RESEARCH-AANVULLING`-blok toe aan `summary`-veld zonder status te wijzigen.
- **stadsgeest-schrijver** — Schrijft artikelen op basis van briefing + research-aanvulling, publiceert naar Sanity CMS. Bij `TYPE: update` in de briefing: PATCHt het bestaande Sanity-document (voegt entry toe aan `updates[]` en werkt `updatedAt` bij) in plaats van een nieuw artikel aan te maken. Verwerkt Nextdoor-quotes als blockquote in Portable Text met attributieregel; als FOTO_URL aanwezig is: downloadt foto en uploadt als mainImage naar Sanity met credit "Foto: [naam] via Nextdoor".
- **stadsgeest-designer** — Zoekt passende afbeeldingen, stelt homepage-indeling samen. Beschouwt ook bijgewerkte artikelen (updatedAt binnen 48 uur) als kandidaat voor bump naar homepage of priority "top" — mits de update inhoudelijk significant is.
- **stadsgeest-analist-middag** — Identieke logica als speurder, inclusief clustering-check, Sanity-archief check en update-detectie. Draait op werkdagen op basis van ochtendmateriaal. Max. 3 kandidaten, schrijft briefings, voert opruiming uit. Beide analist-prompts bijgewerkt 2026-06-04: Stap 4 is nu verplicht proactief (WebSearch voor elk signaal novelty ≥ 3, hardcoded categorieën), briefing bevat nieuw veld ONDERZOEKSOPDRACHT VOOR RESEARCHER met concrete zoektermen, bronnen en vragen.

## Database Turso (geverifieerd 2026-06-04)

- **raw_items:** >2.000 items — waarvan 409 met is_historical=1 (historische backfill 2026-06-04)
- **is_historical verdeling (geverifieerd 2026-06-04):** rechtspraak 267, bekendmakingen 71, raadsinformatie 58, jaarverslagen 10, cbs-statline 2, subsidieregister 1
- **signals:** niet opnieuw geverifieerd — intake van 2026-06-04 10:30 verwerkt historische items naar status 'watching'
- **sources:** 105+ bronnen — split-bronnen toegevoegd 2026-06-04 (ids 109–120): 3x OB dagelijks, 3x OB wekelijks, 6x raadsinformatie per type
- **entities / entity_signals:** aanwezig, worden gevuld door intake bij verwerking historische items
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
- Laatste merge naar `main`: 2026-06-04 — PR #38 "Fix related articles layout and remove duplicate tags section"
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
- Exacte count `entities` tabel na backfill-intake
- Inhoud gepubliceerde artikelen (site wachtwoordbeveiligd)

---

*Cowork-update: 2026-06-03 — Bronladder ingevoerd (tier 1/2/3 op alle 93 bronnen), novelty-score + artikeltype actief in speurder/analist, entity_signals koppeltabel aangemaakt, intake bijgewerkt met entity_type classificatie, schrijver bijgewerkt met artikellengte per type en doorverwijzing. 15 nieuwe primaire bronnen geregistreerd + scrape-nieuw PM2-job gedebugged en stabiel (0 fouten). Werkend: Rekenkamer PDF, GR via OB SRU, Regio/COELO/BuurtBudget/GGD via RSS, ACM/Monumenten via HTML. Uitgeschakeld (JS/auth): RvS, Huurcommissie, OpenKvK, EP-online, EU-subsidies.*
*Cowork-update: 2026-06-03 — stadsgeest-weekreview scheduled task aangemaakt (zondag 09:00): leest transcripten van alle 10 routine-sessies, analyseert rapportages, kruischeckt met STATUS.md en schrijft verbeterplan naar weekreviews/weekreview-[datum].md*
*Cowork-update: 2026-06-03 — UNSPLASH_ACCESS_KEY toegevoegd aan scraper/.env; beide designer tasks (ochtend + middag) bijgewerkt: geen zwart-wit/archiefbeelden tenzij artikel expliciet over historisch onderwerp gaat.*
*Cowork-update: 2026-06-04 — run-weekly.js + run-all.js + run-browser.js + alle 47 scrapers hersteld uit git stash (waren kwijtgeraakt). PM2 scrape-wekelijks draait nu opnieuw correct.*
*Cowork-update: 2026-06-04 — stadsgeest-intake en stadsgeest-intake-middag bijgewerkt: historische items (is_historical=1) krijgen status 'watching' ipv 'new', [HISTORISCH] tag in summary, geen 48u-blokkade, tier-3 historische items worden overgeslagen. Entiteitsextractie geldt wel voor historische items.*
*Cowork-update: 2026-06-04 — dwarsverbanden.js gebouwd en geregistreerd in PM2 (dwarsverbanden-nacht 00:45, dwarsverbanden-middag 11:50 ma-vr). Script checked entity_signals op co-occurrences over bronklassen heen, schrijft crossref_briefing (apart veld, idempotent). Handmatig getest: 100 signalen gecheckt, 0 matches — correct, entiteitsextractie is nieuw en er is nog geen overlap. Nieuwe DB-kolommen: signals.crossref_checked, crossref_score, crossref_briefing.*
*Cowork-update: 2026-06-04 — Historische backfill volledig: 409 raw_items (is_historical=1) in Turso. Rechtspraak 267 (RBMNE+GHARL 2025+2026), bekendmakingen 71, raadsinformatie 58 (Notubiz JSON API), jaarverslagen 10, CBS wijken 2, subsidieregister 1. TenderNed: v2 API negeert alle filters, backfill gebruikt RSS feed (identiek aan dagelijkse scraper) — historische data al gedekt door dagelijkse scraper die continu draaide. lib.js bijgewerkt (is_historical param + ensureSource URL-deduplicatie). Intake getriggerd 10:30 voor verwerking naar watching-signalen.*
*Cowork-update: 2026-06-03 — update-feature volledig geïmplementeerd: Sanity article schema + updates[] (date + text, deployed), analist markeert TYPE: update + slug, schrijver PATCHt bestaand artikel, designer bumpt bijgewerkte artikelen naar homepage bij significante update; alle zes relevante tasks bijgewerkt. Frontend-kant nog te doen door Code: updates[] tonen op artikelpagina + updatedAt in artikelkaarten.*
*Code-update: 2026-06-04 — Artikelpagina (/artikel/[slug]): Tags-sectie verwijderd uit artikeltekst (alleen Onderwerpen-sidebar blijft); gerelateerde artikelen grid gebruikt nu CSS-klassen (acard/acard-img-wrap/acard-cat/acard-title) i.p.v. inline styles — hover-animatie op afbeelding en titelkleur nu correct; sectietitel hernoemd naar "Gerelateerde artikelen" (PR #38)*
*Code-update: 2026-06-03 — updates[] feature geïmplementeerd (PR #35): nieuw ArticleUpdates client-component toont updatebalk op artikelpagina (niet-inklapbaar bij één update, inklapbare geschiedenis bij meerdere); updates[] en updatedAt toegevoegd aan GROQ-queries; "bijgewerkt" label op ArticleCard wanneer updatedAt na publishedAt valt*
*Code-update: 2026-06-02 — /persoon/[slug] herbouwd naar Stitch-design: foto met grayscale/hover, AI-dossier glassmorphism card, gerelateerde entiteiten chips, timeline met verticale lijn en bolletjes, 'Laad meer'-knop; personBySlugQuery uitgebreid met foto + embedded artikelen (PR #33)*
*Code-update: 2026-06-03 — Personen-blok toegevoegd aan artikel-sidebar: persons[] waren al opgehaald via articleBySlugQuery maar niet getoond; sidebar toont nu naam, rol/org en link naar /persoon/[slug] voor alle gekoppelde personen (PR #36)*
*Cowork-update: 2026-06-04 — Scrapers opsplitst per documenttype. OB-split: officielebekendmakingen-split.js gebouwd met GET-endpoint (zoek.officielebekendmakingen.nl). Bevestigd werkend: ob-omgevingsvergunningen (24 items), ob-verkeersbesluiten (25 items), ob-gemeenteblad-overig (23 items). Wekelijks: ob-gemeenschappelijke-regelingen / ob-provinciaal-blad / ob-waterschapsblad geregistreerd (0 items — dcterms.type filter geeft geen resultaten voor deze types, toekomstige monitoring). Bestaande officielebekendmakingen.js gemarkeerd BROKEN (col-filter unsupported in SRU 2.0, gaf al jaren 0 items). Raadsinformatie: raadsinformatie-types.js gebouwd met type-detectie op titels. ORI API volledig offline (404). Notubiz feeds geblokkeerd (Cloudflare). Huidige run: 5 items naar raad-vergaderingen catch-all — type-classificatie (moties, schriftelijke vragen, etc.) actief zodra documenten met die titels verschijnen. 12 nieuwe bronnen in sources-tabel (ids 109–120), 77 raw_items klaar voor intake.*
*Cowork-update: 2026-06-04 — raadsinformatie-api.js gebouwd (Notubiz module-paginas via Playwright). Module-IDs: 4=schriftelijke vragen, 5=raadsinformatiebrieven, 6=moties, 1=ingekomen stukken. Eerste run: 4+0+2+9=15 items. OB wekelijks gefixed: dcterms.type werkt niet, creator-queries ingezet (Vallei en Veluwe voor waterschapsblad, provincie Utrecht voor provinciaal blad) — 20+20+20=60 items eerste run.*
*Cowork-update: 2026-06-04 — STATUS.md kruischeck: scrape-nieuw debug-fase verwijderd uit Niet geverifieerd (opgelost, 10/15 actief); weekreview-2026-06-03.md + cowork-prompt-dwarsverbanden-script.md toegevoegd aan repo.*
*Cowork-update: 2026-06-04 — Sanity fixes: (1) bronlinks toegevoegd aan 2 artikelen zonder sources: isolatiesubsidie (2 gem.amersfoort.nl bronnen) en woningexplosies (2 politie.nl getuigenoproepen + destadamersfoort.nl); (2) tag 'gemeentepolitiek' verwijderd en gemergd naar bestaande tag 'politiek' (was gekoppeld aan isolatiesubsidie-artikel); (3) schrijver-prompts (ochtend + middag) bijgewerkt: sources zijn nu verplicht vóór publicatie (websearch als URL ontbreekt, niet publiceren zonder minstens één source), tags altijd opzoeken in bestaande lijst vóór aanmaken nieuw (hardcoded ID-tabel toegevoegd).*
*Cowork-update: 2026-06-04 — Analist-prompts (speurder + analist-middag) bijgewerkt: Stap 4 "Aanvullend onderzoek" is nu verplicht proactief voor elk signaal met novelty-score ≥ 3 (was: alleen als content te mager). Verplichte WebSearch-categorieën: infrastructuur, veiligheid, bestuur, economie, milieu. Leeg archief + weinig resultaten = geen reden tot afwijzen, wél reden voor researcher-opdracht. Stap 4b toegevoegd: watching-signalen ≥3 dagen checken via WebSearch. Briefing-format uitgebreid met ONDERZOEKSOPDRACHT VOOR RESEARCHER (zoektermen, te checken bronnen, concrete vragen, historische context) — verplicht in alle formats incl. news/brief.*
*Cowork-update: 2026-06-04 — Gerelateerde artikelen gefixed: schrijver zette "Lees ook:" als inline Portable Text in body met hardcoded href; frontend gebruikt echter een dedicated relatedArticles[]-veld (gerenderd als sidebar-blok + artikelkaarten-grid). Woningexplosies-artikel gepatcht: leesook/blok7 body-blokken verwijderd, relatedArticles-referentie naar "Vier explosies"-artikel (zMv29Rak0PFLgbJF6zgIt2) toegevoegd. Beide schrijver-prompts bijgewerkt: inline lees-ook in body is verboden, altijd relatedArticles-veld gebruiken.*

