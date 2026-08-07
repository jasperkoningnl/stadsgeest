@AGENTS.md

## Stadsgeest — projectcontext

Stadsgeest is een journalistieke pipeline voor Amersfoort: ruim honderd openbare bronnen worden dagelijks doorzocht, geclusterd tot signalen, gewogen op nieuwswaarde en aangeleverd aan de redactie van Nieuwsplein33 via een dashboard op stadsgeest.nl.

```
bronnen → scrapers (PM2, notebook) → Turso → routines (Cowork) → dashboard (Next.js op Vercel)
```

Stack: Next.js, TypeScript, Tailwind, Turso (libsql), Vercel. **Geen Sanity meer** — dat is er op 7 augustus 2026 volledig uitgehaald. Kom je nog een verwijzing tegen, dan is dat een restant dat weg mag.

**Deze map bevat alles**: `src/` met de frontend en het dashboard, `scraper/` met de elf PM2-processen, en STATUS.md. Er is één werkkopie; `projects\stadsgeest033` is buiten gebruik gesteld.

De repo is publiek. Zet er geen sleutels in.

## Begin bij START-HIER.md

`C:\Users\Jasper Koning\Documents\Stadsgeest-documentatie\START-HIER.md` — wat het project is, wat er speelt, welke valkuilen er zijn. Lees dat eerst als je nieuw in een taak stapt.

## STATUS.md

STATUS.md staat in de hoofdmap van dit project en is het geheugen van Stadsgeest: ruim 900 regels, per routine-run wat er is gebeurd inclusief gevonden bugs en openstaande punten.

**Lees het uit deze map, nooit via GitHub.** `raw.githubusercontent.com` en de GitHub-webinterface leveren voor deze repo aantoonbaar gecachete versies van weken tot maanden oud — meerdere sessies zijn daardoor gaan denken dat het bestand van juni was. Het bestand staat in een gekoppelde projectmap; je hebt het gewoon. Bovenaan STATUS.md staat tot wanneer het is bijgewerkt; klopt dat niet met wat je verwacht, dan lees je een cache.

Lees het relevante deel voordat je iets aanraakt. Werk het bij aan het eind van elke sessie waarin je iets hebt gebouwd, gewijzigd of ontdekt, en push naar GitHub. Schrijf op wat je vond, niet alleen wat je deed — ook wat niet werkte, en wat je bewust hebt laten liggen.

Laat bestaande secties intact; voeg onderaan toe.

## Valkuilen

- **Roep nooit `pm2 save` aan als `pm2 jlist` leeg is.** Dat overschrijft `dump.pm2` met een lege lijst en wist alle elf jobdefinities. De daemon is al drie keer uitgevallen; er draait sinds 7 augustus elk uur een gezondheidscheck via `scraper\pm2-healthcheck.ps1`.
- **De scrapers hebben hun eigen `scraper/node_modules`.** Een `npm install` in de hoofdmap raakt die niet, en dat moet zo blijven.
- **`ConvertFrom-Json` faalt op `pm2 jlist` en `dump.pm2`** — de env-blokken bevatten sleutels die alleen in hoofdlettergebruik verschillen. Tel op naam.
- **Normale signaalaanmaak is 17 tot 28 per dag.** Grote uitschieters zijn backfill of registerruis, geen doorbraak.
- **De dashboard-inlog is lek**: de cookiewaarde staat hardcoded in `src/lib/dashboardAuth.ts`, in een publieke repo. Moet opgelost zijn voordat de redactie toegang krijgt; niet zelf oplossen zonder overleg.

## Werkwijze

Nederlands, ook in commentaar en commitberichten. Overleg ontwerpkeuzes met Jasper voordat je bouwt. Verifieer je eigen werk — tel wat je hebt weggeschreven, draai de build, controleer live. Een exit code van 0 is geen bewijs dat het klopt.
