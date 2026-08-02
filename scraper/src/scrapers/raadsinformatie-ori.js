// Raadsinformatie via Open Raadsinformatie API (2026-08-02).
// Vervangt raadsinformatie-api.js (Notubiz-modulepagina's zitten sinds juli achter
// Cloudflare Turnstile; het Notubiz documents-endpoint vereist een auth-token).
// ORI: https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search
// Classificeert op naam naar de bestaande substromen (zelfde bronnamen, historie loopt door).
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const ES = 'https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search';
const UA = 'Stadsgeest033/1.0 (redactie@stadsgeest.nl)';

const STREAMS = [
  { name: 'Raad Amersfoort — Schriftelijke vragen', re: /schriftelijke\s+vra(a)?g|beantwoording.*vragen/i },
  { name: 'Raad Amersfoort — Moties', re: /\bmotie\b|amendement/i },
  { name: 'Raad Amersfoort — Raadsinformatiebrieven', re: /raadsinformatiebrief|collegebericht|\bRIB\b/i },
  { name: 'Raad Amersfoort — Ingekomen stukken', re: /ingekomen stuk/i },
  { name: 'Raad Amersfoort — Vergaderingen en overig', re: /./ }, // catch-all
];

async function scrape() {
  const sourceIds = {};
  for (const s of STREAMS) {
    sourceIds[s.name] = await getOrCreateSource(db, {
      name: s.name,
      url: 'https://amersfoort.notubiz.nl',
      sourceType: 'api',
      reliability: 'primary',
      category: 'government',
      scrapeFrequency: 'daily',
    });
  }

  const dagen = parseInt(process.env.ORI_DAGEN || '14', 10); // 14: raad vergadert niet wekelijks (reces)
  const since = new Date(Date.now() - dagen * 864e5).toISOString();
  const body = {
    size: 100,
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

  for (const h of hits) {
    const src = h._source || {};
    const naam = String(src.name || '').trim();
    if (!naam) continue;
    const stream = STREAMS.find(s => s.re.test(naam)) || STREAMS[STREAMS.length - 1];
    const url = src.original_url || (Array.isArray(src.sources) && src.sources[0] && src.sources[0].url) || `https://api.openraadsinformatie.nl/v1/elastic/${h._index}/_doc/${encodeURIComponent(h._id)}`;
    const tekst = String(src.text || src.description || '').substring(0, 8000);
    const datum = src.last_discussed_at || src.start_date || src['@timestamp'] || new Date().toISOString();
    try {
      const r = await saveRawItem(db, {
        sourceId: sourceIds[stream.name],
        externalUrl: url,
        title: naam.substring(0, 300),
        content: tekst,
        summary: `${src['@type'] || ''} — raadsinformatie Amersfoort, ${String(datum).substring(0, 10)}`,
      });
      if (r.saved) stats[stream.name].new++; else stats[stream.name].skipped++;
    } catch (e) {
      stats[stream.name].errors++;
    }
  }
  for (const s of STREAMS) {
    await logResult(db, sourceIds[s.name], s.name, stats[s.name].new, stats[s.name].skipped, stats[s.name].errors);
  }
}

scrape().catch(e => { console.error('raadsinformatie-ori:', e.message); process.exit(1); });
