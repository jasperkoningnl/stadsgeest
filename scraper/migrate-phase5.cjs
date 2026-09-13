const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { canonicalizeArticleUrl, classifyFeedback, evidenceHash, POLICY_VERSION } = require('./src/phase5-core.cjs');

async function tableColumns(db, table) {
  return new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => String(row.name)));
}

async function addColumn(db, table, columns, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!columns.has(name)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    columns.add(name);
  }
}

async function captureContext(db, feedbackId, tipId) {
  const signals = (await db.execute({
    sql: `SELECT ts.signal_id, ts.rol, s.title, s.detection_rule, s.provenance
          FROM tip_signals ts JOIN signals s ON s.id=ts.signal_id WHERE ts.tip_id=? ORDER BY ts.signal_id`,
    args: [tipId],
  })).rows;
  const output = [];
  for (const signal of signals) {
    const sources = (await db.execute({
      sql: `SELECT DISTINCT src.id,src.name,src.bronrol AS role
            FROM signal_items si JOIN raw_items ri ON ri.id=si.raw_item_id JOIN sources src ON src.id=ri.source_id
            WHERE si.signal_id=? ORDER BY src.id`, args: [signal.signal_id],
    })).rows;
    const entities = (await db.execute({
      sql: `SELECT DISTINCT ke.id,ke.canonical_name AS name,ke.entity_type AS type
            FROM kg_events ev JOIN event_entities ee ON ee.event_id=ev.id JOIN kg_entities ke ON ke.id=ee.entity_id
            WHERE ev.id=json_extract(?, '$.event_id') ORDER BY ke.id`, args: [signal.provenance || '{}'],
    })).rows;
    output.push({ id: Number(signal.signal_id), role: signal.rol, title: signal.title, rule: signal.detection_rule || null, sources, entities });
  }
  const context = { schemaVersion: POLICY_VERSION, tipId: Number(tipId), signals: output };
  await db.execute({
    sql: `INSERT OR IGNORE INTO editorial_feedback_contexts(feedback_id,tip_id,context_json,context_hash)
          VALUES (?,?,?,?)`, args: [feedbackId, tipId, JSON.stringify(context), evidenceHash(context)],
  });
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const feedbackColumns = await tableColumns(db, 'tip_feedback');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'request_id TEXT');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'verdict TEXT');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'dimension TEXT');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'feedback_schema_version TEXT');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'target_signal_id INTEGER');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'target_source_id INTEGER');
    await addColumn(db, 'tip_feedback', feedbackColumns, 'duplicate_of INTEGER');
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_feedback_request ON tip_feedback(request_id) WHERE request_id IS NOT NULL');

    await db.execute(`CREATE TABLE IF NOT EXISTS editorial_feedback_contexts (
      feedback_id INTEGER PRIMARY KEY REFERENCES tip_feedback(id), tip_id INTEGER NOT NULL REFERENCES tips(id),
      context_json TEXT NOT NULL, context_hash TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_feedback_context_tip ON editorial_feedback_contexts(tip_id)');
    await db.execute(`CREATE TABLE IF NOT EXISTS editorial_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, normalized_url TEXT NOT NULL UNIQUE, article_url TEXT NOT NULL,
      without_stadsgeest INTEGER NOT NULL CHECK(without_stadsgeest IN (0,1)), status TEXT NOT NULL DEFAULT 'published'
        CHECK(status IN ('published','retracted')), created_by TEXT NOT NULL,
      first_recorded_at TEXT NOT NULL DEFAULT (datetime('now')), last_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS tip_outcomes (
      tip_id INTEGER PRIMARY KEY REFERENCES tips(id), outcome_id INTEGER NOT NULL REFERENCES editorial_outcomes(id),
      contribution TEXT NOT NULL DEFAULT 'primary' CHECK(contribution IN ('primary','supporting')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), linked_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute('CREATE INDEX IF NOT EXISTS idx_tip_outcomes_outcome ON tip_outcomes(outcome_id,active)');
    await db.execute(`CREATE TABLE IF NOT EXISTS editorial_outcome_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, outcome_id INTEGER REFERENCES editorial_outcomes(id), tip_id INTEGER NOT NULL REFERENCES tips(id),
      request_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, event_type TEXT NOT NULL
        CHECK(event_type IN ('published','linked','unlinked','corrected','not_used')),
      payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS phase5_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      input_hash TEXT NOT NULL UNIQUE, evaluator_version TEXT NOT NULL, sample_size INTEGER NOT NULL,
      evidence_status TEXT NOT NULL CHECK(evidence_status IN ('insufficient','descriptive','eligible_for_manual_review')),
      metrics_json TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS phase5_review_cycles (
      review_month TEXT PRIMARY KEY, evaluation_id INTEGER REFERENCES phase5_evaluations(id), status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','reviewed','closed')), notes TEXT, decided_by TEXT, decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS phase5_review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, review_month TEXT NOT NULL REFERENCES phase5_review_cycles(review_month),
      request_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('reviewed','reopened','closed')),
      payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS phase5_calibration_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target_kind TEXT NOT NULL CHECK(target_kind IN ('source','rule','ranking')),
      target_key TEXT NOT NULL, metric_name TEXT NOT NULL, sample_size INTEGER NOT NULL, minimum_sample INTEGER NOT NULL,
      monthly_cycles INTEGER NOT NULL DEFAULT 0, evidence_hash TEXT NOT NULL, proposal_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','approved','rejected','applied')),
      approved_by TEXT, approved_at TEXT, applied_by TEXT, applied_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS phase5_retention_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cutoff_at TEXT NOT NULL, notes_redacted INTEGER NOT NULL DEFAULT 0,
      identities_anonymized INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    const feedback = (await db.execute('SELECT id,tip_id,gebruiker,actie,reden_code,reden_tekst,created_at,verdict,dimension,duplicate_of FROM tip_feedback ORDER BY id')).rows;
    const fingerprint = new Map();
    for (const row of feedback) {
      const key = [row.tip_id,row.gebruiker,row.actie,row.reden_code || '',row.reden_tekst || '',row.created_at].join('|');
      const duplicateOf = fingerprint.get(key) || null;
      if (!duplicateOf) fingerprint.set(key, Number(row.id));
      const classified = classifyFeedback(row.actie, row.reden_code);
      await db.execute({
        sql: `UPDATE tip_feedback SET verdict=COALESCE(verdict,?),dimension=COALESCE(dimension,?),
              feedback_schema_version=COALESCE(feedback_schema_version,?),duplicate_of=COALESCE(duplicate_of,?) WHERE id=?`,
        args: [classified.verdict, classified.dimension, POLICY_VERSION, duplicateOf, row.id],
      });
      await captureContext(db, Number(row.id), Number(row.tip_id));
    }

    const published = (await db.execute(`SELECT id,artikel_url,eigen_vondst,actor FROM tips
      WHERE status='gepubliceerd' AND artikel_url IS NOT NULL AND eigen_vondst IN (0,1)`)).rows;
    for (const tip of published) {
      const normalized = canonicalizeArticleUrl(tip.artikel_url);
      await db.execute({ sql: `INSERT OR IGNORE INTO editorial_outcomes(normalized_url,article_url,without_stadsgeest,created_by)
        VALUES (?,?,?,?)`, args: [normalized, tip.artikel_url, tip.eigen_vondst, tip.actor || 'legacy'] });
      const outcome = (await db.execute({ sql: 'SELECT id FROM editorial_outcomes WHERE normalized_url=?', args: [normalized] })).rows[0];
      await db.execute({ sql: `INSERT OR IGNORE INTO tip_outcomes(tip_id,outcome_id) VALUES (?,?)`, args: [tip.id,outcome.id] });
    }
    console.log(JSON.stringify({ migrated: true, feedback: feedback.length, publishedOutcomes: published.length }, null, 2));
  } finally { db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { captureContext, main };
