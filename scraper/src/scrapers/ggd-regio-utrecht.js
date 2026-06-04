// ggd-regio-utrecht.js — UITGESCHAKELD (2026-05-28)
// www.ggdregioutrecht.nl geeft ERR_CONNECTION_TIMED_OUT bij Playwright.
// Site is mogelijk onbereikbaar, verhuisd, of blokkeert headless browsers.
// TODO: controleer de correcte URL (evt. ggdhm.nl of ggdru.nl) en test opnieuw.
// Dit script logt 0/0/0 zonder iets te proberen.

import db from '../db.js';
import { getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.ggdregioutrecht.nl/nieuws';

async function scrape() {
  await getOrCreateSource(db, {
    name: 'GGD regio Utrecht nieuws',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'community',
    scrapeFrequency: 'weekly',
  });
  logResult('GGD regio Utrecht nieuws (uitgeschakeld)', 0, 0, 0);
}

scrape().catch(console.error);
