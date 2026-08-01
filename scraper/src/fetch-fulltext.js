// fetch-fulltext.js — haalt de volledige documenttekst op voor tier 1-documenten
//
// Waarom (24-07-2026): de meeste tier 1-bronnen sloegen alleen een titel en een URL op.
// Namen van aanvragers, bezwaarmakers, bestuurders en gemachtigden staan in het DOCUMENT,
// niet in de titel. Zonder documenttekst valt er niets te matchen tegen de personendatabase.
//
// Draait ná de scrapers. Idempotent: slaat items over die al full_text hebben en
// items waarvoor het eerder is geprobeerd (fulltext_fetched_at gezet, full_text leeg).
//
// Gebruik:
//   node src/fetch-fulltext.js              # standaard: max 150 items per run
//   MAX_ITEMS=500 node src/fetch-fulltext.js

import * as cheerio from 'cheerio';
import { createDb } from './lib.js';

const db = createDb();
const UA = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 150);
const DELAY_MS = Number(process.env.FETCH_DELAY_MS || 800);
const MIN_TEXT = 200;

// Alleen bronnen waar een document achter de URL zit dat namen kan bevatten.
// Nieuwsbronnen staan er bewust NIET tussen: die leveren geen besluiten op en
// hun paginateksten voegen alleen ruis toe aan de entiteitsextractie.
const SOURCE_PATTERNS = [
  '%Bekendmakingen%',
  '%Rechtspraak%',
  '%rechtspraak%',
  '%TenderNed%',
  '%Raad Amersfoort%',
  '%raadsinformatie%',
  '%B&W%',
  '%iBabs%',
  '%Rekenkamer%',
  '%Subsidieregister%',
  '%ODU%',
  '%Omgevingsdienst%',
];

function cleanText(html) {
  const $ = cheerio.load(html);
  $('nav, footer, aside, script, style, noscript, .skiplinks, .menu, .breadcrumb, .cookie, header').remove();
  let txt = ($('article, .stuk, main, .content, .uitspraak, #content').first().text() || $('body').text())
    .replace(/\s+/g, ' ')
    .trim();
  const cut = txt.indexOf('Lichaam');
  if (cut > -1 && cut < 1200) txt = txt.slice(cut + 'Lichaam'.length).trim();
  txt = txt.split(/Deze site is een initiatief van|Naar boven$/)[0].trim();
  return txt;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('pdf')) return { text: null, reason: 'pdf' };
  const body = await r.text();
  if (body.trim().startsWith('%PDF')) return { text: null, reason: 'pdf' };
  const txt = cleanText(body);
  if (txt.length < MIN_TEXT) return { text: null, reason: `te kort (${txt.length})` };
  return { text: txt, reason: null };
}

async function run() {
  console.log(`\n[FULLTEXT] gestart ${new Date().toISOString()} — max ${MAX_ITEMS} items`);

  const like = SOURCE_PATTERNS.map(() => 's.name LIKE ?').join(' OR ');
  const res = await db.execute({
    sql: `SELECT r.id, r.title, r.external_url, s.name AS source_name
          FROM raw_items r JOIN sources s ON s.id = r.source_id
          WHERE r.full_text IS NULL
            AND r.fulltext_fetched_at IS NULL
            AND r.external_url IS NOT NULL AND r.external_url != ''
            AND (${like})
          ORDER BY r.id DESC
          LIMIT ?`,
    args: [...SOURCE_PATTERNS, MAX_ITEMS],
  });

  console.log(`[FULLTEXT] ${res.rows.length} kandidaten`);
  const stats = { ok: 0, leeg: 0, fout: 0, tekens: 0 };

  for (const row of res.rows) {
    try {
      const { text, reason } = await fetchText(row.external_url);
      if (text) {
        await db.execute({
          sql: `UPDATE raw_items SET full_text = ?, fulltext_fetched_at = ? WHERE id = ?`,
          args: [text.substring(0, 200000), new Date().toISOString(), row.id],
        });
        stats.ok++;
        stats.tekens += text.length;
      } else {
        // Markeer als geprobeerd zodat we het niet elke run opnieuw doen
        await db.execute({
          sql: `UPDATE raw_items SET fulltext_fetched_at = ? WHERE id = ?`,
          args: [new Date().toISOString(), row.id],
        });
        stats.leeg++;
        console.log(`[FULLTEXT] leeg (${reason}): ${row.source_name} — ${String(row.title).substring(0, 60)}`);
      }
    } catch (e) {
      await db.execute({
        sql: `UPDATE raw_items SET fulltext_fetched_at = ? WHERE id = ?`,
        args: [new Date().toISOString(), row.id],
      });
      stats.fout++;
      console.log(`[FULLTEXT] fout: ${String(row.title).substring(0, 50)} — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const gem = stats.ok ? Math.round(stats.tekens / stats.ok) : 0;
  console.log(`[FULLTEXT] klaar: ${stats.ok} opgehaald (gem. ${gem} tekens), ${stats.leeg} leeg, ${stats.fout} fout`);
}

run().catch(e => { console.error('[FULLTEXT] fataal:', e); process.exit(1); });
