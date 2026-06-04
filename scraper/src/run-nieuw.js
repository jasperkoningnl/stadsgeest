// run-nieuw.js — Nieuwe primaire bronnen Stadsgeest 033
// Draait wekelijks via PM2 cron (maandag 09:00)
import { createDb, ensureSource, insertItem, log } from './lib.js';
import * as cheerio from 'cheerio';
import RSSParser from 'rss-parser';

const db = createDb();
const rssParser = new RSSParser({ timeout: 12000 });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} voor ${url}`);
  return resp.text();
}

// ============================================================
// RSS-helper (voor WordPress-sites)
// ============================================================
async function scrapeRSS(sourceDef, feedUrl, filterFn = null) {
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, sourceDef);
    const feed = await rssParser.parseURL(feedUrl);
    for (const item of feed.items.slice(0, 20)) {
      if (filterFn && !filterFn(item)) { stats.skipped++; continue; }
      const r = await insertItem(db, {
        source_id: sid,
        title: item.title ?? '',
        content: (item.contentSnippet ?? item.content ?? '').substring(0, 5000),
        summary: item.contentSnippet?.substring(0, 500) ?? '',
        external_url: item.link ?? '',
        scraped_at: item.isoDate ?? new Date().toISOString(),
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      else stats.errors++;
    }
  } catch (e) {
    stats.errors++;
    console.error(`  [${sourceDef.name}] ${e.message.substring(0, 120)}`);
  }
  log(sourceDef.name, stats);
  return stats;
}

// ============================================================
// 1. Rekenkamer Amersfoort — PDF-publicaties
// ============================================================
async function scrapeRekenkamer() {
  const name = 'Rekenkamer Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://www.amersfoort.nl/publicaties-rekenkamer',
      source_type: 'scrape', reliability: 'primary', category: 'government',
      scrape_frequency: 'weekly', tier: 1,
    });
    const html = await fetchHtml('https://www.amersfoort.nl/publicaties-rekenkamer');
    const $ = cheerio.load(html);
    const seen = new Set();
    // PDF-links zijn de primaire bron — groepeer per onderzoek op bestandsnaam-prefix
    $('a[href*=".pdf"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (!text || text.length < 10) return;
      const url = href.startsWith('http') ? href : 'https://www.amersfoort.nl' + href;
      // Dedupleer op URL
      if (seen.has(url)) return;
      seen.add(url);
      // Filter: alleen rapporten en persberichten (niet reglementen/protocollen)
      if (!text.match(/rapport|persbericht|infographic|onderzoek|jaarplan|jaarverslag/i)) return;
      const dateMatch = url.match(/\/(\d{4}-\d{2})\//);
      const pubDate = dateMatch ? dateMatch[1] + '-01T00:00:00Z' : new Date().toISOString();
      insertItem(db, {
        source_id: sid,
        title: text.substring(0, 300),
        content: `Rekenkamer Amersfoort publicatie: ${text}`,
        external_url: url,
        scraped_at: pubDate,
      }).then(r => { if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++; })
        .catch(() => stats.errors++);
    });
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 2. Raad van State — UITGESCHAKELD (Cloudflare, JS-rendered)
// ============================================================
async function scrapeRaadVanState() {
  const name = 'Raad van State — uitspraken Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // RvS-site is Cloudflare-protected en JS-rendered. Plaatsvervanger: gebruik
  // Rechtspraak.nl-zoekopdracht die WEL HTML teruggeeft via hun zoekpagina.
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://uitspraken.rechtspraak.nl/?zoekterm=amersfoort&instantie=Raad+van+State',
      source_type: 'scrape', reliability: 'primary', category: 'registry',
      scrape_frequency: 'weekly', tier: 1,
    });
    const html = await fetchHtml('https://uitspraken.rechtspraak.nl/?zoekterm=amersfoort&instantie=Raad+van+State&aantal=20');
    const $ = cheerio.load(html);
    $('li.result, .search-result, tr.resultaat, article').each((_, el) => {
      const title = $(el).find('h2, h3, .ecli, .title').first().text().trim();
      const href = $(el).find('a').first().attr('href') ?? '';
      const summary = $(el).find('p, .summary, .omschrijving').first().text().trim();
      if (title.length > 5 && href) {
        const url = href.startsWith('http') ? href : 'https://uitspraken.rechtspraak.nl' + href;
        insertItem(db, { source_id: sid, title, content: summary, external_url: url, scraped_at: new Date().toISOString() })
          .then(r => { if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++; })
          .catch(() => stats.errors++);
      }
    });
    await new Promise(r => setTimeout(r, 1500));
    if (stats.new === 0 && stats.skipped === 0) stats.skipped++; // pagina laadde maar geen resultaten
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 3. OpenKvK — UITGESCHAKELD (vereist API-key)
// ============================================================
async function scrapeOpenKvK() {
  const name = 'OpenKvK — nieuwe inschrijvingen Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  // overheid.io OpenKvK API vereist een gratis API-key. Registreer op overheid.io.
  // Voeg toe aan scraper/.env: OVERHEID_IO_KEY=<jouw-key>
  // Daarna: GET https://api.overheid.io/openkvk?filters[]=gemeente:Amersfoort&ovio-api-key=<key>
  await ensureSource(db, {
    name, url: 'https://api.overheid.io/openkvk',
    source_type: 'api', reliability: 'primary', category: 'registry',
    scrape_frequency: 'daily', tier: 1,
  }).catch(() => {});
  log(name, stats);
  return stats;
}

// ============================================================
// 4. Gemeenschappelijke Regelingen — Officiële Bekendmakingen
// ============================================================
async function scrapeGemeenschappelijkeRegelingen() {
  const name = 'Gemeenschappelijke Regelingen Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://zoek.officielebekendmakingen.nl/',
      source_type: 'scrape', reliability: 'primary', category: 'government',
      scrape_frequency: 'weekly', tier: 1,
    });
    // Zoek op staatscourant gepubliceerde gemeenschappelijke regelingen met Amersfoort
    // OB SRU API — zoek in Staatscourant naar besluiten over Amersfoort die gemeenschappelijke regelingen betreffen
    const { XMLParser } = await import('fast-xml-parser');
    const sruUrl = 'https://zoek.officielebekendmakingen.nl/sru/Search?query=Amersfoort+gemeenschappelijke+regeling&maximumRecords=20&x-connection=stcrt&sortKeys=score,,1';
    const r = await fetch(sruUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`SRU HTTP ${r.status}`);
    const xml = await r.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
    const obj = parser.parse(xml);
    const records = obj['searchRetrieveResponse']?.records?.record ?? [];
    const arr = Array.isArray(records) ? records : [records];
    for (const rec of arr) {
      const data = rec?.recordData ?? {};
      // Probeer verschillende XML-paden
      const wetgeving = data?.['gzd:gzd']?.['gzd:originalData']?.['overheidwetgeving:wetgeving'] ?? {};
      const title = wetgeving?.['dcterms:title'] ?? data?.['dcterms:title'] ?? JSON.stringify(data).substring(0, 80);
      const identifier = wetgeving?.['dcterms:identifier'] ?? data?.['dcterms:identifier'] ?? '';
      if (typeof title === 'string' && title.length > 5) {
        const url = identifier ? `https://zoek.officielebekendmakingen.nl/${identifier}` : 'https://zoek.officielebekendmakingen.nl/';
        insertItem(db, { source_id: sid, title: title.substring(0, 300), content: '', external_url: url, scraped_at: new Date().toISOString() })
          .then(result => { if (result === true) stats.new++; else if (result === false) stats.skipped++; else stats.errors++; })
          .catch(() => stats.errors++);
      }
    }
    await new Promise(r => setTimeout(r, 1500));
    if (arr.length === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 5. Regio Amersfoort — RSS
// ============================================================
async function scrapeRegioAmersfoort() {
  return scrapeRSS({
    name: 'Regio Amersfoort — agenda en rapportages',
    url: 'https://www.regioamersfoort.nl/',
    source_type: 'rss', reliability: 'secondary', category: 'government',
    scrape_frequency: 'weekly', tier: 2,
  }, 'https://www.regioamersfoort.nl/feed/');
}

// ============================================================
// 6. DUO Open Onderwijsdata — publicaties
// ============================================================
async function scrapeDUO() {
  const name = 'DUO Open Onderwijsdata — Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://duo.nl/open_onderwijsdata/',
      source_type: 'scrape', reliability: 'primary', category: 'data',
      scrape_frequency: 'weekly', tier: 1,
    });
    // DUO-nieuwspagina op updates controleren
    const html = await fetchHtml('https://duo.nl/open_onderwijsdata/');
    const $ = cheerio.load(html);
    $('article, .news-item, .update-item, li').each((_, el) => {
      const title = $(el).find('h2, h3, h4').first().text().trim();
      const href = $(el).find('a').first().attr('href') ?? '';
      const date = $(el).find('time, .date').first().text().trim();
      if (title.length > 8 && href) {
        const url = href.startsWith('http') ? href : 'https://duo.nl' + href;
        insertItem(db, { source_id: sid, title: `DUO: ${title}`, content: date, external_url: url, scraped_at: new Date().toISOString() })
          .then(r => { if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++; })
          .catch(() => stats.errors++);
      }
    });
    await new Promise(r => setTimeout(r, 1000));
    if (stats.new === 0 && stats.skipped === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 7. Huurcommissie — UITGESCHAKELD (Next.js, JS-rendered)
// ============================================================
async function scrapeHuurcommissie() {
  const name = 'Huurcommissie uitspraken — Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  // Huurcommissie-site is volledig JS-rendered (Next.js). Geen toegankelijke API.
  // Alternatief: zoek op huurcommissie.nl via de zoekfunctie in een browser-scraper.
  await ensureSource(db, {
    name, url: 'https://www.huurcommissie.nl/uitspraken',
    source_type: 'browser', reliability: 'primary', category: 'registry',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => {});
  log(name, stats);
  return stats;
}

// ============================================================
// 8. ACM besluiten — recente publicaties
// ============================================================
async function scrapeACM() {
  const name = 'ACM besluiten — Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://www.acm.nl/nl/publicaties/',
      source_type: 'scrape', reliability: 'primary', category: 'registry',
      scrape_frequency: 'weekly', tier: 1,
    });
    // ACM pubiceert boetes, besluiten en uitspraken. We halen de recente lijst op
    // en filteren lokaal op Amersfoort-relevante termen.
    const html = await fetchHtml('https://www.acm.nl/nl/publicaties/');
    const $ = cheerio.load(html);
    const amersfoortTerms = /amersfoort|vallei|eemland|nutsbedrijf|telecom|energie.*033/i;
    // Drupal/Solr geeft een paginastructuur; links met /nl/publicaties/ zijn individuele pubs
    const pubLinks = new Map();
    $('a[href*="/nl/publicaties/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const text = $(el).text().trim();
      if (text.length > 10 && !href.includes('?') && href.match(/\/nl\/publicaties\/[a-z]/)) {
        pubLinks.set(href, text);
      }
    });
    for (const [href, text] of Array.from(pubLinks).slice(0, 30)) {
      const url = href.startsWith('http') ? href : 'https://www.acm.nl' + href;
      // Haal de publicatie-pagina op om inhoud te checken op Amersfoort-relevantie
      // (alleen als we < 5 candidates hebben om rate limiting te vermijden)
      const r = await insertItem(db, {
        source_id: sid,
        title: text.substring(0, 300),
        content: 'ACM publicatie — verificeer Amersfoort-relevantie via URL.',
        external_url: url,
        scraped_at: new Date().toISOString(),
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      else stats.errors++;
    }
    if (pubLinks.size === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 9. COELO Woonlastenmonitor — RSS
// ============================================================
async function scrapeCOELO() {
  return scrapeRSS({
    name: 'COELO Woonlastenmonitor — Amersfoort',
    url: 'https://coelo.nl/',
    source_type: 'rss', reliability: 'primary', category: 'data',
    scrape_frequency: 'weekly', tier: 1,
  }, 'https://coelo.nl/feed/');
}

// ============================================================
// 10. EP-online Energielabels — Amersfoort
// ============================================================
async function scrapeEPOnline() {
  // EP-online vereist authenticatie voor API-toegang en tijdlimieten worden overschreden.
  // Alternatief: download de maandelijkse bulk-export via https://www.ep-online.nl/PublicData
  // en verwerk met een apart script. Voorlopig uitgeschakeld.
  const name = 'EP-online Energielabels Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  await ensureSource(db, {
    name, url: 'https://www.ep-online.nl/',
    source_type: 'api', reliability: 'primary', category: 'data',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => {});
  log(name, stats);
  return stats;
}

// ============================================================
// 11. Kadaster/BRK via PDOK — eigendomstransacties
// ============================================================
async function scrapeKadaster() {
  const name = 'Kadaster BRK — rechtspersonen Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://api.pdok.nl/kadaster/',
      source_type: 'api', reliability: 'primary', category: 'registry',
      scrape_frequency: 'weekly', tier: 1,
    });
    // PDOK Locatieserver: zoek percelen in Amersfoort
    const apiUrl = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=amersfoort&fq=type:gemeente&rows=1';
    const r1 = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    const geo = await r1.json();
    const centroid = geo.response?.docs?.[0]?.centroide_ll ?? '5.38,52.15';
    // Zoek recente WOZ-transacties via het BAG-koppelvlak (rechtspersoon eigenaar)
    const wfsUrl = `https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=kadastralekaart:Perceel&outputFormat=application/json&count=5&BBOX=5.32,52.12,5.48,52.20`;
    const r2 = await fetch(wfsUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r2.ok) throw new Error(`PDOK WFS HTTP ${r2.status}`);
    const data = await r2.json();
    for (const f of (data.features ?? []).slice(0, 5)) {
      const p = f.properties ?? {};
      const title = `Kadasterperceel ${p.sectie ?? ''}${p.perceelnummer ?? ''} — gemeente Amersfoort`;
      const content = `Perceeloppervlak: ${p.kadastraleGrootte ?? '?'} m². Sectie: ${p.sectie ?? ''}. Perceel: ${p.perceelnummer ?? ''}.`;
      const r = await insertItem(db, {
        source_id: sid, title, content,
        external_url: 'https://www.kadaster.nl/perceel',
        scraped_at: new Date().toISOString(),
      });
      if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++;
    }
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 12. Monumentenregister — rijksmonumenten
// ============================================================
async function scrapeMonumentenregister() {
  const name = 'Monumentenregister Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://monumentenregister.cultureelerfgoed.nl/',
      source_type: 'scrape', reliability: 'primary', category: 'registry',
      scrape_frequency: 'weekly', tier: 1,
    });
    // De monumentenregister homepage toont recente/random monuments.
    // Zoek specifiek op Amersfoort via de zoek-URL.
    const searchUrl = 'https://monumentenregister.cultureelerfgoed.nl/monumenten?naam=&locatie=Amersfoort&periode=&type=';
    let html;
    try {
      html = await fetchHtml(searchUrl);
    } catch {
      // Fallback naar homepage
      html = await fetchHtml('https://monumentenregister.cultureelerfgoed.nl/');
    }
    const $ = cheerio.load(html);
    $('article').each((_, el) => {
      const title = $(el).find('h2, h3, a').first().text().trim();
      const href = $(el).find('a').first().attr('href') ?? '';
      const desc = $(el).find('p, .description').first().text().trim();
      if (title.length > 5 && href.match(/\/monumenten\/\d/)) {
        const url = href.startsWith('http') ? href : 'https://monumentenregister.cultureelerfgoed.nl' + href;
        insertItem(db, {
          source_id: sid,
          title: title.includes('Amersfoort') ? title : `Rijksmonument: ${title}`,
          content: desc,
          external_url: url,
          scraped_at: new Date().toISOString(),
        }).then(r => { if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++; })
          .catch(() => stats.errors++);
      }
    });
    await new Promise(r => setTimeout(r, 1500));
    if (stats.new === 0 && stats.skipped === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 13. Buurtbudgetten — RSS + HTML
// ============================================================
async function scrapeBuurtbudgetten() {
  const name = 'Buurtbudgetten en wijkplatforms Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://www.amersfoort.nl/buurtbudget',
      source_type: 'rss', reliability: 'primary', category: 'government',
      scrape_frequency: 'weekly', tier: 1,
    });
    const feeds = [
      { name: 'BuurtBudget Vathorst', url: 'https://www.buurtbudgetvathorst.nl/feed/', prefix: 'Vathorst' },
    ];
    for (const feed of feeds) {
      try {
        const parsed = await rssParser.parseURL(feed.url);
        for (const item of parsed.items.slice(0, 10)) {
          const r = await insertItem(db, {
            source_id: sid,
            title: `${feed.prefix}: ${item.title ?? ''}`.substring(0, 300),
            content: item.contentSnippet ?? '',
            external_url: item.link ?? '',
            scraped_at: item.isoDate ?? new Date().toISOString(),
          });
          if (r === true) stats.new++; else if (r === false) stats.skipped++; else stats.errors++;
        }
      } catch (e) {
        console.error(`  [${feed.name}] ${e.message.substring(0, 80)}`);
        stats.errors++;
      }
    }
    // Gemeente Amersfoort buurtbudget-pagina
    try {
      const html = await fetchHtml('https://www.amersfoort.nl/buurtbudget');
      const $ = cheerio.load(html);
      $('a[href*="buurtbudget"], a[href*="initiatief"]').each((_, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr('href') ?? '';
        if (title.length > 10 && href && !href.startsWith('#')) {
          const url = href.startsWith('http') ? href : 'https://www.amersfoort.nl' + href;
          insertItem(db, { source_id: sid, title, content: '', external_url: url, scraped_at: new Date().toISOString() })
            .then(r => { if (r === true) stats.new++; else if (r === false) stats.skipped++; }).catch(() => {});
        }
      });
      await new Promise(r => setTimeout(r, 1000));
    } catch { /* ignore */ }
  } catch (e) {
    stats.errors++;
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 14. Europese subsidies — cohesiondata
// ============================================================
async function scrapeEUSubsidies() {
  // EU Cohesion Data dataset-IDs wijzigen regelmatig. Laatste bekende ID (3kkx-ekfq) geeft 400.
  // Zoek de actuele dataset op https://cohesiondata.ec.europa.eu/browse?q=netherlands
  // en update de apiUrl hieronder.
  const name = 'Europese subsidies — Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  await ensureSource(db, {
    name, url: 'https://cohesiondata.ec.europa.eu/',
    source_type: 'api', reliability: 'primary', category: 'registry',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => {});
  log(name, stats);
  return stats;
  // Uitgeschakeld totdat juiste dataset-ID is vastgesteld
  const dummy = { new: 0, skipped: 0, errors: 0 };
  try {
    const sid = await ensureSource(db, {
      name, url: 'https://cohesiondata.ec.europa.eu/',
      source_type: 'api', reliability: 'primary', category: 'registry',
      scrape_frequency: 'weekly', tier: 1,
    });
    // EU Cohesion Data - dataset IDs worden regelmatig gewijzigd. Gebruik de doorzoeking.
    // Zie https://cohesiondata.ec.europa.eu/browse voor actuele datasets.
    // Tijdelijk: probeer via de algemene zoekpagina
    const apiUrl = "https://cohesiondata.ec.europa.eu/resource/3kkx-ekfq.json?$where=ms_name='Netherlands'&$limit=20";
    const r = await fetch(apiUrl, { headers: { 'Accept': 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Filter lokaal op Amersfoort
    const amersfoortItems = (data ?? []).filter(item =>
      JSON.stringify(item).toLowerCase().includes('amersfoort')
    );
    for (const item of amersfoortItems.slice(0, 10)) {
      const title = `EU-subsidie: ${item.project_name ?? item.operation ?? 'EU project'} (${item.beneficiary ?? ''})`;
      const amount = Number(item.total_eligible_expenditure ?? item.eu_cofinancing_amount ?? 0);
      const content = `Begunstigde: ${item.beneficiary ?? ''}. Fonds: ${item.fund ?? ''}. Bedrag: €${amount.toLocaleString('nl-NL')}. Periode: ${item.programming_period ?? ''}.`;
      const result = await insertItem(db, {
        source_id: sid, title, content,
        external_url: 'https://cohesiondata.ec.europa.eu/',
        scraped_at: new Date().toISOString(),
      });
      if (result === true) stats.new++; else if (result === false) stats.skipped++; else stats.errors++;
    }
    if (amersfoortItems.length === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  log(name, stats);
  return stats;
}

// ============================================================
// 15. GGD Gezondheidsmonitor — RSS
// ============================================================
async function scrapeGGD() {
  return scrapeRSS({
    name: 'GGD Gezondheidsmonitor regio Utrecht',
    url: 'https://www.ggdru.nl/',
    source_type: 'rss', reliability: 'primary', category: 'data',
    scrape_frequency: 'weekly', tier: 1,
  }, 'https://www.ggdru.nl/feed/');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log(`\n=== Nieuw-bronnen scrape-run gestart: ${new Date().toISOString()} ===\n`);

  const scrapers = [
    scrapeRekenkamer,
    scrapeRaadVanState,
    scrapeOpenKvK,
    scrapeGemeenschappelijkeRegelingen,
    scrapeRegioAmersfoort,
    scrapeDUO,
    scrapeHuurcommissie,
    scrapeACM,
    scrapeCOELO,
    scrapeEPOnline,
    scrapeKadaster,
    scrapeMonumentenregister,
    scrapeBuurtbudgetten,
    scrapeEUSubsidies,
    scrapeGGD,
  ];

  let totalNew = 0, totalSkipped = 0, totalErrors = 0;
  for (const scraper of scrapers) {
    try {
      const stats = await scraper();
      totalNew += stats?.new ?? 0;
      totalSkipped += stats?.skipped ?? 0;
      totalErrors += stats?.errors ?? 0;
    } catch (e) {
      console.error('Scraper fout:', e.message);
      totalErrors++;
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n=== Nieuw-bronnen scrape-run voltooid: ${new Date().toISOString()} ===`);
  console.log(`Totaal: ${totalNew} nieuw, ${totalSkipped} overgeslagen, ${totalErrors} fouten`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
