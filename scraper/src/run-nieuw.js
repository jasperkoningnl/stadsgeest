// run-nieuw.js — Nieuwe primaire bronnen Stadsgeest 033
// Draait wekelijks via PM2 cron (maandag 09:00)
import { createDb, ensureSource, insertItem, log } from './lib.js';
import { recordScrapeRun } from './runner-log.js';
import * as cheerio from 'cheerio';
import RSSParser from 'rss-parser';

const JOB_NAME = 'run-nieuw';
process.env.SCRAPE_JOB_NAME = process.env.SCRAPE_JOB_NAME || JOB_NAME;

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
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, sourceDef);
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
  await log(db, sid, sourceDef.name, stats);
  return stats;
}

// ============================================================
// 1. Rekenkamer Amersfoort — PDF-publicaties
// ============================================================
async function scrapeRekenkamer() {
  const name = 'Rekenkamer Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
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
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 3. OpenKvK — UITGESCHAKELD (vereist API-key)
// ============================================================
async function scrapeOpenKvK() {
  const name = 'OpenKvK — nieuwe inschrijvingen Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  // 9 augustus 2026: bewust niet onderzocht. Dit is de enige van de vier
  // return-bronnen die geld kost; Jasper overlegt daarover met Gideon. De regel
  // hieronder dat de key gratis is, is achterhaald — api.overheid.io vraagt voor
  // KvK-data een betaald account. Niets aan doen tot dat besluit er is.
  //
  // overheid.io OpenKvK API vereist een API-key. Registreer op overheid.io.
  // Voeg toe aan scraper/.env: OVERHEID_IO_KEY=<jouw-key>
  // Daarna: GET https://api.overheid.io/openkvk?filters[]=gemeente:Amersfoort&ovio-api-key=<key>
  const sid = await ensureSource(db, {
    name, url: 'https://api.overheid.io/openkvk',
    source_type: 'api', reliability: 'primary', category: 'registry',
    scrape_frequency: 'daily', tier: 1,
  }).catch(() => undefined);
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 4. Gemeenschappelijke Regelingen — Officiële Bekendmakingen
// ============================================================
async function scrapeGemeenschappelijkeRegelingen() {
  const name = 'Gemeenschappelijke Regelingen Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
      name, url: 'https://zoek.officielebekendmakingen.nl/',
      source_type: 'scrape', reliability: 'primary', category: 'government',
      scrape_frequency: 'weekly', tier: 1,
    });
    // Herschreven op 8 augustus 2026. Wat hier stond zocht op
    // zoek.officielebekendmakingen.nl/sru/Search met de vrije tekst
    // "Amersfoort gemeenschappelijke regeling". Drie dingen klopten daar niet:
    //
    //   1. Dat endpoint geeft HTTP 500 op elke query, ook op operation=explain.
    //      Het werkende adres is repository.overheid.nl/sru.
    //   2. `fast-xml-parser` stond niet in scraper/node_modules, dus de import
    //      wierp elke run een fout. Nu geïnstalleerd.
    //   3. De XML-paden klopten niet: het enige item dat de bron ooit opleverde
    //      heeft een stuk onverwerkte JSON als titel — `{"gzd":{"originalData"...`.
    //
    // De bredere denkfout zat in het zoeken zelf. Een blad gemeenschappelijke
    // regeling wordt uitgegeven door de regeling, niet door de gemeente, dus
    // `dt.creator=="Amersfoort"` geeft nul. Zoeken op de vrije tekst "Amersfoort"
    // geeft juist regelingen uit Amsterdam en landelijke besluiten. Daarom nu een
    // vaste lijst opstellers: de gemeenschappelijke regelingen waar Amersfoort
    // daadwerkelijk in deelneemt. Getest 8 augustus 2026: Veiligheidsregio Utrecht
    // 159 publicaties, Omgevingsdienst regio Utrecht 21, Afvalverwijdering Utrecht 2.
    // De lijst is met opzet kort en uitbreidbaar; een regeling erbij is één regel.
    const { XMLParser } = await import('fast-xml-parser');
    const SRU = 'https://repository.overheid.nl/sru';
    const REGELINGEN = [
      'Veiligheidsregio Utrecht',
      'Omgevingsdienst regio Utrecht',
      'Afvalverwijdering Utrecht',
    ];
    // Alleen de laatste dertig dagen. Zonder venster is de eerste run een backfill
    // van bijna tweehonderd items en dat is precies het soort uitschieter waar
    // START-HIER.md voor waarschuwt.
    const sinds = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });

    let gezien = 0;
    for (const regeling of REGELINGEN) {
      const query = `c.product-area==officielepublicaties AND w.publicatienaam=="Blad gemeenschappelijke regeling"`
        + ` AND dt.creator=="${regeling}" AND dt.modified>="${sinds}"`;
      const url = `${SRU}?operation=searchRetrieve&version=2.0&maximumRecords=50&query=${encodeURIComponent(query)}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { stats.errors++; continue; }
      const obj = parser.parse(await r.text());

      const antwoord = obj['sru:searchRetrieveResponse'] ?? obj.searchRetrieveResponse ?? {};
      const records = antwoord['sru:records']?.['sru:record'] ?? antwoord.records?.record ?? [];
      const arr = Array.isArray(records) ? records : [records].filter(Boolean);

      // Het pad is nagelopen op een echt antwoord, niet gegokt: recordData ->
      // gzd:gzd -> gzd:originalData -> overheidwetgeving:meta -> owmskern. De oude
      // code zocht in `overheidop:meta`, dat bestaat hier niet. Velden met een
      // scheme-attribuut komen uit fast-xml-parser als object met #text.
      const tekst = (v) => (v && typeof v === 'object' ? v['#text'] : v) ?? '';

      for (const rec of arr) {
        const data = rec?.['sru:recordData'] ?? rec?.recordData ?? {};
        const gzd = data?.['gzd:gzd'] ?? {};
        const kern = gzd?.['gzd:originalData']?.['overheidwetgeving:meta']?.['overheidwetgeving:owmskern'] ?? {};
        const titel = tekst(kern['dcterms:title']);
        const identifier = tekst(kern['dcterms:identifier']);
        const gewijzigd = tekst(kern['dcterms:modified']);
        const rubriek = tekst(kern['dcterms:type']);
        if (typeof titel !== 'string' || titel.length < 6) continue;

        gezien++;
        const itemUrl = gzd?.['gzd:enrichedData']?.['gzd:preferredUrl']
          || (identifier ? `https://zoek.officielebekendmakingen.nl/${identifier}.html` : 'https://zoek.officielebekendmakingen.nl/');
        const result = await insertItem(db, {
          source_id: sid,
          title: titel.substring(0, 300),
          content: `Gemeenschappelijke regeling: ${regeling}.`
            + `${rubriek ? ` Rubriek: ${rubriek}.` : ''}`
            + ` Gepubliceerd in het Blad gemeenschappelijke regeling`
            + `${gewijzigd ? `, laatst gewijzigd ${gewijzigd}` : ''}.`
            + ` Amersfoort neemt aan deze regeling deel.`,
          summary: [regeling, rubriek, gewijzigd].filter(Boolean).join(' | '),
          external_url: itemUrl,
          scraped_at: new Date().toISOString(),
        });
        if (result === true) stats.new++; else if (result === false) stats.skipped++; else stats.errors++;
      }
      await new Promise(r => setTimeout(r, 800));
    }
    if (gezien === 0) stats.skipped++;
  } catch (e) {
    stats.errors++;
    console.error(`  [${name}] ${e.message.substring(0, 120)}`);
  }
  await log(db, sid, name, stats);
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
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 7. Huurcommissie — UITGESCHAKELD (Next.js, JS-rendered)
// ============================================================
async function scrapeHuurcommissie() {
  const name = 'Huurcommissie uitspraken — Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  // UITGEZOCHT 9 augustus 2026 — waar deze bron op wacht, en wat hij waard is.
  //
  // www.huurcommissie.nl/uitspraken bestaat niet meer (404). Het register zit op
  // https://portaal.huurcommissie.nl/p/uitspraken en dat is geen Next.js maar een
  // MENDIX-applicatie: alle data loopt over één sessiegebonden RPC-endpoint
  // (/xas/), met paginadefinities in .page.xml. Er is dus geen API die je met een
  // GET kunt bevragen; een scraper moet de zoekpagina echt bedienen.
  //
  // Wél getest, en het is de moeite waard. Zoeken op 'Amersfoort' in het openbare
  // register geeft 422 van de 43.627 uitspraken, met adres, onderwerp, datum
  // afdoening en datum publicatie. Voorbeelden van 9 augustus 2026: Van
  // Rootselaarstraat 30, huurverlaging op grond van punten, gepubliceerd 26-07;
  // Palmstraat 328-A, toetsing aanvangshuurprijs, gepubliceerd 15-07. Dat is
  // materiaal met een adres erin, dus bruikbaar voor entiteitsmatching.
  //
  // Kosten om het te laten werken: een Playwright-scraper in run-browser.js die het
  // zoekveld invult, sorteert op datum publicatie aflopend en de eerste pagina's
  // uitleest. Selecteer op placeholder en zichtbare tekst, niet op de Mendix-id's
  // (p.OpenbaarRegister.SNP_...): die veranderen per deploy. Let op de
  // waarschuwing van de Huurcommissie zelf: uitspraken met persoonsgegevens worden
  // niet gepubliceerd, dus het register is niet volledig en niet geschikt voor
  // trendanalyse. Als losse zaak is het wel bruikbaar.
  const sid = await ensureSource(db, {
    name, url: 'https://www.huurcommissie.nl/uitspraken',
    source_type: 'browser', reliability: 'primary', category: 'registry',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => undefined);
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 8. ACM besluiten — recente publicaties
// ============================================================
async function scrapeACM() {
  const name = 'ACM besluiten — Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
    // Fix 2026-08-02: filter werd nooit toegepast — helft van de items was landelijke ruis.
    // Nu: publicatiepagina ophalen en alleen opslaan bij aantoonbare regionale relevantie
    // (plaatsnaam of bekende lokale organisatie zoals Ennatuurlijk/Eemwarmte bij het warmtenet).
    const relevantie = /amersfoort|eemland|hoogland|vathorst|soesterkwartier|ennatuurlijk|eemwarmte|inwarmte|warmtebedrijf amersfoort/i;
    for (const [href, text] of Array.from(pubLinks).slice(0, 30)) {
      const url = href.startsWith('http') ? href : 'https://www.acm.nl' + href;
      let pageText = '';
      try {
        const pubHtml = await fetchHtml(url);
        pageText = cheerio.load(pubHtml)('main, article, body').first().text().replace(/\s+/g, ' ').substring(0, 8000);
      } catch { /* pagina niet leesbaar: beoordeel op titel */ }
      if (!relevantie.test(text) && !relevantie.test(pageText)) { stats.skipped++; continue; }
      const r = await insertItem(db, {
        source_id: sid,
        title: text.substring(0, 300),
        content: (pageText || 'ACM publicatie — regionale relevantie op titel vastgesteld.').substring(0, 8000),
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
  await log(db, sid, name, stats);
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
  // UITGEZOCHT 9 augustus 2026 — waar deze bron precies op wacht.
  //
  // Op https://www.ep-online.nl/PublicData staat alles klaar achter één drempel:
  // een API-key. Die is GRATIS en wordt via een formulier bij RVO aangevraagd. De
  // pagina zegt: één keer aanvragen, na vijf minuten bruikbaar, een ongebruikte key
  // vervalt na een jaar. Geen betaling, geen contract — alleen een aanvraag door
  // Jasper. Dit is dus een andere situatie dan OpenKvK, dat wél geld kost.
  //
  // Wat er na die key klaarstaat (stand 9 augustus 2026):
  //   - maandelijks totaalbestand v20260801_v4_csv.zip, 228 MB gezipt
  //   - dagelijkse mutatiebestanden d20260808_v4.zip, 20 tot 235 kB per dag
  // De dagbestanden zijn wat we nodig hebben: klein genoeg om dagelijks op te halen
  // en te filteren op de Amersfoortse postcodes (3811-3829, Leusden 3831-3833).
  // Het totaalbestand alleen voor een eenmalige nulmeting.
  //
  // Kosten om het te laten werken: één keer een key aanvragen, daarna een scraper
  // van de omvang van subsidieregister-records.js — zip halen, uitpakken, CSV lezen,
  // op postcode filteren. Geen browser nodig. Key hoort in scraper/.env als
  // EP_ONLINE_KEY, niet in de repo.
  const name = 'EP-online Energielabels Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  const sid = await ensureSource(db, {
    name, url: 'https://www.ep-online.nl/',
    source_type: 'api', reliability: 'primary', category: 'data',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => undefined);
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 11. Kadaster/BRK via PDOK — eigendomstransacties
// ============================================================
async function scrapeKadaster() {
  const name = 'Kadaster BRK — rechtspersonen Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 12. Monumentenregister — rijksmonumenten
// ============================================================
async function scrapeMonumentenregister() {
  const name = 'Monumentenregister Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 13. Buurtbudgetten — RSS + HTML
// ============================================================
async function scrapeBuurtbudgetten() {
  const name = 'Buurtbudgetten en wijkplatforms Amersfoort';
  const stats = { new: 0, skipped: 0, errors: 0 };
  // sid buiten de try, anders is hij onbekend bij de log-aanroep na de catch
  let sid = null;
  try {
    sid = await ensureSource(db, {
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
  await log(db, sid, name, stats);
  return stats;
}

// ============================================================
// 14. Europese subsidies — cohesiondata
// ============================================================
async function scrapeEUSubsidies() {
  // UITGEZOCHT 9 augustus 2026 — en de diagnose die hier stond klopte niet.
  //
  // Er stond dat dataset-ID 3kkx-ekfq een 400 geeft en dat er een actueel ID
  // gezocht moest worden. Het ID werkt gewoon; de 400 kwam uit de query zelf.
  // Hieronder staat `$where=ms_name='Netherlands'`, maar die kolom heet `ms`.
  // Socrata geeft op een onbekende kolom een 400, en dat is als een verlopen
  // dataset gelezen. 3kkx-ekfq is trouwens een programmabestand, geen
  // begunstigdenbestand, dus ook met de juiste kolomnaam is het niet wat we willen.
  //
  // Wat we wél willen staat in 557j-pmg8, '2014-2020 Kohesio projects'. Gemeten
  // 9 augustus 2026:
  //   - 14.562 projecten met country='Netherlands'
  //   - 439 daarvan op een Amersfoortse postcode:
  //     $where=country='Netherlands' AND starts_with(postal_code,'38')
  //   - met beneficiary_name, postal_code, total_eligible_expenditure_amount,
  //     project_eu_budget, fund_name, category_label en programme_name
  // Voorbeelden: Heilijgers Projectontwikkeling BV (3800AH), Stichting Philadelphia
  // Zorg (3800BG, € 19.600), Beweging 3.0 (3821AB, € 20.000).
  //
  // Twee kanttekeningen. Postcode 38 omvat naast Amersfoort (3800-3829) ook
  // Leusden (383x), wat voor deze redactie prima is maar wel bewust moet.
  // En dit is de periode 2014-2020: historisch materiaal, goed voor
  // entiteitsmatching en context, geen nieuwsstroom. Voor 2021-2027 staat er op
  // cohesiondata geen Kohesio-bestand; dat zit op kohesio.ec.europa.eu en is niet
  // onderzocht.
  //
  // Kosten om het te laten werken: klein, de query hierboven werkt. Maar het is
  // eenmalig 439 items, en dat is een backfill. Daarom niet zelf aangezet — dat is
  // een besluit van Jasper, samen met de vraag of een bestand van 2014-2020 in de
  // dagelijkse intake thuishoort of beter als losse tabel wordt weggezet, zoals
  // het subsidieregister.
  const name = 'Europese subsidies — Amersfoort';
  const stats = { new: 0, skipped: 1, errors: 0 };
  const sid = await ensureSource(db, {
    name, url: 'https://cohesiondata.ec.europa.eu/',
    source_type: 'api', reliability: 'primary', category: 'registry',
    scrape_frequency: 'weekly', tier: 1,
  }).catch(() => undefined);
  await log(db, sid, name, stats);
  return stats;
  // Uitgeschakeld totdat juiste dataset-ID is vastgesteld
  const dummy = { new: 0, skipped: 0, errors: 0 };
  // Hieronder staat onbereikbare code: de functie keert hierboven al terug zolang
  // het dataset-ID van cohesiondata niet vaststaat. Bewaard als vertrekpunt.
  let sidDood = null;
  try {
    sidDood = await ensureSource(db, {
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
  await log(db, sid, name, stats);
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
    const startedAt = new Date();
    try {
      const stats = await scraper();
      totalNew += stats?.new ?? 0;
      totalSkipped += stats?.skipped ?? 0;
      totalErrors += stats?.errors ?? 0;
    } catch (e) {
      // Vangnet: dit vuurt alleen als een scraper-functie crasht vóórdat hij zelf
      // via log() naar scrape_runs kon schrijven (elke functie hierboven doet dat
      // normaal al zelf in zijn eigen try/catch).
      console.error('Scraper fout:', e.message);
      totalErrors++;
      try {
        await recordScrapeRun(db, {
          jobName: JOB_NAME,
          scraperFile: null,
          sourceName: scraper.name,
          startedAt,
          finishedAt: new Date(),
          status: 'error',
          errorMessage: e.message,
        });
      } catch (logErr) {
        console.error('Kon scrape_runs niet bijwerken:', logErr.message);
      }
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n=== Nieuw-bronnen scrape-run voltooid: ${new Date().toISOString()} ===`);
  console.log(`Totaal: ${totalNew} nieuw, ${totalSkipped} overgeslagen, ${totalErrors} fouten`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
