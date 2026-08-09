// run-browser.js — Playwright browser-scrapers (client-rendered sites)
// Draait 1x per dag via PM2. Elke scraper lanceert zijn eigen headless Chromium,
// dus timeout is hoger: 3 minuten per scraper.

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { recordScrapeRun } from './runner-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOB_NAME = 'run-browser';

const scrapers = [
  // Groep C — dagelijkse browser-scrapers
  'nieuwsplein33.js',           // C1: Nieuwsplein33 Amersfoort
  'rtvutrecht.js',              // C2: RTV Utrecht (filter Amersfoort) — fix 2026-05-28
  'raadsinformatie.js',         // C3: Raadsinformatie Amersfoort (Notubiz) — brede scraper, blijft als fallback
  'raadsinformatie-types.js',   // C3b: Raadsinformatie type-detectie op titel (vergaderingen + catch-all)
  // 'raadsinformatie-api.js', // UITGESCHAKELD 2026-08-02: Notubiz-modulepagina's achter Cloudflare Turnstile; vervangen door raadsinformatie-ori.js in run-all.js (ORI API)
  'nextdoor.js',                // Nextdoor buurtberichten Amersfoort (login vereist)
  'igj-nvwa.js',                // IGJ + NVWA. LET OP: haalt op dit moment het verkeerde
                                //   binnen — zie BRONNEN.md. Blijft draaien; het streven is
                                //   repareren, niet uitzetten. De NVWA-kant is opgevolgd door
                                //   nvwa-inspectieresultaten.js hieronder, voor de IGJ-kant
                                //   is nog geen opvolger.
  'nvwa-inspectieresultaten.js', // Openbare inspectieresultaten horeca, per postcode
  'omthuis.js',                 // Omthuis woningcorporatie nieuwsberichten
  'ob-playwright.js',           // C10: Officiële Bekendmakingen. Draait op het SRU-endpoint van
                                //   zoek.officielebekendmakingen.nl, dat HTTP 500 geeft op elke
                                //   query. Opgevolgd door officielebekendmakingen-repo.js.
                                //   Blijft in de lijst tot Jasper besluit hem eruit te halen.

  // Groep C — wekelijkse browser-scrapers
  'bw-besluiten.js',            // C4: B&W besluitenlijsten — fix 2026-05-28
  'meander.js',                 // C5: Meander Medisch Centrum — fix 2026-05-28
  // De vier hieronder stonden gemarkeerd als UITGESCHAKELD terwijl de regel gewoon
  // werd uitgevoerd. Die aantekening klopte dus niet: ze draaien elke dag en leveren
  // elke dag nul. Ze staan te wachten op reparatie, niet op uitzetten.
  'ggd-regio-utrecht.js',       // C6: GGD regio Utrecht — draait, levert 0, te repareren
  'waaroverheid.js',            // C8: WaarOverheid — draait, levert 0, te repareren
  'onderwijsinspectie.js',      // C9: Onderwijsinspectie — draait, levert 0, te repareren
  'provincie-utrecht.js',       // C11: Provincie Utrecht — draait, levert 0, te repareren
];

console.log(`\n=== Browser-scrape-run gestart: ${new Date().toISOString()} ===\n`);

for (const scraper of scrapers) {
  const startedAt = new Date();
  let status = 'ok';
  let errorMessage = null;
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 180000,   // 3 min per scraper (browser-launch + render + netwerk)
      encoding: 'utf8',
      env: { ...process.env, SCRAPE_JOB_NAME: JOB_NAME },
    });
    if (result) process.stdout.write(result);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(`FOUT bij ${scraper}:`, err.message);
    status = err.signal === 'SIGTERM' ? 'timeout' : 'error';
    errorMessage = (err.stderr || err.message || '').toString();
  }
  const finishedAt = new Date();
  try {
    await recordScrapeRun(db, { jobName: JOB_NAME, scraperFile: scraper, startedAt, finishedAt, status, errorMessage });
  } catch (logErr) {
    console.error(`Kon scrape_runs niet bijwerken voor ${scraper}:`, logErr.message);
  }
}

// Entiteitsextractie over nieuwe items (P1, 2026-08-02)
try {
  const extractOut = execSync(`node "${path.join(__dirname, 'extract-entities.cjs')}"`, { stdio: 'pipe', timeout: 600000, encoding: 'utf8' });
  if (extractOut) process.stdout.write(extractOut);
} catch (err) {
  console.error('Entiteitsextractie mislukt:', err.message);
}

// Bronnenwacht (P4, 2026-08-02)
try {
  const bwOut = execSync(`node "${path.join(__dirname, 'bronnenwacht.cjs')}"`, { stdio: 'pipe', timeout: 300000, encoding: 'utf8', env: { ...process.env, SCRAPE_JOB_NAME: JOB_NAME } });
  if (bwOut) process.stdout.write(bwOut);
} catch (err) {
  console.error('Bronnenwacht mislukt:', err.message);
}

console.log(`\n=== Browser-scrape-run voltooid: ${new Date().toISOString()} ===\n`);
