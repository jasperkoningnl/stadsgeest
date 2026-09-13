const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { evidenceHash, MINIMUMS } = require('./src/phase5-core.cjs');
const { RULE_IDENTITIES } = require('./src/kg/detection-rules.cjs');

const FIXED_RULES = Object.freeze({
  R5: 'Robuuste anomalie geregistreerde misdrijven', R10: 'Multi-source versterking',
  R11: 'Opvallende ontwikkeling leerlingaantal', R12: 'Opvallende ontwikkeling schoolprognose',
  R13: 'Betekenisvolle wijziging Onderwijsinspectie', R14: 'Grote lokale verkeersmaatregel',
});

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    for (const [id, name] of Object.entries(FIXED_RULES)) {
      if (RULE_IDENTITIES[id] !== name) throw new Error(`${id} heeft onverwachte betekenis: ${RULE_IDENTITIES[id]}`);
    }
    const required = ['editorial_feedback_contexts','editorial_outcomes','tip_outcomes','editorial_outcome_events','phase5_evaluations','phase5_review_cycles','phase5_review_events','phase5_calibration_proposals','phase5_retention_runs'];
    const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row => String(row.name)));
    for (const table of required) if (!tables.has(table)) throw new Error(`Productietabel ontbreekt: ${table}`);
    const orphanFeedback = Number((await db.execute(`SELECT COUNT(*) n FROM tip_feedback tf LEFT JOIN editorial_feedback_contexts c ON c.feedback_id=tf.id
      WHERE c.feedback_id IS NULL`)).rows[0].n);
    if (orphanFeedback) throw new Error(`${orphanFeedback} feedbackregels missen een bevroren attributiecontext`);
    const contexts = (await db.execute('SELECT feedback_id,context_json,context_hash FROM editorial_feedback_contexts')).rows;
    const invalidContextHashes = contexts.filter(row => {
      try { return evidenceHash(JSON.parse(String(row.context_json))) !== String(row.context_hash); }
      catch { return true; }
    }).length;
    if (invalidContextHashes) throw new Error(`${invalidContextHashes} feedbackcontexten hebben een ongeldige bewijs-hash`);
    const invalidApplied = Number((await db.execute(`SELECT COUNT(*) n FROM phase5_calibration_proposals WHERE status='applied'
      AND (sample_size<minimum_sample OR monthly_cycles<? OR approved_by IS NULL OR approved_at IS NULL)` , [MINIMUMS.monthlyCyclesForChange])).rows[0].n);
    if (invalidApplied) throw new Error(`${invalidApplied} kalibratiewijzigingen zijn zonder voldoende bewijs/goedkeuring toegepast`);
    const outcomes = (await db.execute(`SELECT COUNT(*) total,COUNT(DISTINCT normalized_url) unique_urls,
      SUM(CASE WHEN without_stadsgeest NOT IN (0,1) THEN 1 ELSE 0 END) missing FROM editorial_outcomes WHERE status='published'`)).rows[0];
    if (Number(outcomes.total) !== Number(outcomes.unique_urls) || Number(outcomes.missing)) throw new Error('Artikeluitkomsten zijn dubbel of onvolledig');
    const latest = (await db.execute(`SELECT id,period_start,period_end,sample_size,evidence_status,input_hash FROM phase5_evaluations ORDER BY id DESC LIMIT 1`)).rows[0] || null;
    console.log(JSON.stringify({ schema: 'ok', ruleIdentities: FIXED_RULES, orphanFeedback, invalidContextHashes, invalidApplied,
      outcomes: { published: Number(outcomes.total), unique: Number(outcomes.unique_urls), missing: Number(outcomes.missing) }, latestEvaluation: latest }, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
