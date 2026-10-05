// Eenmalig (3 oktober 2026): signalen die op alleen een titel zijn gewogen,
// opnieuw aanbieden aan de weger nu de volledige tekst er is.
//
// De inhaalslagen van vandaag gaven raadsstukken (Notubiz) en uitspraken
// (Rechtspraak) hun tekst. De weger pakt een signaal opnieuw op als last_seen_at
// nieuwer is dan zijn laatste oordeel en de status new of watching is. Dit
// script zet last_seen_at op nu, zet een weggezet signaal terug op watching en
// legt de reden vast in signal_events. Signalen met een tip blijven ongemoeid.
// Afgesproken met Jasper: alleen stukken die sinds 1 september zijn gescrapet.
//
// Gebruik (vanuit scraper/), droog tenzij --apply:
//   node heraanbieden-na-tekst-20261003.mjs --bron 115,116,118,119 --opgehaald-vanaf 2026-10-03T17:40 --actor inhaalslag-notubiz
//   node heraanbieden-na-tekst-20261003.mjs --bron 17 --opgehaald-vanaf 2026-10-03T19:20 --actor inhaalslag-rechtspraak
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const arg = (naam, std) => { const i = process.argv.indexOf(naam); return i > -1 ? process.argv[i + 1] : std; };
const APPLY = process.argv.includes('--apply');
const BRONNEN = String(arg('--bron', '')).split(',').map(Number).filter(Boolean);
const OPGEHAALD = arg('--opgehaald-vanaf', '');
const GESCRAPET = arg('--gescrapet-vanaf', '2026-09-01');
const ACTOR = arg('--actor', '');
if (!BRONNEN.length || !OPGEHAALD || !ACTOR) {
  console.error('Verplicht: --bron <ids> --opgehaald-vanaf <iso-tijd> --actor <naam>');
  process.exit(1);
}
const REDEN = 'Volledige tekst van het stuk alsnog opgehaald (inhaalslag 3 oktober); eerder alleen op titel of metadata gewogen. Opnieuw aangeboden aan de weger.';

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const res = await db.execute({
  sql: `SELECT DISTINCT s.id, s.status, substr(s.title, 1, 70) AS titel
        FROM raw_items r
        JOIN signal_items si ON si.raw_item_id = r.id
        JOIN signals s ON s.id = si.signal_id
        WHERE r.source_id IN (${BRONNEN.map(() => '?').join(',')})
          AND r.fulltext_fetched_at >= ? AND r.full_text IS NOT NULL
          AND r.scraped_at >= ?
          AND s.status IN ('new', 'watching', 'discarded')
          AND NOT EXISTS (SELECT 1 FROM tip_signals ts WHERE ts.signal_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM signal_events e WHERE e.signal_id = s.id AND e.actor = ?)
        ORDER BY s.id`,
  args: [...BRONNEN, OPGEHAALD, GESCRAPET, ACTOR],
});

const perStatus = {};
for (const s of res.rows) perStatus[s.status] = (perStatus[s.status] || 0) + 1;
console.log(`${res.rows.length} signalen opnieuw aanbieden:`, JSON.stringify(perStatus));
for (const s of res.rows.slice(0, 8)) console.log(`  #${s.id} (${s.status}) ${s.titel}`);
if (!APPLY) { console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.'); process.exit(0); }

let gedaan = 0;
for (const s of res.rows) {
  const naar = s.status === 'discarded' ? 'watching' : s.status;
  await db.batch([
    { sql: "UPDATE signals SET last_seen_at = datetime('now'), status = ? WHERE id = ?", args: [naar, s.id] },
    { sql: `INSERT INTO signal_events (signal_id, actor, event_type, status_from, status_to, reason)
            VALUES (?, ?, 'reoffered', ?, ?, ?)`, args: [s.id, ACTOR, s.status, naar, REDEN] },
  ], 'write');
  gedaan++;
}
console.log(`${gedaan} signalen bijgewerkt.`);
