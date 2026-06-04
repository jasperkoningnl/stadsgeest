// run-backfill.js — Historische backfill Stadsgeest 033
// Eenmalig uitvoeren: node run-backfill.js [bron]
//   Bronnen: rechtspraak | bekendmakingen | tenderned | subsidieregister | cbs | jaarverslagen | all
// Voorbeeld: node src/run-backfill.js all
//
// Volgorde aanbevolen: rechtspraak → bekendmakingen → tenderned → subsidieregister → cbs → jaarverslagen
// Raadsinformatie/Notubiz: zie run-backfill-browser.js (vereist Playwright)

import { createDb, ensureSource, insertItem, log } from './lib.js';

const db = createDb();
const UA = 'Stadsgeest-Backfill/1.0 (redactie@stadsgeest.nl; historische dataverzameling lokale nieuwssite Amersfoort)';

// ── Hulpfuncties ─────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': UA, ...opts.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} voor ${url}`);
  return resp.json();
}

async function fetchText(url, accept = 'text/html') {
  const resp = await fetch(url, {
    headers: { 'Accept': accept, 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} voor ${url}`);
  return resp.text();
}

// Voeg is_historical kolom toe als die nog niet bestaat
async function ensureHistoricalColumn() {
  try {
    await db.execute('ALTER TABLE raw_items ADD COLUMN is_historical INTEGER DEFAULT 0');
    console.log('[setup] Kolom is_historical toegevoegd aan raw_items');
  } catch (e) {
    if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
      console.log('[setup] Kolom is_historical bestaat al — doorgaan');
    } else {
      throw e;
    }
  }
}

// ── 1. Rechtspraak.nl ─────────────────────────────────────────────────────────
// Strategie: itereer direct over ECLI-nummers van RBMNE (Rechtbank Midden-Nederland)
// en GHARL (Gerechtshof Arnhem-Leeuwarden) — de bevoegde rechters voor Amersfoort.
// Bereik backfill:
//   RBMNE:2025 → nummers 2400 t/m ~7500 (juni–december 2025)
//   RBMNE:2026 → nummers 1 t/m ~1504 (januari–juni 2026)
//   GHARL:2025 → nummers op basis van binary search
//   GHARL:2026 → nummers op basis van binary search
// Filtert vervolgens op Amersfoort-relevantie (minstens 2 vermeldingen).

async function fetchEcli(ecli) {
  const url = `https://data.rechtspraak.nl/uitspraken/content?id=${encodeURIComponent(ecli)}`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/xml', 'User-Agent': UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    return r.text();
  } catch (e) {
    return null;
  }
}

function extractEcliData(xml, ecli) {
  if (!xml) return null;
  const modified = (xml.match(/dcterms:modified>([^<T]+)/) || [])[1];
  // dcterms:date = uitspraakdatum (datum van de uitspraak, niet portalpublicatie)
  const uitspraakDatum = (xml.match(/dcterms:date rdfs:label[^>]*>([^<T]+)/) || xml.match(/dcterms:date>([^<T]+)/) || [])[1]?.trim();
  const zittingsplaats = (xml.match(/dcterms:spatial[^>]*>([^<]+)/) || [])[1] || '';
  const title = stripHtml((xml.match(/<inhoudsindicatie[^>]*>([\s\S]{0,800}?)<\/inhoudsindicatie>/) || [])[1] || '');
  const rechtsgebied = stripHtml((xml.match(/<rechtsgebied[^>]*>([^<]*)<\/rechtsgebied>/) || [])[1] || '');
  // Volledige tekst van uitspraak (voor Amersfoort-check)
  const textBody = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return { modified, uitspraakDatum, zittingsplaats, title, rechtsgebied, textBody };
}

async function backfillRechtspraak() {
  console.log('\n[rechtspraak] Start backfill via ECLI-iteratie — RBMNE + GHARL, 12 maanden');
  const stats = { new: 0, skipped: 0, errors: 0, filtered: 0 };

  const sid = await ensureSource(db, {
    name: 'rechtspraak',
    url: 'https://data.rechtspraak.nl/uitspraken/content',
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'weekly',
    tier: 1,
  });

  // Bereiken bepaald via empirische tests (juni 2024):
  //   RBMNE:2025:2400 ≈ 2025-05-27 | RBMNE:2025:7500 ≈ 2026-02-05 (gepubliceerd)
  //   RBMNE:2026:3000 ≈ 2026-06-01 (gepubliceerd)
  //   GHARL: op basis van vergelijkbaar schatten — gebruik ruime marges
  const ranges = [
    { court: 'RBMNE', year: 2025, from: 2400, to: 7500 },  // juni 2025 – dec 2025 (~6% Amersfoort)
    { court: 'RBMNE', year: 2026, from: 1,    to: 3100 },  // jan 2026 – juni 2026
    { court: 'GHARL', year: 2025, from: 2000, to: 7000 },  // hoger beroep (ruime marge)
    { court: 'GHARL', year: 2026, from: 1,    to: 3700 },  // hoger beroep 2026
  ];

  const CONCURRENCY = 3;  // max 3 parallelle requests (respecteer rate limit ~9/sec)
  const DELAY_MS = 350;   // wacht tussen batches

  for (const range of ranges) {
    console.log(`  [rechtspraak] ${range.court}:${range.year} nrs ${range.from}–${range.to}`);
    let rangeNew = 0, rangeFiltered = 0;

    for (let i = range.from; i <= range.to; i += CONCURRENCY) {
      const batch = [];
      for (let j = 0; j < CONCURRENCY && i + j <= range.to; j++) {
        batch.push(`ECLI:NL:${range.court}:${range.year}:${i + j}`);
      }

      const results = await Promise.all(batch.map(ecli => fetchEcli(ecli)));

      for (let k = 0; k < batch.length; k++) {
        const ecli = batch[k];
        const xml = results[k];
        if (!xml) { stats.errors++; continue; }  // 404 of timeout

        const data = extractEcliData(xml, ecli);
        if (!data) { stats.errors++; continue; }

        // Datumcheck op uitspraakdatum (niet portalpublicatiedatum)
        if (data.uitspraakDatum && data.uitspraakDatum < '2025-06-01') {
          rangeFiltered++;
          continue;
        }
        if (data.uitspraakDatum && data.uitspraakDatum > '2026-06-05') {
          rangeFiltered++;
          continue;
        }

        // Amersfoort-relevantiecheck: minimaal 1 vermelding
        // (zittingsplaats=Amersfoort telt automatisch mee via textBody)
        const amersfoortCount = (data.textBody.match(/amersfoort/gi) || []).length;
        if (amersfoortCount < 1) {
          rangeFiltered++;
          continue;
        }

        // Bouw content op
        const contentLines = [
          `ECLI: ${ecli}`,
          data.zittingsplaats ? `Zittingsplaats: ${data.zittingsplaats}` : '',
          data.rechtsgebied ? `Rechtsgebied: ${data.rechtsgebied}` : '',
          `Uitspraakdatum: ${data.uitspraakDatum || data.modified || '?'}`,
          '',
          data.title || '(geen inhoudsindicatie)',
        ].filter(Boolean).join('\n');
        const content = contentLines.substring(0, 10000);

        const dateStr = data.uitspraakDatum || data.modified;
        const r = await insertItem(db, {
          source_id: sid,
          title: data.title?.substring(0, 490) || ecli,
          content,
          summary: `${ecli} | ${data.zittingsplaats || data.rechtsgebied || '?'} | ${dateStr || ''}`,
          external_url: `https://uitspraken.rechtspraak.nl/details?id=${ecli}`,
          scraped_at: dateStr ? `${dateStr}T00:00:00.000Z` : new Date().toISOString(),
          is_historical: 1,
        });
        if (r === true) { stats.new++; rangeNew++; }
        else if (r === false) stats.skipped++;
        else stats.errors++;
      }

      // Voortgangsmelding elke 100 nummers
      if ((i - range.from) % 300 === 0 && i > range.from) {
        console.log(`    Nr ${i}/${range.to} — nieuw: ${rangeNew}, gefilterd: ${rangeFiltered}`);
      }

      await sleep(DELAY_MS);
    }

    console.log(`  [rechtspraak] ${range.court}:${range.year} klaar — ${rangeNew} nieuw, ${rangeFiltered} niet-Amersfoort`);
    stats.filtered += rangeFiltered;
  }

  log('rechtspraak-backfill', stats);
  console.log(`  [rechtspraak] Gefilterd (niet Amersfoort-relevant): ${stats.filtered}`);
  return stats;
}

function stripHtml(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ── 2. Officiële Bekendmakingen ───────────────────────────────────────────────
// Correct endpoint: https://repository.overheid.nl/sru/Search (POST)
// Veld x-connection=ob, query met dt.creator + col + datumbereik

async function backfillBekendmakingen() {
  console.log('\n[bekendmakingen] Start backfill — 6 maanden (2025-12-01 t/m 2026-06-01)');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'officielebekendmakingen',
    url: 'https://zoek.officielebekendmakingen.nl',
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'daily',
    tier: 1,
  });

  const BATCH = 100;
  let start = 1;
  let total = null;

  // Correct endpoint: repository.overheid.nl/sru/Search (POST)
  // Query: dt.creator any "Amersfoort" + datumfilter (dt.date = publicatiedatum)
  while (true) {
    const body = new URLSearchParams({
      operation: 'searchRetrieve',
      'x-connection': 'ob',
      query: 'dt.creator any "Amersfoort" AND dt.date>="2025-12-01" AND dt.date<="2026-06-05"',
      maximumRecords: String(BATCH),
      startRecord: String(start),
    });

    let xml;
    try {
      const resp = await fetch('https://repository.overheid.nl/sru/Search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: body.toString(),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      xml = await resp.text();
      if (!xml.includes('searchRetrieveResponse')) {
        console.log(`  [bekendmakingen] SRU niet beschikbaar`);
        stats.errors++;
        break;
      }
    } catch (e) {
      console.error(`  [bekendmakingen] Fout bij record ${start}: ${e.message}`);
      stats.errors++;
      break;
    }

    const parsed = parseSruXml(xml);

    if (total === null) {
      total = parsed.total;
      console.log(`  [bekendmakingen] Totaal gevonden: ${total} bekendmakingen`);
      if (total === 0) break;
    }

    if (parsed.items.length === 0) break;

    for (const item of parsed.items) {
      const r = await insertItem(db, {
        source_id: sid,
        title: item.title,
        content: item.content,
        summary: item.summary,
        external_url: item.url,
        scraped_at: item.date,
        is_historical: 1,
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      else stats.errors++;
    }

    console.log(`  [bekendmakingen] Record ${start}–${start + parsed.items.length - 1}: ${stats.new} nieuw totaal`);
    start += BATCH;
    if (start > total) break;
    await sleep(500);
  }

  log('bekendmakingen-backfill', stats);
  return stats;
}

function parseSruXml(xml) {
  // Ondersteunt zowel sru: als zs: namespace-prefix
  const totalMatch = xml.match(/<sru:numberOfRecords>(\d+)<\/sru:numberOfRecords>/) ||
                     xml.match(/<zs:numberOfRecords>(\d+)<\/zs:numberOfRecords>/) ||
                     xml.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;

  const items = [];
  // Zoek naar recordData blokken (sru:, zs: of geen namespace)
  const recordRegex = /<sru:recordData>([\s\S]*?)<\/sru:recordData>|<zs:recordData>([\s\S]*?)<\/zs:recordData>|<recordData>([\s\S]*?)<\/recordData>/g;
  let match;

  while ((match = recordRegex.exec(xml)) !== null) {
    const record = match[1] ?? match[2] ?? match[3];

    const titleMatch = record.match(/<dcterms:title[^>]*>([^<]+)/) ||
                       record.match(/<dc:title[^>]*>([^<]+)/);
    // OB identifier is een code (bijv. gmb-2026-252446), construeer URL
    const idMatch = record.match(/<dcterms:identifier[^>]*>([^<]+)/) ||
                    record.match(/<dc:identifier[^>]*>([^<]+)/);
    const dateMatch = record.match(/<dcterms:modified[^>]*>([^<]+)/) ||
                      record.match(/<dcterms:date[^>]*>([^<]+)/) ||
                      record.match(/<dc:date[^>]*>([^<]+)/);
    const typeMatch = record.match(/<dcterms:type[^>]*>([^<]+)/) ||
                      record.match(/<dc:type[^>]*>([^<]+)/);
    const creatorMatch = record.match(/<dcterms:creator[^>]*>([^<]+)/);

    const title = stripHtml(titleMatch?.[1] ?? '');
    const identifier = stripHtml(idMatch?.[1] ?? '');
    const date = stripHtml(dateMatch?.[1] ?? '').substring(0, 10);
    const type = stripHtml(typeMatch?.[1] ?? '');
    const creator = stripHtml(creatorMatch?.[1] ?? '');

    // Construeer externe URL van bekendmakingencode
    const url = identifier.startsWith('http')
      ? identifier
      : (identifier ? `https://zoek.officielebekendmakingen.nl/${identifier}.html` : '');

    if (!title && !identifier) continue;

    const content = [
      type ? `Type: ${type}` : '',
      creator ? `Publicerende organisatie: ${creator}` : '',
      `Identifier: ${identifier}`,
    ].filter(Boolean).join('\n').substring(0, 10000);
    const summary = title.substring(0, 500);

    items.push({ title: title || identifier || 'Bekendmaking', url, date, content, summary });
  }

  return { total, items };
}

// ── 3. TenderNed ─────────────────────────────────────────────────────────────
// Opendata API: https://www.tenderned.nl/aankondigingen/api/v2/publicaties
// Filter op aanbestedende dienst Amersfoort

async function backfillTenderned() {
  console.log('\n[tenderned] Start backfill — 12 maanden');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'tenderned',
    url: 'https://www.tenderned.nl',
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'daily',
    tier: 1,
  });

  const dateFrom = '2025-06-01';
  const dateTo = '2026-06-04';
  const PAGE_SIZE = 25;
  let page = 0;
  let total = null;

  // TenderNed heeft een opendata zoekpagina; de API-structuur wisselt per versie.
  // We proberen de opensearch/JSON API; bij fout vallen we terug op de HTML-zoekpagina.
  while (true) {
    const url = `https://www.tenderned.nl/aankondigingen/api/v2/publicaties?` +
      `zoekterm=Amersfoort&datumVanaf=${dateFrom}&datumTot=${dateTo}` +
      `&pageSize=${PAGE_SIZE}&page=${page}&sort=datum_desc`;

    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      // Probeer alternatieve endpoint
      try {
        const altUrl = `https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties?` +
          `q=Amersfoort&datumVanaf=${dateFrom}&datumTot=${dateTo}` +
          `&rows=${PAGE_SIZE}&start=${page * PAGE_SIZE}`;
        data = await fetchJson(altUrl);
      } catch (e2) {
        console.error(`  [tenderned] API niet bereikbaar: ${e2.message}`);
        console.log('  [tenderned] Tip: draai dit later opnieuw of scrape handmatig via browser-variant');
        stats.errors++;
        break;
      }
    }

    // Normaliseer response (TenderNed API wisselt structuur)
    const items = data?.publicaties ?? data?.results ?? data?.aankondigingen ?? data?.items ?? [];
    if (total === null) {
      total = data?.totaal ?? data?.total ?? data?.numberOfResults ?? items.length;
      console.log(`  [tenderned] Totaal gevonden: ${total}`);
    }

    if (items.length === 0) break;

    for (const item of items) {
      const title = item.titel ?? item.title ?? item.omschrijving ?? 'Aanbesteding';
      const url = item.url ?? item.link ??
        (item.publicatieId ? `https://www.tenderned.nl/aankondigingen/overzicht/aankondiging/${item.publicatieId}` : '');
      const date = (item.publicatieDatum ?? item.datum ?? item.date ?? '').substring(0, 10);
      const dienst = item.aanbestedendeDienst ?? item.organisatie ?? '';
      const partij = item.gegundAan ?? item.winnaar ?? '';
      const bedrag = item.opdrachtwaarde ?? item.waarde ?? '';
      const type = item.type ?? item.procedureType ?? '';

      const content = [
        type ? `Type: ${type}` : '',
        dienst ? `Aanbestedende dienst: ${dienst}` : '',
        partij ? `Gegund aan: ${partij}` : '',
        bedrag ? `Waarde: ${bedrag}` : '',
        item.beschrijving ?? item.omschrijving ?? '',
      ].filter(Boolean).join('\n').substring(0, 10000);

      const r = await insertItem(db, {
        source_id: sid,
        title,
        content,
        summary: content.substring(0, 500),
        external_url: url,
        scraped_at: date || new Date().toISOString(),
        is_historical: 1,
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      else stats.errors++;
    }

    console.log(`  [tenderned] Pagina ${page}: ${items.length} items (${stats.new} nieuw totaal)`);
    page++;

    if (items.length < PAGE_SIZE) break;
    if (total !== null && page * PAGE_SIZE >= total) break;
    await sleep(500);
  }

  log('tenderned-backfill', stats);
  return stats;
}

// ── 4. Subsidieregister gemeente Amersfoort ───────────────────────────────────
// PDF's per jaar op amersfoort.nl/subsidieregister
// We halen de pagina op, vinden PDF-links, downloaden ze en extraheren tekst via pdftotext (als beschikbaar)

async function backfillSubsidieregister() {
  console.log('\n[subsidieregister] Start backfill — 3 jaar (2022, 2023, 2024)');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'subsidieregister',
    url: 'https://www.amersfoort.nl/subsidieregister',
    source_type: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'weekly',
    tier: 1,
  });

  // Bekende directe URL's voor de jaarverslagen subsidieregister
  // Indien de pagina veranderd is, zoek handmatig op amersfoort.nl/subsidieregister
  const jaren = [
    {
      jaar: 2024,
      // URL wordt opgehaald van de overzichtspagina; als die niet werkt, gebruik placeholder
      pageUrl: 'https://www.amersfoort.nl/subsidieregister',
    },
    { jaar: 2023, pageUrl: 'https://www.amersfoort.nl/subsidieregister' },
    { jaar: 2022, pageUrl: 'https://www.amersfoort.nl/subsidieregister' },
  ];

  // Probeer de overzichtspagina te scrapen voor PDF-links
  let pdfLinks = {};
  try {
    const html = await fetchText('https://www.amersfoort.nl/subsidieregister');
    // Zoek links die lijken op subsidieregister PDF's
    const linkRegex = /href="([^"]*subsidie[^"]*\.pdf[^"]*)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const href = m[1];
      // Probeer jaar te herkennen
      for (const jaar of [2022, 2023, 2024]) {
        if (href.includes(String(jaar))) {
          pdfLinks[jaar] = href.startsWith('http') ? href : `https://www.amersfoort.nl${href}`;
        }
      }
    }
    // Alternatief: zoek op jaarpatroon zonder 'subsidie' in naam
    const linkRegex2 = /href="([^"]*register[^"]*\.pdf[^"]*)"/gi;
    while ((m = linkRegex2.exec(html)) !== null) {
      const href = m[1];
      for (const jaar of [2022, 2023, 2024]) {
        if (href.includes(String(jaar)) && !pdfLinks[jaar]) {
          pdfLinks[jaar] = href.startsWith('http') ? href : `https://www.amersfoort.nl${href}`;
        }
      }
    }
    console.log(`  [subsidieregister] PDF-links gevonden: ${JSON.stringify(pdfLinks)}`);
  } catch (e) {
    console.error(`  [subsidieregister] Kon overzichtspagina niet ophalen: ${e.message}`);
  }

  // Als geen PDF-links gevonden: sla placeholder-items op met instructie
  for (const { jaar } of jaren) {
    const pdfUrl = pdfLinks[jaar];

    if (!pdfUrl) {
      console.log(`  [subsidieregister] Geen PDF-link gevonden voor ${jaar} — sla handmatige instructie op`);
      const r = await insertItem(db, {
        source_id: sid,
        title: `Subsidieregister Amersfoort ${jaar}`,
        content: `[HANDMATIG INVULLEN] PDF niet automatisch gevonden. Ga naar https://www.amersfoort.nl/subsidieregister, download het register van ${jaar} en voeg de data handmatig toe. Zoek op ontvangers, bedragen en doelen.`,
        summary: `Subsidieregister ${jaar} — handmatige verwerking vereist`,
        external_url: `https://www.amersfoort.nl/subsidieregister`,
        scraped_at: `${jaar}-12-31`,
        is_historical: 1,
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      continue;
    }

    // Probeer PDF te downloaden en tekst te extraheren
    try {
      console.log(`  [subsidieregister] Download ${jaar}: ${pdfUrl}`);
      const resp = await fetch(pdfUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Sla URL op als raw_item; de intake-routine kan de PDF later ophalen en verwerken
      const r = await insertItem(db, {
        source_id: sid,
        title: `Subsidieregister Amersfoort ${jaar}`,
        content: `PDF beschikbaar op: ${pdfUrl}\n\n[INTAKE VEREIST] Extraheer alle subsidieontvangst-regels: organisatie, bedrag, doel, jaar.`,
        summary: `Subsidieregister Amersfoort ${jaar} — PDF op ${pdfUrl}`,
        external_url: pdfUrl,
        scraped_at: `${jaar}-12-31`,
        is_historical: 1,
      });
      if (r === true) { stats.new++; console.log(`  [subsidieregister] ✓ ${jaar} opgeslagen`); }
      else if (r === false) { stats.skipped++; console.log(`  [subsidieregister] ${jaar} al aanwezig`); }
      else stats.errors++;
    } catch (e) {
      console.error(`  [subsidieregister] Fout bij ${jaar}: ${e.message}`);
      stats.errors++;
    }
  }

  log('subsidieregister-backfill', stats);
  return stats;
}

// ── 5. CBS StatLine — Kerncijfers wijken en buurten ───────────────────────────
// OData API: https://opendata.cbs.nl/ODataApi/odata/85039NED
// Gemeentecode Amersfoort: GM0307

async function backfillCbs() {
  console.log('\n[cbs-statline] Start backfill — kerncijfers wijken en buurten Amersfoort');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'cbs-statline',
    url: 'https://opendata.cbs.nl/statline/',
    source_type: 'api',
    reliability: 'primary',
    category: 'data',
    scrape_frequency: 'weekly',
    tier: 1,
  });

  // Probeer de meest recente dataset voor kerncijfers wijken en buurten
  // Dataset 85039NED = Kerncijfers wijken en buurten 2023
  // Dataset 84799NED = 2022, etc.
  const datasets = [
    { id: '85039NED', jaar: 2023 },
    { id: '84799NED', jaar: 2022 },
  ];

  for (const { id, jaar } of datasets) {
    const url = `https://opendata.cbs.nl/ODataApi/odata/${id}/TypedDataSet?$filter=startswith(WijkenEnBuurten,'BU0307') or startswith(WijkenEnBuurten,'GM0307')&$format=json&$top=200`;

    try {
      const data = await fetchJson(url);
      const rows = data?.value ?? [];

      if (rows.length === 0) {
        console.log(`  [cbs] Dataset ${id} geeft geen Amersfoortse wijken`);
        continue;
      }

      // Bouw een leesbare samenvatting
      const wijksamenvattingen = rows.slice(0, 50).map(r => {
        const naam = r.WijkenEnBuurten ?? r.Naam ?? '';
        const bevolking = r.AantalInwoners_5 ?? r.Bevolking ?? '';
        const inkomen = r.GemiddeldInkomenPerInwoner_66 ?? r.GemiddeldInkomen ?? '';
        const woningwaarde = r.GemiddeldeWozWaardeVanWoningen_107 ?? '';
        const werkloosheid = r.PersonenMetUitkeringWwAlsAandeel_63 ?? '';
        return `${naam}: ${bevolking ? `bevolking ${bevolking}` : ''}${inkomen ? `, gem. inkomen €${inkomen}` : ''}${woningwaarde ? `, WOZ €${woningwaarde}k` : ''}${werkloosheid ? `, WW ${werkloosheid}%` : ''}`;
      }).filter(Boolean).join('\n');

      const content = `CBS Kerncijfers wijken en buurten Amersfoort (${jaar})\nDataset: ${id}\nBron: https://opendata.cbs.nl/statline/\n\nWijksamenvatting (${rows.length} gebieden):\n${wijksamenvattingen}`;

      const r = await insertItem(db, {
        source_id: sid,
        title: `CBS Kerncijfers wijken en buurten Amersfoort ${jaar}`,
        content: content.substring(0, 10000),
        summary: `CBS kerncijfers ${rows.length} Amersfoortse wijken/buurten, jaar ${jaar}`,
        external_url: `https://opendata.cbs.nl/statline/#CBS/${id}`,
        scraped_at: `${jaar}-12-31`,
        is_historical: 1,
      });

      if (r === true) { stats.new++; console.log(`  [cbs] ✓ ${jaar} opgeslagen (${rows.length} gebieden)`); }
      else if (r === false) { stats.skipped++; console.log(`  [cbs] ${jaar} al aanwezig`); }
      else stats.errors++;

    } catch (e) {
      console.error(`  [cbs] Fout bij dataset ${id}: ${e.message}`);
      stats.errors++;
    }

    await sleep(1000);
  }

  log('cbs-backfill', stats);
  return stats;
}

