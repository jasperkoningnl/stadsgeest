// Raadsinformatie via Open Raadsinformatie API (2026-08-02).
// Vervangt raadsinformatie-api.js (Notubiz-modulepagina's zitten sinds juli achter
// Cloudflare Turnstile; het Notubiz documents-endpoint vereist een auth-token).
// ORI: https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search
// Classificeert op naam naar de bestaande substromen (zelfde bronnamen, historie loopt door).
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult, makeSummary } from '../utils.js';

const ES = 'https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search';
const UA = 'Stadsgeest033/1.0 (redactie@stadsgeest.nl)';

// LABELREPARATIE 9 augustus 2026 — lees dit voordat je hier iets wijzigt.
//
// Alle vijf de stromen kregen hierboven dezelfde url mee: amersfoort.notubiz.nl.
// `getOrCreateSource` zoekt uitsluitend op url (`SELECT id FROM sources WHERE
// url = ?`) en niet op naam. Alle vijf losten dus op naar dezelfde bronrij, en dat
// is rij 108 'raadsinformatie', die toevallig die url draagt.
//
// Gevolg, terug te zien in de database: sinds 2 augustus staan in `scrape_runs`
// twintig runs per stroom met vijf verschillende `source_name`-waarden en steeds
// `source_id = 108`, en zijn alle honderd nieuwe items van die periode onder rij
// 108 weggeschreven. De zes rijen 115 t/m 120, die precies voor deze stromen zijn
// aangemaakt, kregen niets meer — vandaar 'Raad Amersfoort — Amendementen' met nul
// items ooit, en vandaar dat rij 108 er als productiefste bron uit zag terwijl hij
// op health 'dood' stond.
//
// De rijen 115-120 bestaan al, met een eigen url per stroom
// (https://amersfoort.raadsinformatie.nl/#/raad-...). Dezelfde url's gebruikt
// raadsinformatie-types.js in `registerSources`. Door die url per stroom mee te
// geven landt elke stroom weer op zijn eigen rij. Er wordt hier niets samengevoegd
// en geen rij aangepast; wat er in rij 108 staat blijft staan.
//
// Tweede reparatie: amendementen vielen onder de motie-regex en kwamen dus nooit in
// hun eigen stroom terecht. Amendementen staan nu vóór moties in de lijst, want de
// eerste treffer wint.
const BASIS_RAAD = 'https://amersfoort.raadsinformatie.nl';
const STREAMS = [
  { name: 'Raad Amersfoort — Schriftelijke vragen', sleutel: 'raad-schriftelijke-vragen', re: /schriftelijke\s+vra(a)?g|beantwoording.*vragen/i },
  { name: 'Raad Amersfoort — Amendementen', sleutel: 'raad-amendementen', re: /amendement/i },
  { name: 'Raad Amersfoort — Moties', sleutel: 'raad-moties', re: /\bmotie(s)?\b/i },
  { name: 'Raad Amersfoort — Raadsinformatiebrieven', sleutel: 'raad-informatiebrieven', re: /raadsinformatiebrief|collegebericht|\bRIB\b/i },
  { name: 'Raad Amersfoort — Ingekomen stukken', sleutel: 'raad-ingekomen-stukken', re: /ingekomen stuk/i },
  { name: 'Raad Amersfoort — Vergaderingen en overig', sleutel: 'raad-vergaderingen', re: /./ }, // catch-all
];

