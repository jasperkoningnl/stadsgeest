// waaroverheid.nl — UITGESCHAKELD (2026-05-28)
// waaroverheid.nl/gemeente/amersfoort rendert niet in Playwright:
// pagina is volledig leeg (geen links, geen body-klassen, geen content).
// Waarschijnlijk: React SPA met bot-detectie of langdurige hydration.
// Zelfs met 7+ seconden wachttijd blijft de pagina leeg.
// TODO: probeer een API-endpoint (bijv. waaroverheid.nl/api/...) of andere aanpak.
// Dit script logt 0/0/0 zonder iets te proberen.

import db from '../db.js';
import { getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://waaroverheid.nl/gemeente/amersfoort';

async function scrape() {
  await getOrCreateSource(db, {
    name: 'WaarOverheid — gemeente Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });
  logResult('WaarOverheid — gemeente Amersfoort (uitgeschakeld)', 0, 0, 0);
}

scrape().catch(console.error);