// ── 6. Jaarverslagen sleutelorganisaties ──────────────────────────────────────
// Haal meest recente jaarverslag op per organisatie
// Extractie is beperkt zonder PDF-parser; we slaan URL + beschikbare tekst op

async function backfillJaarverslagen() {
  console.log('\n[jaarverslagen] Start backfill — sleutelorganisaties Amersfoort');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const organisaties = [
    {
      id: 'jaarverslag-meander',
      naam: 'Meander MC',
      url: 'https://www.meandermc.nl/over-meander/publicaties/jaarverslag/',
      zoekterm: 'jaarverslag 2024 OR jaarverslag 2023',
      kerncijfers: 'omzet, resultaat, FTE, wachttijden',
    },
    {
      id: 'jaarverslag-alliantie',
      naam: 'De Alliantie',
      url: 'https://www.de-alliantie.nl/over-alliantie/publicaties/',
      zoekterm: 'jaarverslag 2023',
      kerncijfers: 'woningbezit Amersfoort, huurbeleid, nieuwbouw',
    },
    {
      id: 'jaarverslag-portaal',
      naam: 'Portaal',
      url: 'https://www.portaal.nl/over-portaal/publicaties/jaarverslag',
      zoekterm: 'jaarverslag 2023 2024',
      kerncijfers: 'woningbezit, onderhoud, investeringen',
    },
    {
      id: 'jaarverslag-amfors',
      naam: 'Amfors/RWA',
      url: 'https://www.amfors.nl/over-amfors/publicaties/',
      zoekterm: 'jaarverslag 2023',
      kerncijfers: 'financieel resultaat, wsw-plekken, ziekteverzuim',
    },
    {
      id: 'jaarverslag-gemeente',
      naam: 'Gemeente Amersfoort',
      url: 'https://www.amersfoort.nl/jaarstukken',
      zoekterm: 'jaarstukken 2024 2023',
      kerncijfers: 'begroting vs realisatie, reserves',
    },
    {
      id: 'jaarverslag-pcbo',
      naam: 'PCBO Amersfoort',
      url: 'https://www.pcboamersfoort.nl/over-pcbo/publicaties/',
      zoekterm: 'jaarverslag 2023',
      kerncijfers: 'leerlingaantallen, financiën, vastgoed',
    },
    {
      id: 'jaarverslag-meerkring',
      naam: 'Stichting Meerkring',
      url: 'https://www.meerkring.nl/over-meerkring/',
      zoekterm: 'jaarverslag 2023',
      kerncijfers: 'leerlingaantallen, financiën',
    },
    {
      id: 'jaarverslag-ggdru',
      naam: 'GGD regio Utrecht',
      url: 'https://www.ggdru.nl/over-ggd-regio-utrecht/publicaties/',
      zoekterm: 'jaarverslag 2023 2024',
      kerncijfers: 'regionale gezondheidscijfers',
    },
    {
      id: 'jaarverslag-swvdeeem',
      naam: 'SWV De Eem',
      url: 'https://www.swvdeeem.nl/over-ons/',
      zoekterm: 'jaarverslag jaarrekening 2023',
      kerncijfers: 'budget passend onderwijs, verdeling',
    },
    {
      id: 'jaarverslag-onderwijsgroep',
      naam: 'Onderwijsgroep Amersfoort',
      url: 'https://www.onderwijsgroepamersfoort.nl/over-ons/publicaties/',
      zoekterm: 'jaarverslag 2023',
      kerncijfers: 'leerlingen, reserves, vastgoedplannen',
    },
  ];

  for (const org of organisaties) {
    try {
      // Registreer als bron
      const sid = await ensureSource(db, {
        name: org.id,
        url: org.url,
        source_type: 'scrape',
        reliability: 'primary',
        category: 'government',
        scrape_frequency: 'weekly',
        tier: 2,
      });

      // Probeer de publicatiepagina op te halen
      let content = '';
      let pdfUrl = '';
      let jaar = '2023';

      try {
        const html = await fetchText(org.url);
        // Zoek PDF-links met jaar in naam
        const pdfRegex = /href="([^"]*(?:jaarverslag|jaarrekening|jaarstukken)[^"]*(?:202[234])[^"]*\.pdf[^"]*)"/gi;
        const pdfMatch = pdfRegex.exec(html);
        if (pdfMatch) {
          pdfUrl = pdfMatch[1].startsWith('http') ? pdfMatch[1] : `${new URL(org.url).origin}${pdfMatch[1]}`;
          const jaarMatch = pdfUrl.match(/202[234]/);
          if (jaarMatch) jaar = jaarMatch[0];
        }

        // Extraheer relevante tekst van de pagina
        const tekst = stripHtml(html).substring(0, 3000);
        content = `${org.naam} — Publicatiepagina\nURL: ${org.url}\n\nGerichte kerncijfers: ${org.kerncijfers}\n\nPaginatekst (fragment):\n${tekst}`;
        if (pdfUrl) content += `\n\nJaarverslag PDF: ${pdfUrl}`;
      } catch (e) {
        content = `${org.naam} — Pagina niet bereikbaar (${e.message})\nURL: ${org.url}\nKerncijfers om te zoeken: ${org.kerncijfers}\n\n[HANDMATIG INVULLEN] Zoek het jaarverslag op en vul kerncijfers aan.`;
      }

      const r = await insertItem(db, {
        source_id: sid,
        title: `${org.naam} Jaarverslag ${jaar}`,
        content: content.substring(0, 10000),
        summary: `Jaarverslag ${org.naam} (${jaar}). Kerncijfers: ${org.kerncijfers}`,
        external_url: pdfUrl || org.url,
        scraped_at: `${jaar}-12-31`,
        is_historical: 1,
      });

      if (r === true) { stats.new++; console.log(`  [jaarverslagen] ✓ ${org.naam} ${jaar}`); }
      else if (r === false) { stats.skipped++; console.log(`  [jaarverslagen] ${org.naam} al aanwezig`); }
      else stats.errors++;

    } catch (e) {
      console.error(`  [jaarverslagen] Fout bij ${org.naam}: ${e.message}`);
      stats.errors++;
    }

    await sleep(1500); // vriendelijk voor servers
  }

  log('jaarverslagen-backfill', stats);
  return stats;
}

