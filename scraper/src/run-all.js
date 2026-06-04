import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  'officielebekendmakingen.js',   // A4: Officiële Bekendmakingen (daily, SRU intermittent)
  'ns-verstoringen.js',           // NS verstoringen en werkzaamheden Amersfoort (AMF + AMR)
  'bluesky.js',                   // Bluesky zoekfeed + Amersfoortse accounts (daily)
  // pdok-bag.js en rechtspraak.js draaien wekelijks → run-weekly.js (aangemaakt in Groep B)
];

console.log(`\n=== Scrape-run gestart: ${new Date().toISOString()} ===\n`);

for (const scraper of scrapers) {
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 60000,
      encoding: 'utf8',
    });
    if (result) process.stdout.write(result);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(`FOUT bij ${scraper}:`, err.message);
  }
}

console.log(`\n=== Scrape-run voltooid: ${new Date().toISOString()} ===\n`);
