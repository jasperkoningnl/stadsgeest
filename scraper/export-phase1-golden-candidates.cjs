const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const rows = (await db.execute(`SELECT ke.id expectedEntityId,ke.canonical_name expectedName,
      ei.identifier_type,ei.value,ei.source_url
      FROM entity_identifiers ei JOIN kg_entities ke ON ke.id=ei.entity_id
      WHERE ke.entity_type='organization' AND ke.merged_into_id IS NULL
      AND ei.identifier_type IN ('kvk','lei','rsin','website')
      AND ei.source_url LIKE 'https://%'
      ORDER BY CASE ei.identifier_type WHEN 'kvk' THEN 0 WHEN 'lei' THEN 1 WHEN 'rsin' THEN 2 ELSE 3 END,ke.id
      LIMIT 250`)).rows;
    const candidates = rows.map(row => ({
      expectedEntityId: Number(row.expectedEntityId),
      expectedName: String(row.expectedName),
      candidate: {
        name: String(row.expectedName), entityType: 'organization',
        identifiers: row.identifier_type === 'website' ? [] : [{ type: String(row.identifier_type), value: String(row.value) }],
        website: row.identifier_type === 'website' ? String(row.value) : undefined,
      },
      label: null,
      reviewedBy: null,
      reviewedAt: null,
      evidenceUrl: String(row.source_url),
    }));
    console.log(JSON.stringify(candidates, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
