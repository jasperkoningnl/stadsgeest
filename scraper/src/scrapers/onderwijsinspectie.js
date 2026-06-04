// onderwijsinspectie.js — UITGESCHAKELD (2026-05-28)
// toezichtresultaten.onderwijsinspectie.nl is een Angular SPA.
// - URL gewijzigd: /extern → /zoek (oud URL werkt niet meer)
// - Pagina laadt 47 resultaten maar scholen hebben GEEN <a href> naar detailpagina's.
//   Angular-componenten tonen schoolnamen + oordelen maar zijn niet klikbaar.
// - Tabel bestaat niet; scraper-logica op basis van <table tr> werkt niet.
// TODO: onderzoek Internet Schooldossier API of ander endpoint voor deep links.
// Dit script logt 0/0/0 zonder iets te proberen.

import db from '../db.js';
import { getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://toezichtresultaten.onderwijsinspectie.nl/zoek?sector=PO&q=Amersfoort';

async function scrape() {
  await getOrCreateSource(db, {
    name: 'Onderwijsinspectie — toezichtresultaten Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'community',
    scrapeFrequency: 'weekly',
  });
  logResult('Onderwijsinspectie — toezichtresultaten Amersfoort (uitgeschakeld)', 0, 0, 0);
}

scrape().catch(console.error);
