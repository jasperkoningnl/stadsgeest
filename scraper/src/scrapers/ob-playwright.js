// ob-playwright.js — UITGESCHAKELD (2026-05-28)
// zoek.officielebekendmakingen.nl/zoeken geeft HTTP 400 / "Pagina niet gevonden".
// De zoek-API is veranderd en werkt niet meer via Playwright of RSS (ook 400).
// TODO: controleer of er een nieuw endpoint is op officielebekendmakingen.nl.
// Dit script logt 0/0/0 zonder iets te proberen.

import { withBrowser } from '../browser.js';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

async function scrape() {
  // Uitgeschakeld — niets doen
  logResult('Officiële Bekendmakingen — Amersfoort (uitgeschakeld)', 0, 0, 0);
}

scrape().catch(console.error);
