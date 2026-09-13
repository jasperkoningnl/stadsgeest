const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { calculateMetrics, evidenceHash, POLICY_VERSION } = require('./src/phase5-core.cjs');

function monthWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), reviewMonth: start.toISOString().slice(0, 7) };
}

function parseOptions(argv, now = new Date()) {
  const rolling = argv.find(arg => arg.startsWith('--rolling-days='));
  if (!rolling) return { ...monthWindow(now), scheduled: argv.includes('--scheduled') };
  const days = Number(rolling.split('=')[1]);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('--rolling-days moet tussen 1 en 366 liggen.');
  // Een rolling evaluatie heeft dagvaste grenzen. Daardoor levert een
  // identieke herhaalrun zonder nieuwe feedback exact dezelfde inputhash op.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * 86400000);
  return { start: start.toISOString(), end: end.toISOString(), reviewMonth: null, scheduled: false };
}

async function runEvaluation(db, options) {
  if (options.reviewMonth) {
    const current = (await db.execute({ sql: 'SELECT status FROM phase5_review_cycles WHERE review_month=?', args: [options.reviewMonth] })).rows[0];
    if (options.scheduled && current?.status === 'closed') return { skipped: 'review_closed', reviewMonth: options.reviewMonth };
  }
  const feedback = (await db.execute({
    sql: `SELECT id,tip_id,gebruiker,actie,reden_code,reden_tekst,created_at,verdict,dimension,duplicate_of
          FROM tip_feedback WHERE created_at>=? AND created_at<? ORDER BY created_at,id`, args: [options.start, options.end],
  })).rows.map(row => ({ ...row, id: Number(row.id), tip_id: Number(row.tip_id) }));
  const contextsByFeedbackId = new Map();
  if (feedback.length) {
    const ids = feedback.map(row => row.id);
    const contexts = (await db.execute({
      sql: `SELECT feedback_id,context_json,context_hash FROM editorial_feedback_contexts
            WHERE feedback_id IN (${ids.map(() => '?').join(',')})`, args: ids,
    })).rows;
    for (const row of contexts) contextsByFeedbackId.set(Number(row.feedback_id), JSON.parse(row.context_json));
  }
  const outcomes = (await db.execute({
    sql: `SELECT DISTINCT eo.id,eo.normalized_url,eo.without_stadsgeest,eo.status
          FROM editorial_outcomes eo JOIN tip_outcomes tpo ON tpo.outcome_id=eo.id
          WHERE tpo.active=1 AND eo.first_recorded_at<?`, args: [options.end],
  })).rows;
  const signalRows = (await db.execute({
    sql: `SELECT COUNT(*) total,
          SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM tip_signals ts WHERE ts.signal_id=s.id) THEN 1 ELSE 0 END) unused
          FROM signals s WHERE s.created_at>=? AND s.created_at<?`, args: [options.start, options.end],
  })).rows[0] || {};
  const cycles = Number((await db.execute("SELECT COUNT(*) n FROM phase5_review_cycles WHERE status IN ('reviewed','closed')")).rows[0]?.n || 0);
  const input = { start: options.start, end: options.end, feedback, contexts: [...contextsByFeedbackId], outcomes, signalSummary: signalRows };
  const metrics = calculateMetrics({ feedbackRows: feedback, contextsByFeedbackId, outcomes, signalSummary: signalRows, monthlyCycles: cycles });
  const inputHash = evidenceHash(input);
  const evidenceStatus = metrics.overall.assessed < metrics.minimums.reporting ? 'insufficient'
    : metrics.overall.assessed < metrics.minimums.manualCalibration ? 'descriptive' : 'eligible_for_manual_review';
  await db.execute({
    sql: `INSERT OR IGNORE INTO phase5_evaluations(period_start,period_end,input_hash,evaluator_version,sample_size,evidence_status,metrics_json,evidence_json)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [options.start,options.end,inputHash,POLICY_VERSION,metrics.overall.assessed,evidenceStatus,JSON.stringify(metrics),JSON.stringify({ inputHash, feedbackIds: feedback.map(row => row.id), contextCount: contextsByFeedbackId.size })],
  });
  const evaluation = (await db.execute({ sql: 'SELECT id FROM phase5_evaluations WHERE input_hash=?', args: [inputHash] })).rows[0];
  if (options.reviewMonth) {
    await db.execute({
      sql: `INSERT INTO phase5_review_cycles(review_month,evaluation_id,status) VALUES (?,?,'open')
            ON CONFLICT(review_month) DO UPDATE SET evaluation_id=CASE WHEN status='closed' THEN evaluation_id ELSE excluded.evaluation_id END,
              updated_at=datetime('now')`, args: [options.reviewMonth,evaluation.id],
    });
  }
  return { evaluationId: Number(evaluation.id), inputHash, evidenceStatus, reviewMonth: options.reviewMonth, metrics };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try { console.log(JSON.stringify(await runEvaluation(db, options), null, 2)); }
  finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, monthWindow, parseOptions, runEvaluation };
