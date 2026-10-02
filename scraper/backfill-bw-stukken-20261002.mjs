// Eenmalige inhaalslag (2 oktober 2026): gesplitste B&W-stukken die sinds
// 1 september als URL-duplicaat zijn weggefilterd, opnieuw aanbieden aan de intake.
//
// De stukken hielden de URL van de besluitenlijst en zijn daardoor nooit een
// signaal geworden (zie docs/HANDOFFS/2026-10.md). Dit script geeft elk stuk een
// eigen URL en zet is_processed terug op 0. Exacte dubbelen (zelfde lijst, titel
// en tekst) blijven staan; alleen het oudste exemplaar gaat mee.
//
// Gebruik: node backfill-bw-stukken-20261002.mjs            (droog, wijzigt niets)
//          node backfill-bw-stukken-20261002.mjs --apply
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';
import { stukUrl, STUK_KENMERK } from './src/omnibus-split-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });
const APPLY = process.argv.includes('--apply');
const VANAF = '2026-09-01';
const BRON_ID = 131;

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const res = await db.execute({
  sql: `SELECT r.id, r.external_url, r.title, r.content, r.scraped_at
        FROM raw_items r
        WHERE r.source_id = ? AND r.summary LIKE 'Gesplitst uit besluitenlijst%'
          AND r.scraped_at >= ? AND r.is_processed = 1
          AND NOT EXISTS (SELECT 1 FROM signal_items si WHERE si.raw_item_id = r.id)
        ORDER BY r.id`,
  args: [BRON_ID, VANAF],
});

const gezien = new Set();
const gebruikt = new Set();
const teDoen = [];
let dubbel = 0, alKenmerk = 0;
for (const r of res.rows) {
  if (String(r.external_url || '').includes(STUK_KENMERK)) { alKenmerk++; continue; }
  const inhoud = crypto.createHash('sha1').update(`${r.external_url}|${r.title}|${r.content}`).digest('hex');
  if (gezien.has(inhoud)) { dubbel++; continue; }
  gezien.add(inhoud);
  const basis = stukUrl(r.external_url, String(r.title || '').replace(/^\[B&W\]\s*/, ''));
  let url = basis;
  for (let n = 2; gebruikt.has(url); n++) url = `${basis}-${n}`;
  gebruikt.add(url);
  teDoen.push({ id: r.id, url, dag: String(r.scraped_at).slice(0, 10), titel: String(r.title || '').slice(0, 70) });
}

const perDag = {};
for (const t of teDoen) perDag[t.dag] = (perDag[t.dag] || 0) + 1;
console.log(`${res.rows.length} stukken gevonden sinds ${VANAF}; ${teDoen.length} opnieuw aanbieden, ${dubbel} exacte dubbelen overgeslagen, ${alKenmerk} hadden al een eigen URL.`);
console.log('per scrapedag:', JSON.stringify(perDag));
for (const t of teDoen.slice(0, 5)) console.log(`  voorbeeld #${t.id} ${t.dag} ${t.titel}`);

if (!APPLY) { console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.'); process.exit(0); }

let gewijzigd = 0;
for (let i = 0; i < teDoen.length; i += 25) {
  const batch = teDoen.slice(i, i + 25).map((t) => ({
    sql: 'UPDATE raw_items SET external_url = ?, is_processed = 0 WHERE id = ? AND source_id = ? AND is_processed = 1',
    args: [t.url, t.id, BRON_ID],
  }));
  const uit = await db.batch(batch, 'write');
  gewijzigd += uit.reduce((a, u) => a + Number(u.rowsAffected || 0), 0);
}
console.log(`Geschreven: ${gewijzigd} stukken met eigen URL en is_processed = 0.`);
