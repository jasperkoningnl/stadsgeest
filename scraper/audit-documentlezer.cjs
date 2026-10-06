#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { loadDocumentUittreksels } = require('./src/weger-workset.cjs');

async function audit(db, signalId = null) {
  const tabel = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='document_uittreksels'")).rows;
  if (!tabel.length) throw new Error('document_uittreksels ontbreekt');
  const plan = (await db.execute({ sql: `EXPLAIN QUERY PLAN
    SELECT u.id,u.kern,u.feiten FROM document_uittreksels u
    WHERE u.raw_item_id=? ORDER BY u.id DESC LIMIT 1`, args: [1] })).rows;
  const detail = plan.map((r) => String(r.detail || ''));
  if (!detail.some((regel) => /SEARCH u USING INDEX idx_document_uittreksels_item/i.test(regel))) {
    throw new Error(`onveilig queryplan: ${detail.join(' | ')}`);
  }
  const koppelPlan = (await db.execute({ sql: `EXPLAIN QUERY PLAN
    SELECT signal_id FROM signal_items WHERE raw_item_id=?`, args: [1] })).rows.map((r) => String(r.detail || ''));
  if (!koppelPlan.some((regel) => /idx_signal_items_raw_item/i.test(regel))) {
    throw new Error(`onveilig koppelplan: ${koppelPlan.join(' | ')}`);
  }
  const rijen = Number((await db.execute('SELECT COUNT(*) AS n FROM document_uittreksels')).rows[0].n);
  const werkset = signalId ? await loadDocumentUittreksels(db, signalId) : [];
  return {
    tabel: true, rijen, queryplan: detail, koppelplan: koppelPlan,
    werkset: signalId ? { signal_id: signalId, uittreksels: werkset.length, feiten: werkset.reduce((n, u) => n + u.feiten.length, 0) } : null,
  };
}

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const i = process.argv.indexOf('--signal');
  const signalId = i >= 0 ? Number(process.argv[i + 1]) : null;
  try { console.log(JSON.stringify(await audit(db, signalId), null, 2)); } finally { db.close(); }
}

module.exports = { audit };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
