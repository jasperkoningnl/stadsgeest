const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

const REQUIRED_SOURCES = [
  'Jaarverantwoording Zorg — openbare datasets',
  'Woningcorporaties — dPi',
  'Tijd voor Amersfoort — volledige UITagenda',
  'Gemeente Amersfoort — evenementenkalender',
  'Rijksmonumentenregister — Extract_MRS',
  'SEVESO+ — inrichtingenlijst',
  'Openbare governancepagina’s — lokale ankerorganisaties',
  'RIVM Samen Meten — experimenteel',
];

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const report = [];
    for (const name of REQUIRED_SOURCES) {
      const source = (await db.execute({ sql: `SELECT id,url,source_class,adapter_version,source_manifest,last_verified_at,terms_checked_at FROM sources WHERE name=?`, args: [name] })).rows[0];
      if (!source) throw new Error(`Productiebron ontbreekt: ${name}`);
      const manifest = JSON.parse(source.source_manifest || '{}');
      for (const field of ['owner', 'license', 'identity', 'local_filter', 'semantic_fields']) if (!manifest[field]) throw new Error(`${name}: manifestveld ${field} ontbreekt`);
      const baseline = Number((await db.execute({ sql: `SELECT COUNT(*) count FROM source_records WHERE source_id=? AND source_key='__baseline_complete__'`, args: [source.id] })).rows[0].count);
      const runs = (await db.execute({ sql: `SELECT status,records_found,records_new,records_changed,records_removed,error_message,finished_at FROM fetch_runs WHERE source_id=? ORDER BY id DESC LIMIT 2`, args: [source.id] })).rows;
      if (!baseline || runs.length < 2 || runs.some(run => run.status !== 'ok')) throw new Error(`${name}: baseline of twee geslaagde productieruns ontbreken`);
      const latest = runs[0]; if (Number(latest.records_new) || Number(latest.records_changed) || Number(latest.records_removed)) throw new Error(`${name}: herhaalrun was niet idempotent`);
      report.push({ name, class: source.source_class, baseline: true, repeat: latest.finished_at, unchanged: true });
      const details = { adapterVersion: source.adapter_version, lastVerifiedAt: source.last_verified_at, termsCheckedAt: source.terms_checked_at,
        runs: runs.map(run => ({ status: run.status, found: Number(run.records_found), added: Number(run.records_new), changed: Number(run.records_changed), removed: Number(run.records_removed), finishedAt: run.finished_at })) };
      await db.execute({ sql: `INSERT INTO phase4_source_audits(source_name,checked_at,official_url,terms_status,route_status,local_count,national_count,details_json)
        VALUES (?,date('now'),?,'checked','ok',?,NULL,?) ON CONFLICT(source_name,checked_at) DO UPDATE SET route_status='ok',local_count=excluded.local_count,details_json=excluded.details_json`,
        args: [name, source.url, Number(latest.records_found), JSON.stringify(details)] });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { REQUIRED_SOURCES };
