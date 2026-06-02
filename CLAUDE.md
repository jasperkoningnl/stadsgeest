@AGENTS.md

## Stadsgeest — projectcontext

Stadsgeest is een AI-gedreven lokale nieuwssite voor Amersfoort (stadsgeest.nl / stadsgeest.vercel.app). De pipeline: scrapers (PM2 op notebook) → Turso database → Cowork routines (analyse, research, schrijven) → Sanity CMS → Next.js frontend op Vercel.

Stack: Next.js, TypeScript, Tailwind, Sanity, Turso (libsql), Vercel.

## STATUS.md

STATUS.md is het gedeelde projectstatusbestand. Cowork is eigenaar en pusht het naar GitHub na elke sessie. Jij (Code) vult alleen de Frontend-sectie in.

**Lokaal pad:** `C:\Users\Jasper Koning\Documents\Claude\Projects\Nieuwssite Amersfoort\STATUS.md`

Na elke sessie waarin je iets hebt gebouwd of gewijzigd:
1. Lees STATUS.md van bovenstaand pad
2. Update de sectie **Frontend — in te vullen door Code**:
   - Actieve routes en pagina's
   - Staat van Sanity-integratie
   - Laatste succesvolle Vercel deploy
3. Voeg toe of vervang: `Code-update: [datum] — [wat er is gewijzigd]`
4. Sla op. Cowork verzorgt de git push.

Laat alle Cowork-secties intact.
