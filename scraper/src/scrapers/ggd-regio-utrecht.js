// ggd-regio-utrecht.js — GGD regio Utrecht, berichten over Amersfoort
//
// Herbouwd op 9 augustus 2026. Wat hier stond logde 0/0/0 zonder iets te proberen,
// met als reden dat www.ggdregioutrecht.nl een connection timeout gaf. Dat klopt
// nog steeds, en de reden is simpel: dat domein bestaat niet meer. De GGD zit op
// ggdru.nl, een WordPress-site. De REST-API daarvan is open:
//
//   https://ggdru.nl/wp-json/wp/v2/posts?search=Amersfoort&per_page=50
//
// Die geeft de volledige tekst mee, plus datum en permalink. Op 9 augustus 2026
// leverde de zoekterm Amersfoort twaalf berichten op, het oudste uit 2024.
//
// LET OP — OVERLAP, VOORGELEGD AAN JASPER. Bronrij 93 ('GGD Gezondheidsmonitor
// regio Utrecht', 17 items) leest via run-nieuw.js dezelfde site, namelijk
// https://ggdru.nl/feed/, en slaat exact hetzelfde permalinkformaat op. Rij 36 en
// rij 93 zijn daarmee feitelijk dezelfde bron onder twee namen; het verschil is dat
// rij 93 alles uit de provincie pakt en deze alleen wat over Amersfoort gaat.
// Zolang daar geen beslissing over is, slaat deze scraper niets op wat al onder een
// ándere bron in raw_items staat — zie de controle in `alBekend()`. Daardoor kan
// het aantal nieuwe items hier structureel laag blijven; dat is dan geen storing
// maar de overlap.
//
// De bron-URL blijft het oude adres, omdat getOrCreateSource op url matcht en een
// nieuwe url een tweede bronrij zou aanmaken.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://www.ggdregioutrecht.nl/nieuws';   // alleen bronsleutel, zie boven
const API = 'https://ggdru.nl/wp-json/wp/v2/posts?per_page=50&search=Amersfoort';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// WordPress geeft HTML in title.rendered en content.rendered.
function striptHtml(html) {
  return (html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8216;|&#8217;|&#039;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function alBekend(url, sourceId) {
  const r = await db.execute({
    sql: 'SELECT 1 FROM raw_items WHERE external_url = ? AND source_id != ? LIMIT 1',
    args: [url, sourceId],
  });
  return r.rows.length > 0;
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'GGD regio Utrecht nieuws',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'community',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;

  try {
    const resp = await fetch(API, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} op de WordPress-API van ggdru.nl`);
    const posts = await resp.json();
    if (!Array.isArray(posts)) throw new Error('WordPress-API gaf geen lijst terug');

    for (const post of posts) {
      const url = post.link ?? '';
      const titel = striptHtml(post.title?.rendered);
      if (!url || titel.length < 6) continue;
      gevonden++;

      if (await alBekend(url, sourceId)) { skipped++; continue; }

      const tekst = striptHtml(post.content?.rendered);
      // De zoekterm van WordPress matcht ook op losse woorddelen; controleer zelf.
      if (!/amersfoort|eemland|soesterkwartier|vathorst|hoogland|nieuwland|kattenbroek/i.test(`${titel} ${tekst}`)) {
        skipped++;
        continue;
      }

      try {
        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: url,
          title: titel.substring(0, 500),
          content: tekst.substring(0, 8000),
          summary: striptHtml(post.excerpt?.rendered).substring(0, 500),
          publishedAt: post.date ?? null,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`Opslaan "${titel.substring(0, 60)}": ${err.message}`);
      }
    }
  } catch (err) {
    errors++;
    console.error(`[GGD regio Utrecht] ${err.message}`);
  }

  await logResult(db, sourceId, 'GGD regio Utrecht nieuws', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
