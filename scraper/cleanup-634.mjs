/**
 * Eenmalige schoonmaakactie: signaal #634 opschonen.
 * Gebruikt de HTTP API rechtstreeks (geen @libsql/client nodig).
 * Draai: node cleanup-634.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const TURSO_URL = process.env.TURSO_URL.replace('libsql://', 'https://');
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

async function query(sql) {
  const resp = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  });
  const data = await resp.json();
  return data.results[0];
}

async function main() {
  const before = await query('SELECT COUNT(*) as n FROM signal_items WHERE signal_id = 634');
  console.log(`Signal_items vóór opschoning: ${before.response.result.rows[0][0].value}`);

  const del = await query('DELETE FROM signal_items WHERE signal_id = 634 AND raw_item_id != 2083');
  console.log(`Verwijderd: ${del.response.result.affected_row_count} signal_items`);

  await query('UPDATE signals SET confirmations = 1 WHERE id = 634');
  console.log('Confirmations gezet op 1');

  await query("INSERT INTO signal_events (signal_id, event_type, actor, details) VALUES (634, 'cleanup', 'opruimscript', 'Schoonmaakactie bevinding #6: ongerelateerde signal_items verwijderd. Alleen coffeeshopbeleid-item #2083 behouden.')");
  console.log('Signal_event geschreven');

  const after = await query('SELECT COUNT(*) as n FROM signal_items WHERE signal_id = 634');
  console.log(`Signal_items na opschoning: ${after.response.result.rows[0][0].value}`);

  const sig = await query('SELECT confirmations FROM signals WHERE id = 634');
  console.log(`Confirmations: ${sig.response.result.rows[0][0].value}`);
}

main().catch(e => { console.error('FOUT:', e.message); process.exitCode = 1; });
