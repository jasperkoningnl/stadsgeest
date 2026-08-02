// Raad van State — uitspraken met 'Amersfoort' (heringeschakeld 2026-08-02).
// De zoekpagina blijkt server-rendered (geen JS nodig); de RSS zit wel achter Cloudflare.
// Wekelijks. Haalt per nieuwe uitspraak ook de volledige tekst op (max 10 per run).
import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const ZOEK = 'https://www.raadvanstate.nl/uitspraken/?zoeken=true&zoeken_term=amersfoort';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Raad van State — Amersfoort',
    url: ZOEK,
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'weekly',
  });

  const r = await fetch(ZOEK, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const $ = cheerio.load(await r.text());

  const urls = new Map();
  $('a[href*="/uitspraken/@"]').each((_, el) => {
    const href = ($(el).attr('href') || '').split('#')[0].split('?')[0];
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (href && !urls.has(href) && /\d{9}/.test(t)) urls.set(href, t);
  });

  let saved = 0, skipped = 0, errors = 0, fetched = 0;
  for (const [url, zaaknr] of urls) {
    try {
      let title = `RvS-uitspraak ${zaaknr}`;
      let text = '';
      if (fetched < 10) {
        const pr = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
        if (pr.ok) {
          const p$ = cheerio.load(await pr.text());
          const h1 = p$('h1').first().text().replace(/\s+/g, ' ').trim();
          if (h1) title = `RvS: ${h1}`.substring(0, 290);
          text = p$('main, article, .content, body').first().text().replace(/\s+/g, ' ').substring(0, 20000);
          fetched++;
        }
        await new Promise(res => setTimeout(res, 1200));
      }
      const res = await saveRawItem(db, { sourceId, externalUrl: url, title, content: text, summary: `Raad van State, zaak ${zaaknr}` });
      if (res.saved) saved++; else { skipped++; }
    } catch (e) { errors++; }
  }
  await logResult(db, sourceId, 'Raad van State — Amersfoort', saved, skipped, errors);
}

scrape().catch(e => { console.error('rvs-uitspraken:', e.message); process.exit(1); });
