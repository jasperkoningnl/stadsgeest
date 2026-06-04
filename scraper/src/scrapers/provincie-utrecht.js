// provincie-utrecht.js — UITGESCHAKELD (2026-05-28)
// www.provincie-utrecht.nl/actueel/nieuws geeft een Cloudflare "Security verifications"
// challenge page — Playwright wordt geblokkeerd, pagina bevat geen content.
// Eerder commentaar: RSS feed was al Cloudflare-geblokkeerd; nu ook Playwright geblokkeerd.
// TODO: zoek naar een ongeblokkeerd alternatief, bijv. via overheid.nl feed of
//       een publiek nieuwsarchief van de Provincie Utrecht.
// Dit script logt 0/0/0 zonder iets te proberen.

import db from '../db.js';
import { getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.provincie-utrecht.nl/actueel/nieuws';

async function scrape() {
  await getOrCreateSource(db, {
    name: 'Provincie Utrecht — nieuws Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });
  logResult('Provincie Utrecht — nieuws Amersfoort (uitgeschakeld)', 0, 0, 0);
}

scrape().catch(console.error);
