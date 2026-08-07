# Stadsgeest

Persbureau voor lokale journalistiek. Stadsgeest doorzoekt dagelijks ruim honderd openbare bronnen over Amersfoort, clustert wat binnenkomt tot signalen, weegt die op nieuwswaarde en levert de vondsten aan bij een nieuwsredactie.

Stadsgeest publiceert zelf niet. Tot augustus 2026 draaide hier een eigen publieksnieuwssite op; die is geparkeerd. Wat resteert is de kern: een systeem dat grote hoeveelheden brondocumenten doorspit en eruit haalt wat de moeite waard is.

**Live:** [stadsgeest.nl](https://stadsgeest.nl) — één publieke voorpagina, het redactiedashboard zit achter een inlog.

## Hoe het werkt

```
bronnen → scrapers (PM2) → Turso → routines → dashboard (Next.js op Vercel)
```

1. **Scrapen** — elf cron-gestuurde processen halen raadsstukken, officiële bekendmakingen, vergunningen, subsidieregisters, rechtspraak, aanbestedingen, inspectierapporten en jaarverslagen op.
2. **Intake** — nieuwe items worden geclusterd tot signalen op basis van inhoudelijke overlap; entiteiten worden geëxtraheerd en gekoppeld. Elke wel/niet-beslissing wordt met reden vastgelegd.
3. **Analyse** — signalen worden gewogen: hoeveel onafhankelijke bronnen bevestigen het, is het eerder gemeld, zijn er dwarsverbanden via gedeelde entiteiten. Verreweg het meeste valt af.
4. **Doorgeven** — wat overblijft komt in een dashboard voor de redactie: het signaal, de brondocumenten, de achtergrond en de open vragen.

### Bronladder

- **Tier 1** — publicatiebronnen, zelfstandig nieuwswaardig: rechtspraak, raadsinformatie, TenderNed, CBS, IGJ/NVWA, subsidieregisters, B&W-besluiten
- **Tier 2** — corroboratiebronnen: gemeente, veiligheidsregio, woningcorporaties, waterschap, Rijksoverheid
- **Tier 3** — detectiebronnen, alleen signaalfunctie: 112-meldingen, buurtplatforms, lokale media

## Stack

Next.js, TypeScript, Tailwind, Turso (libsql), Vercel. Scrapers in Node met Playwright, beheerd via PM2. Analyse via Claude.

## Structuur

| Map | Inhoud |
|---|---|
| `src/app/` | Voorpagina, inlog en het redactionele dashboard |
| `src/lib/` | Turso-client en de dashboardqueries |
| `scraper/` | De scrapers, de intake en de PM2-jobs |

`STATUS.md` bevat de actuele staat en per routine-run wat er is gebeurd, inclusief gevonden bugs.

## Lokaal draaien

```bash
npm install
npm run dev
```

Vereist `TURSO_URL` en `TURSO_AUTH_TOKEN` in `.env.local`. Zonder die variabelen start het dashboard wel, maar toont het een melding in plaats van data.

## Transparantie

Het doorzoeken, clusteren en wegen gebeurt geautomatiseerd, met taalmodellen. Een signaal uit Stadsgeest is een aanwijzing, geen bevestigd feit: het systeem legt verbanden die niet kloppen, mist context die een verslaggever meteen zou zien, en haalt met regelmaat een routinevergunning binnen alsof het nieuws is. Daarom wordt bij elk signaal vastgelegd waar het vandaan komt en waarom het is doorgelaten, en eindigt de keten bij een journalist die beslist of er een verhaal in zit.

---

Een project van Jasper Koning — stadsgeest@proton.me
