// run-browser.js — Playwright browser-scrapers (client-rendered sites)
// Draait 1x per dag via PM2. Elke scraper lanceert zijn eigen headless Chromium,
// dus timeout is hoger: 3 minuten per scraper.

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const scrapers = [
  // Groep C — dagelijkse browser-scrapers
  'nieuwsplein33.js',           // C1: Nieuwsplein33 Amersfoort
  'rtvutrecht.js',              // C2: RTV Utrecht (filter Amersfoort) — fix 2026-05-28
  'raadsinformatie.js',         // C3: Raadsinformatie Amersfoort (Notubiz) — brede scraper, blijft als fallback
  'raadsinformatie-types.js',   // C3b: Raadsinformatie type-detectie op titel (vergaderingen + catch-all)
  'raadsinformatie-api.js',    // C3c: Raadsinformatie Notubiz module-paginas per type (schriftelijke vragen, moties, RIB, ingekomen stukken)
  'nextdoor.js',                // Nextdoor buurtberichten Amersfoort (login vereist)
  'igj-nvwa.js',                // IGJ + NVWA inspectieresultaten (zoek op Amersfoort)
  'omthuis.js',                 // Omthuis woningcorporatie nieuwsberichten
  'ob-playwright.js',           // C10: Officiële Bekendmakingen — UITGESCHAKELD

  // Groep C — wekelijkse browser-scrapers
  'bw-besluiten.js',            // C4: B&W besluitenlijsten — fix 2026-05-28
  'meander.js',                 // C5: Meander Medisch Centrum — fix 2026-05-28
  'ggd-regio-utrecht.js',       // C6: GGD regio Utrecht — UITGESCHAKELD
  'waaroverheid.js',            // C8: WaarOverheid — UITGESCHAKELD
  'onderwijsinspectie.js',      // C9: Onderwijsinspectie — UITGESCHAKELD
  'provincie-utrecht.js',       // C11: Provincie Utrecht — UITGESCHAKELD
];

console.log(`\n=== Browser-scrape-run gestart: ${new Date().toISOString()} ===\n`);

for (const scraper of scrapers) {
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 180000,   // 3 min per scraper (browser-launch + render + netwerk)
      encoding: 'utf8',
    });
    if (result) process.stdout.write(result);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(`FOUT bij ${scraper}:`, err.message);
  }
}

console.log(`\n=== Browser-scrape-run voltooid: ${new Date().toISOString()} ===\n`);
