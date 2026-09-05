// Eenmalig backfill-script: maak kg_events aan voor bestaande raw_items van eerlijk-werk
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

(async () => {
  const items = await db.execute(
    'SELECT id, external_url, title, content, summary, published_at FROM raw_items WHERE source_id = 133'
  );
  console.log('Te verwerken:', items.rows.length);

  let ok = 0, skip = 0, err = 0;

  for (const row of items.rows) {
    try {
      const data = JSON.parse(row.content);
      const eventType = data.heeftOvertreding ? 'INSPECTION_VIOLATION' : 'INSPECTION_CLEAR';

      await db.execute({
        sql: `INSERT INTO kg_events (event_type, source_id, source_url, source_identifier,
                title, summary, occurred_at, fetched_at, provenance)
              VALUES (?, 133, ?, ?, ?, ?, ?, datetime('now'), ?)`,
        args: [
          eventType,
          row.external_url,
          data.externalId,
          'Inspectie ' + data.bedrijfsnaam,
          row.summary,
          data.inspectiedatum,
          row.content,
        ],
      });
      ok++;
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        skip++;
      } else {
        console.error('Fout:', e.message);
        err++;
      }
    }
  }

  console.log(`Klaar: ${ok} aangemaakt, ${skip} al aanwezig, ${err} fouten`);
})();
