// run-weekly.js — wekelijkse scrapers (HTML-scraping en trage APIs)
// Draait 1x per dag via PM2. Bevat scrapers die minder frequent hoeven te draaien.

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { recordScrapeRun } from './runner-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOB_NAME = 'run-weekly';

const scrapers = [
  // Groep A — wekelijkse API-scrapers
  'pdok-bag.js',                  // A7: PDOK BAG adressen en gebouwen
  'rechtspraak.js',               // A8: Rechtspraak uitspraken
  'rvs-uitspraken.js',            // Raad van State — Amersfoort (heringeschakeld 2026-08-02, zoekpagina server-rendered)

  // Groep B — HTML-scrapers en wekelijkse bronnen
  'ftm-amersfoort.js',            // B1: Follow the Money (filter Amersfoort)
  'alliantie.js',                 // B2: De Alliantie nieuws
  'odu.js',                       // B5: Omgevingsdienst regio Utrecht
  'prorail.js',                   // B6: ProRail nieuws (filter Amersfoort)
  'regio-amersfoort.js',          // B7: Bureau Regio Amersfoort RSS
  'archiefeemland.js',            // B8: Archief Eemland nieuws
  // B14: subsidieregister.js UITGESCHAKELD 24-07-2026 — sloeg alleen een link naar de PDF op
  //      als één raw_item van 205 tekens. Vervangen door subsidieregister-records.js, die de
  //      PDF-tabel uitpakt naar losse records in de tabel `subsidies`. Draait als eigen
  //      PM2-job (scrape-subsidies, zondag 09:30) omdat het parsen minuten duurt en
  //      deze runner een timeout per scraper hanteert.
  'uwv-amersfoort.js',            // B16: UWV ArbeidsmarktInZicht Amersfoort
  'amersfoort-cijfers.js',        // B17: Amersfoort in Cijfers RSS
  'financien-amersfoort.js',      // B19: Financiën gemeente (jaarlijks, wekelijks gecheckt)

  // Groep C — server-rendered (geen Playwright nodig)
  'ibabs-woo.js',                 // C7: Bestuurlijke informatie iBabs (Woo-verzoeken, klachten, convenanten)
  // officielebekendmakingen-wekelijks.js UITGESCHAKELD 24-07-2026: de creator-queries
  // stonden op 'Vallei en Veluwe' en 'provincie Utrecht' en haalden landelijke items binnen
  // (Heerhugowaard, Bergambacht, Roelofarendsveen). Vervangen door officielebekendmakingen-repo.js.

  // Groep D — organisatie-scrapers (RSS)
  'org-rss.js',                   // D1: Railcenter, Mondriaan, KAdE, Kamp, Natuurmonumenten,
                                  //     FrieslandCampina, CliniClowns, Flehite, RCE, HU, Defensie

  // Groep D — organisatie-scrapers (HTML)
  'bedrijven-amersfoort.js',      // D2: Qbuzz, Noordhoff
  'erfgoed-natuur.js',            // D3: Staatsbosbeheer, Restauratiefonds, Eigen Huis
  'onderwijs-cultuur.js',         // D4: Diabetesfonds, MBO Amersfoort
];

console.log(`\n=== Wekelijkse scrape-run gestart: ${new Date().toISOString()} ===\n`);

for (const scraper of scrapers) {
  const startedAt = new Date();
  let status = 'ok';
  let errorMessage = null;
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 120000,
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

console.log(`\n=== Wekelijkse scrape-run voltooid: ${new Date().toISOString()} ===\n`);
