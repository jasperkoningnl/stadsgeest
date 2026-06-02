# STATUS.md — Stadsgeest 033

## Cowork Scheduled Tasks (geverifieerd 2026-06-02)

- **stadsgeest-intake** — dagelijks 00:10 — raw_items verwerken, signalen bijwerken — laatste run: 2026-06-01 22:10 ✓
- **stadsgeest-speurder** (analist nacht) — dagelijks 01:01 — signalen analyseren, kandidaten selecteren — laatste run: 2026-06-01 23:01 ✓
- **stadsgeest-researcher** — dagelijks 02:04 — achtergrondinfo verzamelen per kandidaat — laatste run: 2026-06-02 00:04 ✓
- **stadsgeest-schrijver** — dagelijks 06:05 — artikelen schrijven en publiceren naar Sanity — laatste run: 2026-06-02 04:05 ✓
- **stadsgeest-designer** — dagelijks 07:05 — afbeeldingen zoeken, homepage-indeling — laatste run: 2026-06-02 05:05 ✓
- **stadsgeest-intake-middag** — ma-vr 11:36 — intake tweede run — laatste run: 2026-06-02 09:37 ✓
- **stadsgeest-analist-middag** — ma-vr 12:02 — analyse tweede run — laatste run: 2026-06-02 10:02 ✓
- **stadsgeest-researcher-middag** — ma-vr 12:34 — research tweede run — laatste run: 2026-06-02 10:35 ✓
- **stadsgeest-schrijver-middag** — ma-vr 16:39 — schrijver tweede run — laatste run: 2026-06-01 14:39 ✓
- **stadsgeest-designer-middag** — ma-vr 17:04 — designer tweede run — laatste run: 2026-06-01 15:04 ✓

## PM2 Scraper Jobs (geverifieerd 2026-06-02)

- **scrape-browser** — cron 06:30 — Playwright scrapers — laatste run: 2026-06-02 06:30–06:33, exit 0 ✓
- **scrape-dagelijks** — cron 07:00, 13:00, 19:00 — RSS/API scrapers — laatste run: 2026-06-02 07:00–07:01, exit 0 ✓
- **scrape-wekelijks** — cron 08:00 — trage API's/HTML — laatste run: 2026-06-02 08:00–08:01, exit 0 ✓
- **Auto-herstel:** Windows Task Scheduler voert `pm2 resurrect` uit bij inloggen (ingesteld 2026-06-02). Daemon-crashes binnen een sessie vereisen handmatig `pm2 start ecosystem.config.cjs`.

## Routines — wat ze doen

- **stadsgeest-speurder** — Haalt signalen met status `new` of `watching` op, zoekt dwarsverbanden tussen entiteiten, controleert of signalen trending zijn (≥3 items/24u). Selecteert max. 3 artikelkandidaten op basis van min. twee onafhankelijke bronnen, schrijft briefing in `summary`-veld, zet status op `researching`. Ruimt signalen op ouder dan 7-14 dagen zonder activiteit.
- **stadsgeest-researcher** — Pakt signalen met status `researching`, verrijkt briefing met historische context via websearch, verdiept betrokken personen en organisaties, spoort lokale stemmen op via Nextdoor en Reddit. Voegt `RESEARCH-AANVULLING`-blok toe aan `summary`-veld zonder status te wijzigen.
- **stadsgeest-schrijver** — Schrijft artikelen op basis van briefing + research-aanvulling, publiceert naar Sanity CMS.
- **stadsgeest-designer** — Zoekt passende afbeeldingen, stelt homepage-indeling samen.
- **stadsgeest-analist-middag** — Identieke logica als speurder, draait op werkdagen op basis van ochtendmateriaal. Max. 3 kandidaten, schrijft briefings, voert opruiming uit.

## Database Turso (geverifieerd 2026-06-02)

- **raw_items:** 1.610 items — alle verwerkt (0 onverwerkt)
- **signals:** 62 totaal — published: 26 / new: 11 / watching: 11 / discarded: 12 / researching: 2
- **sources:** aanwezig (scrapers registreren zichzelf automatisch)
- **entities:** aanwezig (exacte count niet geverifieerd)
- **Laatste scrape:** 2026-06-02 06:00:26 (Rechtspraak)
- **Meest actief 2026-06-02:** Nextdoor (169), Rechtspraak (143), 112-nu (125), De Stad Amersfoort (81), RTV Utrecht (70)
- **Personen/relaties-schema (aangemaakt 2026-06-02):** persons, organizations, roles, org_relations, person_relations, decisions, decision_persons, annual_reports
- **Eerste vulling (2026-06-02):** 8 organisaties, 60 personen, 60 rollen — college B&W, gemeenteraad (39 leden na verkiezingen 18 mrt 2026), Meander RvB, De Alliantie directie, Waterschap Vallei en Veluwe dagelijks bestuur, Portaal RvB

## Bronnen live

**Dagelijks (run-all.js):** gemeente-amersfoort, vru, de-stad-amersfoort, eemland1, nos-amersfoort, rijksoverheid, tenderned, cbs-statline, reddit-amersfoort, amersfoort-nieuws, waterschap, politie-amersfoort, 112nu-amersfoort, officielebekendmakingen, ns-verstoringen, bluesky

**Browser dagelijks (run-browser.js):** nieuwsplein33, rtvutrecht, raadsinformatie, nextdoor, igj-nvwa, omthuis

**Wekelijks (run-weekly.js):** pdok-bag, rechtspraak, ftm-amersfoort, alliantie, odu, prorail, regio-amersfoort, archiefeemland, subsidieregister, uwv-amersfoort, amersfoort-cijfers, financien-amersfoort, ibabs-woo, org-rss, bedrijven-amersfoort, erfgoed-natuur, onderwijs-cultuur, bw-besluiten, meander

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
- Laatste merge naar `main`: 2026-06-02 — PR #31 "Beveilig de site met wachtwoordbeveiliging via cookie-authenticatie"
- Vercel deployt automatisch bij push naar `main`; verwachte deploy: 2026-06-02 ✓ (niet geverifieerd via Vercel dashboard)

## Niet geverifieerd

- Inhoud van Sanity (artikelen, publicaties)
- Exacte count `entities` tabel
- Inhoud gepubliceerde artikelen (site wachtwoordbeveiligd)

---

*Cowork-update: 2026-06-02 — personen/relaties-schema aangemaakt + eerste vulling (60 personen)*
*Code-update: 2026-06-02 — eerste invulling Frontend-sectie*
