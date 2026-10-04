// De Alliantie — nieuwsberichten (woningcorporatie actief in Amersfoort)
// HTML-scraping van de nieuwspagina.

import * as cheerio from 'cheerio';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGE_URL = 'https://www.de-alliantie.nl/over-de-alliantie/meer-weten/nieuws-inspiratie/nieuws/';
const BASE_URL = 'https://www.de-alliantie.nl';

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'De Alliantie',
    url: PAGE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'local_news',
    scrapeFrequency: 'weekly',
  });

  const response = await fetch(PAGE_URL, {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);

  let saved = 0, skipped = 0, errors = 0;

  // Bouw links samen en sla op
  const links = [];
  $('a[href*="/meer-weten/nieuws-inspiratie/nieuws/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href.endsWith('/nieuws/')) return;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const title = ($(el).attr('aria-label') || $(el).text() || $(el).closest('article,li,div').find('h2,h3').first().text()).replace(/\s+/g, ' ').trim()
      || href.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || '';
    if (title && url && !links.find(l => l.url === url)) {
      links.push({ url, title });
    }
  });

  // Ontdubbelen op URL (2026-10-04). saveRawItem ontdubbelt op titel plus URL, en
  // de linktekst op deze pagina wisselt per run; hetzelfde bericht werd daardoor
  // steeds opnieuw opgeslagen (bijna 200 keer per week) en pas door de intake
  // als URL-duplicaat weggefilterd. Eén leesbeurt op de bronindex.
  const bekend = new Set(
    (await db.execute({ sql: 'SELECT external_url FROM raw_items WHERE source_id = ?', args: [sourceId] }))
      .rows.map((r) => String(r.external_url)),
  );

  for (const { url, title } of links) {
    if (bekend.has(url)) { skipped++; continue; }
    try {
      const result = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title,
        content: '',
        summary: '',
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`Fout bij item "${title}":`, err.message);
    }
  }

  await logResult(db, sourceId, 'De Alliantie', saved, skipped, errors);
}

scrape().catch(console.error);
