const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const cutoff = (await db.execute("SELECT datetime('now','-24 months') cutoff")).rows[0].cutoff;
    const tipCount = Number((await db.execute({ sql: `SELECT COUNT(*) n FROM tip_feedback WHERE created_at<? AND (reden_tekst IS NOT NULL OR gebruiker<>'redactie')`, args: [cutoff] })).rows[0].n);
    const dashboardCount = Number((await db.execute({ sql: `SELECT COUNT(*) n FROM dashboard_feedback WHERE created_at<? AND (tekst IS NOT NULL OR gebruiker<>'redactie')`, args: [cutoff] })).rows[0].n);
    if (apply && (tipCount || dashboardCount)) {
      const tx = await db.transaction('write');
      try {
        await tx.execute({ sql: `UPDATE tip_feedback SET reden_tekst=NULL,gebruiker='redactie' WHERE created_at<?`, args: [cutoff] });
        await tx.execute({ sql: `UPDATE dashboard_feedback SET tekst='[verwijderd na bewaartermijn]',gebruiker='redactie' WHERE created_at<?`, args: [cutoff] });
        await tx.execute({ sql: `INSERT INTO phase5_retention_runs(cutoff_at,notes_redacted,identities_anonymized,status) VALUES (?,?,?,'ok')`, args: [cutoff,tipCount+dashboardCount,tipCount+dashboardCount] });
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', cutoff, tipFeedbackDue: tipCount, dashboardFeedbackDue: dashboardCount }, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
