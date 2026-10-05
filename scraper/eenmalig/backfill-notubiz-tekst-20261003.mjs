// Eenmalige inhaalslag (3 oktober 2026): raadsstukken van Notubiz zonder tekst
// alsnog ophalen via api.notubiz.nl.
//
// De opgeslagen URL's op amersfoort.notubiz.nl geven een gewone fetch HTTP 403
// (Cloudflare), waardoor fetch-fulltext.js deze stukken als mislukt afvinkte.
// De nachtjob gebruikt sinds vandaag de pdf-route en zou de achterstand binnen
// een week zelf inlopen; dit script doet dat in één keer en telt wat het vindt.
// Zie docs/HANDOFFS/2026-W40.md.
//
// Stukken die al een signaal hebben krijgen alleen tekst; er ontstaan geen
// nieuwe signalen. entities_scanned_at gaat leeg, zodat de entiteitenscan de
// nieuwe tekst leest. Mislukte stukken blijven ongemoeid: de nachtjob probeert
// ze later opnieuw, ook via Open Raadsinformatie.
//
// Gebruik (vanuit scraper/):
//   node backfill-notubiz-tekst-20261003.mjs                    droog: haalt op, schrijft niets
//   node backfill-notubiz-tekst-20261003.mjs --apply            schrijft de tekst weg
//   opties: --limit 10   --bron 119   --met-modules (ook ingekomen stukken zonder documentlink)
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haalNotubizTekst, notubizDocumentParts } from '../src/notubiz-fulltext.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i > -1 ? process.argv[i + 1] : std; };
const APPLY = process.argv.includes('--apply');
const MET_MODULES = process.argv.includes('--met-modules');
const LIMIT = Number(arg('--limit', '0'));
const BRONNEN = arg('--bron', '115,116,117,118,119,120').split(',').map(Number).filter(Boolean);
const MAX_FULLTEXT = 200000; // gelijk aan fetch-fulltext.js

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const res = await db.execute({
  sql: `SELECT id, source_id, external_url, title FROM raw_items
        WHERE source_id IN (${BRONNEN.map(() => '?').join(',')})
          AND full_text IS NULL AND external_url LIKE '%notubiz.nl/%'
        ORDER BY id DESC`,
  args: BRONNEN,
});
let werk = res.rows.filter((r) => MET_MODULES || notubizDocumentParts(String(r.external_url)));
if (LIMIT) werk = werk.slice(0, LIMIT);
console.log(`${res.rows.length} stukken zonder tekst in bron ${BRONNEN.join(', ')}; ${werk.length} in deze run (${APPLY ? 'SCHRIJFT' : 'droog'}).`);

const tel = {};
const telOp = (bron, sleutel, n = 1) => { tel[bron] ??= {}; tel[bron][sleutel] = (tel[bron][sleutel] || 0) + n; };
const verslag = [];
for (const r of werk) {
  const uit = await haalNotubizTekst(String(r.external_url));
  const soort = uit.text ? 'ok' : uit.reason.startsWith('pdf zonder tekstlaag') ? 'scan' : uit.reason;
  telOp(r.source_id, soort);
  if (uit.documenten.length > 1) telOp(r.source_id, 'met_bijlagen');
  const scans = uit.documenten.filter((d) => d.status === 'scan').length;
  if (scans) telOp(r.source_id, 'scandocumenten', scans);
  if (uit.text) {
    telOp(r.source_id, 'tekens', uit.text.length);
    if (uit.text.length > MAX_FULLTEXT) telOp(r.source_id, 'afgekapt');
    if (APPLY) {
      const w = await db.execute({
        sql: `UPDATE raw_items SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL
              WHERE id = ? AND full_text IS NULL`,
        args: [uit.text.substring(0, MAX_FULLTEXT), new Date().toISOString(), r.id],
      });
      telOp(r.source_id, 'geschreven', w.rowsAffected);
    }
  } else {
    console.log(`  geen tekst #${r.id} bron ${r.source_id} (${uit.reason}): ${String(r.title).slice(0, 70)}`);
  }
  verslag.push({ id: Number(r.id), bron: Number(r.source_id), soort, tekens: uit.text?.length || 0, documenten: uit.documenten });
  await new Promise((klaar) => setTimeout(klaar, 600));
}

console.log('per bron:', JSON.stringify(tel, null, 1));
const uitMap = path.join(__dirname, '..', 'tmp', 'notubiz-proef');
fs.mkdirSync(uitMap, { recursive: true });
const bestand = path.join(uitMap, `inhaalslag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(bestand, JSON.stringify({ apply: APPLY, tel, verslag }, null, 1));
console.log(`verslag: ${bestand}`);
if (!APPLY) console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.');
