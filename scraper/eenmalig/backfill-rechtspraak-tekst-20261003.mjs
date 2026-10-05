// Eenmalige inhaalslag (3 oktober 2026): uitspraken zonder tekst alsnog ophalen
// via data.rechtspraak.nl.
//
// Twee groepen: oudere items met een URL naar de detailpagina (JavaScript, geen
// tekst) en items waarvan bij het scrapen alleen metadata bestond. Ook items
// waar de metadata als "tekst" is opgeslagen (korter dan 500 tekens) gaan mee.
// Bron 95 is de oude, uitgeschakelde rechtspraakbron; die items zijn historisch
// en krijgen tekst voor het archief en de entiteitenscan. Er ontstaan geen
// nieuwe signalen. Zie docs/HANDOFFS/2026-W40.md.
//
// Gebruik (vanuit scraper/):
//   node backfill-rechtspraak-tekst-20261003.mjs              droog: haalt op, schrijft niets
//   node backfill-rechtspraak-tekst-20261003.mjs --apply      opties: --limit 10  --bron 17
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haalRechtspraakTekst } from '../src/rechtspraak-fulltext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i > -1 ? process.argv[i + 1] : std; };
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit', '0'));
const BRONNEN = arg('--bron', '17,95').split(',').map(Number).filter(Boolean);
const MAX_FULLTEXT = 200000; // gelijk aan fetch-fulltext.js

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const res = await db.execute({
  sql: `SELECT id, source_id, external_url, title, length(full_text) AS had FROM raw_items
        WHERE source_id IN (${BRONNEN.map(() => '?').join(',')})
          AND (full_text IS NULL OR length(full_text) < 500)
          AND external_url LIKE '%rechtspraak.nl/%'
        ORDER BY id DESC`,
  args: BRONNEN,
});
const werk = LIMIT ? res.rows.slice(0, LIMIT) : res.rows;
console.log(`${res.rows.length} uitspraken zonder tekst in bron ${BRONNEN.join(', ')}; ${werk.length} in deze run (${APPLY ? 'SCHRIJFT' : 'droog'}).`);

const tel = {};
const telOp = (bron, sleutel, n = 1) => { tel[bron] ??= {}; tel[bron][sleutel] = (tel[bron][sleutel] || 0) + n; };
const verslag = [];
for (const r of werk) {
  const uit = await haalRechtspraakTekst(String(r.external_url));
  telOp(r.source_id, uit.text ? 'ok' : uit.reason);
  if (uit.text) {
    telOp(r.source_id, 'tekens', uit.text.length);
    if (uit.text.length > MAX_FULLTEXT) telOp(r.source_id, 'afgekapt');
    if (APPLY) {
      const w = await db.execute({
        sql: `UPDATE raw_items SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL
              WHERE id = ? AND (full_text IS NULL OR length(full_text) < 500)`,
        args: [uit.text.substring(0, MAX_FULLTEXT), new Date().toISOString(), r.id],
      });
      telOp(r.source_id, 'geschreven', w.rowsAffected);
    }
  }
  verslag.push({ id: Number(r.id), bron: Number(r.source_id), had: r.had, reden: uit.reason, tekens: uit.text?.length || 0 });
  await new Promise((klaar) => setTimeout(klaar, 300));
}

console.log('per bron:', JSON.stringify(tel, null, 1));
const uitMap = path.join(__dirname, '..', 'tmp', 'notubiz-proef');
fs.mkdirSync(uitMap, { recursive: true });
const bestand = path.join(uitMap, `rechtspraak-inhaalslag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(bestand, JSON.stringify({ apply: APPLY, tel, verslag }, null, 1));
console.log(`verslag: ${bestand}`);
if (!APPLY) console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.');
