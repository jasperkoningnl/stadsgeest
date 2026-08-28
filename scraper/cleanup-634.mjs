/**
 * Eenmalige schoonmaakactie: signaal #634 opschonen.
 * Verwijdert 67 ongerelateerde signal_items (B&W-besluitenlijsten, raadsinformatie, etc.).
 * Houdt alleen item #2083 (het oorspronkelijke coffeeshopbeleid-uitspraak).
 *
 * Draai: node cleanup-634.mjs
 */
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // Tel huidige items
  const before = await db.execute('SELECT COUNT(*) as n FROM signal_items WHERE signal_id = 634');
  console.log(`Signal_items vóór opschoning: ${before.rows[0].n}`);

  // Verwijder alle signal_items behalve item 2083
  const del = await db.execute('DELETE FROM signal_items WHERE signal_id = 634 AND raw_item_id != 2083');
  console.log(`Verwijderd: ${del.rowsAffected} signal_items`);

  // Zet confirmations op 1
  await db.execute('UPDATE signals SET confirmations = 1 WHERE id = 634');
  console.log('Confirmations gezet op 1');

  // Schrijf een signal_event
  await db.execute({
    sql: `INSERT INTO signal_events (signal_id, event_type, actor, details)
          VALUES (634, 'cleanup', 'opruimscript',
          'Schoonmaakactie bevinding #6: 67 ongerelateerde signal_items verwijderd (B&W-besluitenlijsten, raadsinformatie, verkeersbesluiten). Alleen het oorspronkelijke coffeeshopbeleid-item (#2083) behouden.')`,
    args: [],
  });
  console.log('Signal_event geschreven');

  // Controleer
  const after = await db.execute('SELECT COUNT(*) as n FROM signal_items WHERE signal_id = 634');
  console.log(`Signal_items na opschoning: ${after.rows[0].n}`);

  const sig = await db.execute('SELECT confirmations FROM signals WHERE id = 634');
  console.log(`Confirmations: ${sig.rows[0].confirmations}`);
}

main().catch(e => { console.error('FOUT:', e.message); process.exitCode = 1; });