async function scrape() {
  const sourceIds = {};
  for (const s of STREAMS) {
    sourceIds[s.name] = await getOrCreateSource(db, {
      name: s.name,
      url: `${BASIS_RAAD}/#/${s.sleutel}`,
      sourceType: 'api',
      reliability: 'primary',
      category: 'government',
      scrapeFrequency: 'daily',
    });
  }
  const uniek = new Set(Object.values(sourceIds).map(String));
  if (uniek.size !== STREAMS.length) {
    // Vangnet voor precies de fout die hierboven beschreven staat.
    console.error(`raadsinformatie-ori: ${STREAMS.length} stromen lossen op naar ${uniek.size} bronrijen — controleer de url's`);
  }

  const dagen = parseInt(process.env.ORI_DAGEN || '14', 10); // 14: raad vergadert niet wekelijks (reces)
  const since = new Date(Date.now() - dagen * 864e5).toISOString();
  // size 100 zonder sortering leverde willekeurig welke honderd documenten ES als
  // eerste teruggaf. Daardoor bleven op 9 augustus de losse amendementen van de
  // raadsvergadering van 8 juli buiten beeld en viel alles in de catch-all, terwijl
  // ze wel in de index staan (77 documenten met 'amendement' in de naam, met
  // AANGENOMEN/VERWORPEN in de titel). Nu nieuwste eerst en een ruimere size.
  const body = {
    size: 250,
    sort: [{ last_discussed_at: { order: 'desc', unmapped_type: 'date' } }],
    query: {
      bool: {
        must: [{ terms: { '@type': ['Meeting', 'MediaObject', 'AgendaItem'] } }],
        should: [
          { range: { last_discussed_at: { gte: since } } },
          { range: { start_date: { gte: since } } },
        ],
        minimum_should_match: 1,
      },
    },
  };
  const resp = await fetch(ES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`ORI HTTP ${resp.status}`);
  const json = await resp.json();
  const hits = (json.hits && json.hits.hits) || [];

  const stats = {};
  for (const s of STREAMS) stats[s.name] = { new: 0, skipped: 0, errors: 0 };

  // Grendel tegen dubbelen over bronrijen heen. `saveRawItem` dedupliceert op een
  // hash van titel + url, maar die constraint blijkt niet te verhinderen dat
  // hetzelfde document onder een tweede bronrij binnenkomt. Toen de stromen op
  // 9 augustus naar hun eigen rij werden teruggezet, kwamen daardoor in één run
  // 64 documenten die al onder rij 108 stonden opnieuw binnen onder rij 120.
  // Die 64 zijn diezelfde dag verwijderd; deze controle voorkomt de herhaling.
  // Het raakt alleen de raadsinformatierijen, want daar zit de historische
  // overlap; een bredere controle zou elke run een tabelscan kosten.
  const RAADSRIJEN = [108, 31, ...Object.values(sourceIds).map(Number)];
  const plaatshouders = RAADSRIJEN.map(() => '?').join(',');
  async function elders(url) {
    if (!url) return false;
    const r = await db.execute({
      sql: `SELECT 1 FROM raw_items WHERE external_url = ? AND source_id IN (${plaatshouders}) LIMIT 1`,
      args: [url, ...RAADSRIJEN],
    });
    return r.rows.length > 0;
  }

  for (const h of hits) {
    const src = h._source || {};
    const naam = String(src.name || '').trim();
    if (!naam) continue;
    const stream = STREAMS.find(s => s.re.test(naam)) || STREAMS[STREAMS.length - 1];
    const url = src.original_url || (Array.isArray(src.sources) && src.sources[0] && src.sources[0].url) || `https://api.openraadsinformatie.nl/v1/elastic/${h._index}/_doc/${encodeURIComponent(h._id)}`;
    const tekst = String(src.text || src.description || '').substring(0, 25000);
    const datum = src.last_discussed_at || src.start_date || src['@timestamp'] || new Date().toISOString();
    try {
      if (await elders(url)) { stats[stream.name].skipped++; continue; }
      const r = await saveRawItem(db, {
        sourceId: sourceIds[stream.name],
        externalUrl: url,
        title: naam.substring(0, 300),
        content: tekst,
        summary: makeSummary(tekst) || `${src['@type'] || ''} — raadsinformatie Amersfoort, ${String(datum).substring(0, 10)}`,
        publishedAt: datum,
      });
      if (r.saved) stats[stream.name].new++; else stats[stream.name].skipped++;
    } catch (e) {
      stats[stream.name].errors++;
    }
  }
  for (const s of STREAMS) {
    await logResult(db, sourceIds[s.name], s.name, stats[s.name].new, stats[s.name].skipped, stats[s.name].errors);
  }

  // ── Leusden (toegevoegd 2026-08-15, besluit Jasper) ──────────────────────
  // Open Raadsinformatie heeft ook een Leusden-index (ori_leusden_*), dus de
  // Leusdense raadsinformatie is een tweede pass op dezelfde API — geen
  // nieuwbouw. Bewust één bron in plaats van zes stromen: Leusden vergadert
  // minder vaak en zes vrijwel lege bronnen maken het overzicht onleesbaar
  // (zelfde afweging als bij Officiële Bekendmakingen — Leusden, bron 127).
  // De bron-url is de ORI-ingang zelf: uniek, en getOrCreateSource matcht op
  // url — een gedeelde url was precies de labelfout van 9 augustus.
  //
  // Leusden krijgt een eigen venster (standaard 30 dagen): de raad vergadert
  // daar ongeveer maandelijks, dus met de 14 dagen van Amersfoort levert de
  // bron structureel nul. Gemeten op 15 augustus 2026: 0 documenten binnen
  // 30 dagen, 46 binnen 45 dagen (de raadsvergadering van 9 juli over de
  // kadernota), 198 binnen 90 dagen. Verruim dit dus met mate — 90 dagen is
  // een backfill, geen venster.
  try {
    await leusdenPass(parseInt(process.env.ORI_DAGEN_LEUSDEN || '30', 10));
  } catch (e) {
    console.error('raadsinformatie-ori (Leusden):', e.message);
  }
}

