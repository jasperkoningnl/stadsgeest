import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { recordScrapeRun } from './runner-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOB_NAME = 'run-all';

const scrapers = [
  // Fase 1 — originele 11 scrapers
  'gemeente-amersfoort.js',
  'vru.js',
  'de-stad-amersfoort.js',
  'eemland1.js',
  'nos-amersfoort.js',
  'rijksoverheid.js',
  'tenderned.js',
  'cbs-statline.js',
  'reddit-amersfoort.js',
  'amersfoort-nieuws.js',
  'waterschap.js',
  // Groep A — dagelijkse/uurlijkse scrapers
  'politie-amersfoort.js',        // A1: Politie RSS (daily)
  '112nu-amersfoort.js',          // A3: 112-nu P2000 RSS (hourly)
  // A4/A4b: officielebekendmakingen.js en -split.js UITGESCHAKELD 24-07-2026.
  // Het endpoint zoek.officielebekendmakingen.nl/sru/Search geeft HTTP 500 op elke query;
  // beide draaiden sinds 4 juni leeg. Vervangen door officielebekendmakingen-repo.js,
  // die via repository.overheid.nl draait en volledige documenttekst ophaalt.
  // Draait als eigen PM2-job (scrape-ob) omdat de fulltext-fetch langer duurt dan
  // de 60s-timeout van deze runner.
  'ns-verstoringen.js',           // NS verstoringen en werkzaamheden Amersfoort (AMF + AMR)
  'bluesky.js',                   // Bluesky zoekfeed + Amersfoortse accounts (daily)
'raadsinformatie-ori.js',       // Raadsinformatie via Open Raadsinformatie API (2026-08-02, vervangt Notubiz-Playwright — Cloudflare)
  // pdok-bag.js en rechtspraak.js draaien wekelijks → run-weekly.js (aangemaakt in Groep B)
];

console.log(`\n=== Scrape-run gestart: ${new Date().toISOString()} ===\n`);

for (const scraper of scrapers) {
  const startedAt = new Date();
  let status = 'ok';
  let errorMessage = null;
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 60000,
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

// Entiteitsextractie is hier op 2026-08-09 weggehaald en een eigen PM2-job geworden
// (`extract-entities`, 05:00). Reden: de extractie liep direct na het scrapen en dus
// altijd vóór fetch-fulltext (04:00). Voor alles wat 's middags en 's avonds binnenkwam
// werd daardoor alleen de titel gelezen in plaats van de documenttekst — vandaar vijf
// adressen in bijna vijfduizend documenten. De extractie markeert items bovendien
// permanent met entities_scanned_at, dus die misser werd nooit vanzelf hersteld.
// De keten is nu: scrapen → fulltext → entiteiten → intake. Zet dit hier niet terug.

// Bronnenwacht (P4, 2026-08-02) — meet gezondheid in runs, niet kalendertijd
try {
  const bwOut = execSync(`node "${path.join(__dirname, 'bronnenwacht.cjs')}"`, { stdio: 'pipe', timeout: 300000, encoding: 'utf8', env: { ...process.env, SCRAPE_JOB_NAME: JOB_NAME } });
  if (bwOut) process.stdout.write(bwOut);
} catch (err) {
  console.error('Bronnenwacht mislukt:', err.message);
}

console.log(`\n=== Scrape-run voltooid: ${new Date().toISOString()} ===\n`);
