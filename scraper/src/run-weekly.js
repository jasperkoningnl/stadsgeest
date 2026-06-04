// run-weekly.js — wekelijkse scrapers (HTML-scraping en trage APIs)
// Draait 1x per dag via PM2. Bevat scrapers die minder frequent hoeven te draaien.

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const scrapers = [
  // Groep A — wekelijkse API-scrapers
  'pdok-bag.js',                  // A7: PDOK BAG adressen en gebouwen
  'rechtspraak.js',               // A8: Rechtspraak uitspraken

  // Groep B — HTML-scrapers en wekelijkse bronnen
  'ftm-amersfoort.js',            // B1: Follow the Money (filter Amersfoort)
  'alliantie.js',                 // B2: De Alliantie nieuws
  'odu.js',                       // B5: Omgevingsdienst regio Utrecht
  'prorail.js',                   // B6: ProRail nieuws (filter Amersfoort)
  'regio-amersfoort.js',          // B7: Bureau Regio Amersfoort RSS
  'archiefeemland.js',            // B8: Archief Eemland nieuws
  'subsidieregister.js',          // B14: Subsidieregister gemeente (jaarlijks, wekelijks gecheckt)
  'uwv-amersfoort.js',            // B16: UWV ArbeidsmarktInZicht Amersfoort
  'amersfoort-cijfers.js',        // B17: Amersfoort in Cijfers RSS
  'financien-amersfoort.js',      // B19: Financiën gemeente (jaarlijks, wekelijks gecheckt)

  // Groep C — server-rendered (geen Playwright nodig)
  'ibabs-woo.js',                 // C7: Bestuurlijke informatie iBabs (Woo-verzoeken, klachten, convenanten)
  'officielebekendmakingen-wekelijks.js', // OB wekelijkse subtypen (gem.regelingen, prov.blad, waterschapsblad)

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
  try {
    const result = execSync(`node "${path.join(__dirname, 'scrapers', scraper)}"`, {
      stdio: 'pipe',
      timeout: 120000,
      encoding: 'utf8',
    });
    if (result) process.stdout.write(result);
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    console.error(`FOUT bij ${scraper}:`, err.message);
  }
}

console.log(`\n=== Wekelijkse scrape-run voltooid: ${new Date().toISOString()} ===\n`);