async function leusdenPass(dagen) {
  const ES_LEUSDEN = 'https://api.openraadsinformatie.nl/v1/elastic/ori_leusden*/_search';
  const naam = 'Raadsinformatie Leusden';
  const sourceId = await getOrCreateSource(db, {
    name: naam,
    url: 'https://api.openraadsinformatie.nl/v1/elastic/ori_leusden*',
    sourceType: 'api',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'daily',
  });
  // getOrCreateSource uit utils.js kent geen tier- of gemeentekolom; zet die
  // hier, zodat de weger en het dashboard de bron goed inschalen. Tier 1 is
  // geen detail: raadsinformatie is volgens de weegregels een publicatiebron
  // die op eigen kracht dragend mag zijn (+3). Op tier 2 haalt een Leusdense
  // tip de drempel van 6 vrijwel nooit — precies het gat dat deze bron dicht.
  // Bij de eerste run kwam de rij op tier 2 binnen; daarom expliciet zetten
  // en niet met COALESCE.
  await db.execute({
    sql: `UPDATE sources SET tier = 1, gemeente = 'Leusden' WHERE id = ?`,
    args: [sourceId],
  });

  const since = new Date(Date.now() - dagen * 864e5).toISOString();
  const body = {
    size: 250,
    sort: [{ last_discussed_at: { order: 'desc', unmapped_type: 'date' } }],
    query: {
      bool: {
        must: [{ terms: { '@type': ['Meeting', 'MediaObject', 'AgendaItem'] } }],
        should: [
          { range: { last_discussed_at: { gte: since } } },
          { range: { start_date: { gte: since } } },
        ],
        minimum_should_match: 1,
      },
    },
  };
  const resp = await fetch(ES_LEUSDEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`ORI Leusden HTTP ${resp.status}`);
  const json = await resp.json();
  const hits = (json.hits && json.hits.hits) || [];

  let nieuw = 0, overgeslagen = 0, fouten = 0;
  for (const h of hits) {
    const src = h._source || {};
    const titel = String(src.name || '').trim();
    if (!titel) continue;
    const url = src.original_url || (Array.isArray(src.sources) && src.sources[0] && src.sources[0].url) || `https://api.openraadsinformatie.nl/v1/elastic/${h._index}/_doc/${encodeURIComponent(h._id)}`;
    const tekst = String(src.text || src.description || '').substring(0, 25000);
    const datum = src.last_discussed_at || src.start_date || src['@timestamp'] || new Date().toISOString();
    try {
      const r = await saveRawItem(db, {
        sourceId,
        externalUrl: url,
        title: titel.substring(0, 300),
        content: tekst,
        summary: makeSummary(tekst) || `${src['@type'] || ''} — raadsinformatie Leusden, ${String(datum).substring(0, 10)}`,
        publishedAt: datum,
      });
      if (r.saved) nieuw++; else overgeslagen++;
    } catch {
      fouten++;
    }
  }
  await logResult(db, sourceId, naam, nieuw, overgeslagen, fouten, hits.length);
}

scrape().catch(e => { console.error('raadsinformatie-ori:', e.message); process.exit(1); });