// ── 7. Raadsinformatie/Notubiz — Amersfoort ─────────────────────────────────────
// Directe JSON API: api.notubiz.nl/events?organisation_id=867
// Geen Playwright nodig — puur fetch

async function backfillNotubizApi() {
  console.log('\n[raadsinformatie] Start backfill via Notubiz API — 12 maanden');
  const stats = { new: 0, skipped: 0, errors: 0 };

  const sid = await ensureSource(db, {
    name: 'raadsinformatie',
    url: 'https://amersfoort.raadsinformatie.nl',
    source_type: 'api',
    reliability: 'primary',
    category: 'government',
    scrape_frequency: 'daily',
    tier: 1,
  });

  const ORG_ID = 867;
  const DATE_FROM = '2025-06-01 00:00:00';
  const DATE_TO = '2026-06-05 00:00:00';
  const PER_PAGE = 100;

  let page = 1;
  let totalPages = null;

  while (true) {
    const url = `https://api.notubiz.nl/events?version=3.62.0&lang=nl-nl&format=json` +
      `&organisation_id=${ORG_ID}&date_from=${encodeURIComponent(DATE_FROM)}` +
      `&date_to=${encodeURIComponent(DATE_TO)}&page=${page}&per_page=${PER_PAGE}` +
      `&sort_field=start_date&sort_order=ASC&user_permission_group=&template=false`;

    let data;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
    } catch (e) {
      console.error(`  [raadsinformatie] Fout bij pagina ${page}: ${e.message}`);
      stats.errors++;
      break;
    }

    const pagination = data.pagination ?? {};
    if (totalPages === null) {
      totalPages = pagination.total_pages ?? 1;
      console.log(`  [raadsinformatie] Totaal: ${pagination.total_items} vergaderingen, ${totalPages} pagina's`);
    }

    const events = data.events ?? data.items ?? [];
    if (events.length === 0) break;

    for (const event of events) {
      // Haal titel uit URL of attributes
      const eventUrl = event.url ?? `https://amersfoort.raadsinformatie.nl/vergadering/${event.id}`;
      const urlTitle = decodeURIComponent((eventUrl.split('/').pop() ?? '').replace(/\+/g, ' '));
      const attrTitle = (event.attributes ?? []).find(a => typeof a.value === 'string' && a.value.length > 2 && !a.value.includes('http'))?.value;
      const title = attrTitle || urlTitle || `Vergadering ${event.id}`;

      const startDate = event.plannings?.[0]?.start_date ?? event.creation_date ?? '';
      const dateStr = startDate.substring(0, 10);
      const gremiumId = event.gremium?.id;

      // Agenda-items als content
      const agendaItems = (event.agenda_items ?? [])
        .slice(0, 20)
        .map(a => a.title ?? a.name ?? '')
        .filter(Boolean);
      const content = [
        `Vergadering: ${title}`,
        `Datum: ${startDate}`,
        gremiumId ? `Gremium ID: ${gremiumId}` : '',
        agendaItems.length ? `\nAgenda:\n${agendaItems.map(i => `- ${i}`).join('\n')}` : '',
      ].filter(Boolean).join('\n').substring(0, 10000);

      const r = await insertItem(db, {
        source_id: sid,
        title: title.substring(0, 490),
        content,
        summary: `Vergadering Amersfoort: ${title} (${dateStr})`,
        external_url: eventUrl,
        scraped_at: startDate ? `${dateStr}T00:00:00.000Z` : new Date().toISOString(),
        is_historical: 1,
      });
      if (r === true) stats.new++;
      else if (r === false) stats.skipped++;
      else stats.errors++;
    }

    console.log(`  [raadsinformatie] Pagina ${page}/${totalPages}: ${events.length} vergaderingen (${stats.new} nieuw totaal)`);
    if (page >= totalPages) break;
    page++;
    await sleep(300);
  }

  log('raadsinformatie-backfill', stats);
  return stats;
}

