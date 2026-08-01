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
  'officielebekendmakingen.js',   // A4: Officiële Bekendmakingen (BROKEN — col-filter unsupported, zie officielebekendmakingen-split.js)
  'officielebekendmakingen-split.js', // A4b: OB gesplitst per type (Omgevingsvergunning, Verkeersbesluit, overig)
  'ns-verstoringen.js',           // NS verstoringen en werkzaamheden Amersfoort (AMF + AMR)
  'bluesky.js',                   // Bluesky zoekfeed + Amersfoortse accounts (daily)
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

console.log(`\n=== Scrape-run voltooid: ${new Date().toISOString()} ===\n`);
