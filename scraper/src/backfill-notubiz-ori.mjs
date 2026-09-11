// Eenmalige of periodieke batch-backfill van Notubiz-documenttekst uit Open
// Raadsinformatie. Recente stukken kunnen ontbreken; die blijven onaangeroerd
// en worden door fetch-fulltext.js wekelijks opnieuw geprobeerd.

import { createDb } from './lib.js';
import { notubizDocumentParts } from './notubiz-fulltext.mjs';

const ES = 'https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search';
const UA = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';
const BATCH = 100;

function sleutel(url) {
  const parts = notubizDocumentParts(url);
  return parts ? `${parts.documentId}/${parts.revision}` : null;
}

const db = createDb();
try {
  const result = await db.execute(`
    SELECT id, external_url
    FROM raw_items
    WHERE full_text IS NULL
      AND external_url LIKE '%notubiz.nl/document/%'
    ORDER BY id
  `);
  const items = result.rows
    .map(row => ({ ...row, key: sleutel(row.external_url) }))
    .filter(row => row.key);
  const keys = [...new Set(items.map(row => row.key))];
  const textByKey = new Map();

  for (let start = 0; start < keys.length; start += BATCH) {
    const part = keys.slice(start, start + BATCH);
    const urls = part.map(key => `https://api.notubiz.nl/document/${key}`);
    const response = await fetch(ES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        size: part.length * 3,
        query: { terms: { original_url: urls } },
        _source: ['text', 'original_url'],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`ORI HTTP ${response.status}`);
    const json = await response.json();
    for (const hit of json.hits?.hits || []) {
      const key = sleutel(hit?._source?.original_url);
      const text = String(hit?._source?.text || '').replace(/\s+/g, ' ').trim();
      if (!key || text.length < 200) continue;
      if (text.length > (textByKey.get(key)?.length || 0)) textByKey.set(key, text);
    }
    console.log(`[NOTUBIZ-ORI] batch ${Math.floor(start / BATCH) + 1}: ${part.length} documenten bevraagd`);
  }

  let bijgewerkt = 0;
  for (const item of items) {
    const text = textByKey.get(item.key);
    if (!text) continue;
    await db.execute({
      sql: `UPDATE raw_items
            SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL
            WHERE id = ? AND full_text IS NULL`,
      args: [text.substring(0, 200000), new Date().toISOString(), item.id],
    });
    bijgewerkt++;
  }
  console.log(`[NOTUBIZ-ORI] klaar: ${bijgewerkt}/${items.length} ontbrekende items aangevuld; ${items.length - bijgewerkt} nog niet in ORI`);
} finally {
  await db.close();
}