// ── Hoofdprogramma ─────────────────────────────────────────────────────────────

async function main() {
  const bron = process.argv[2] ?? 'all';
  const bronnen = bron === 'all'
    ? ['rechtspraak', 'bekendmakingen', 'tenderned', 'subsidieregister', 'cbs', 'jaarverslagen', 'raadsinformatie']
    : [bron];

  console.log(`\n=== Stadsgeest Historische Backfill ===`);
  console.log(`Bronnen: ${bronnen.join(', ')}`);
  console.log(`Gestart: ${new Date().toISOString()}`);

  // Zorg dat de kolom bestaat
  await ensureHistoricalColumn();

  const totaal = { new: 0, skipped: 0, errors: 0 };

  for (const b of bronnen) {
    let stats;
    try {
      switch (b) {
        case 'rechtspraak':     stats = await backfillRechtspraak(); break;
        case 'bekendmakingen':  stats = await backfillBekendmakingen(); break;
        case 'tenderned':       stats = await backfillTenderned(); break;
        case 'subsidieregister': stats = await backfillSubsidieregister(); break;
        case 'cbs':             stats = await backfillCbs(); break;
        case 'jaarverslagen':   stats = await backfillJaarverslagen(); break;
        case 'raadsinformatie': stats = await backfillNotubizApi(); break;
        default:
          console.error(`Onbekende bron: ${b}`);
          console.log('Gebruik: node src/run-backfill.js [rechtspraak|bekendmakingen|tenderned|subsidieregister|cbs|jaarverslagen|raadsinformatie|all]');
          process.exit(1);
      }
    } catch (e) {
      console.error(`\n[FATALE FOUT bij ${b}] ${e.message}`);
      stats = { new: 0, skipped: 0, errors: 1 };
    }
    totaal.new += stats.new;
    totaal.skipped += stats.skipped;
    totaal.errors += stats.errors;
  }

  console.log(`\n=== Backfill klaar: ${new Date().toISOString()} ===`);
  console.log(`Totaal nieuw: ${totaal.new} | Overgeslagen: ${totaal.skipped} | Fouten: ${totaal.errors}`);

  // Verificatie-queries
  console.log('\n── Verificatie ──');
  try {
    const count = await db.execute('SELECT COUNT(*) as n FROM raw_items WHERE is_historical = 1');
    console.log(`raw_items met is_historical=1: ${count.rows[0].n}`);
    const perBron = await db.execute(`
      SELECT s.name, COUNT(r.id) as n
      FROM raw_items r
      JOIN sources s ON r.source_id = s.id
      WHERE r.is_historical = 1
      GROUP BY s.name ORDER BY n DESC
    `);
    for (const row of perBron.rows) {
      console.log(`  ${row.name}: ${row.n}`);
    }
  } catch (e) {
    console.error(`Verificatie mislukt: ${e.message}`);
  }

  console.log('\nVolgende stap: draai de intake-routine over historische items.');
  console.log('Zorg dat de intake is_historical=1 items verwerkt met status "watching" i.p.v. "new".');
}

main().catch(e => { console.error(e); process.exit(1); });
