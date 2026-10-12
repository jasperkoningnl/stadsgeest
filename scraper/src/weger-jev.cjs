'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { hash } = require('./jev-experiment-lib.cjs');
const lib = require('./jev-followup-lib.cjs');
const DEFAULT_DIR = path.join(__dirname, '..', 'tmp', 'jev-experiment', 'followup');
const linked = label => ['same_case', 'same_dossier', 'related_dossiers'].includes(label);
function sourceHash(title, body) {
  return crypto.createHash('sha256').update(`${title || ''}\n${body || ''}`).digest('hex');
}

// Alleen de bevroren, gecontroleerde pilot; geen API-verzoeken of productie-writes.
function readPilot(dir = DEFAULT_DIR) {
  const names = ['dataset.json', 'references.json', 'ledger.json'];
  if (!names.some(n => fs.existsSync(path.join(dir, n)))) return { status: 'missing', proposals: [] };
  try {
    const [data, refs, ledger] = names.map(n => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
    if (data.version !== lib.VERSION || !Array.isArray(data.pairs) || data.pairs.length > 50
      || hash(data.pairs) !== data.dataset_hash || refs.dataset_hash !== data.dataset_hash
      || hash(refs.reviews) !== refs.reference_hash || refs.reviewer_type !== 'ai'
      || refs.user_accepted_reference_basis !== true || refs.frozen_before_api !== true
      || refs.reviews.length !== data.pairs.length
      || new Set(data.pairs.map(p => p.id)).size !== data.pairs.length
      || new Set(refs.reviews.map(r => r.pair_id)).size !== data.pairs.length) throw new Error('hash/review');
    const proposals = [];
    for (const pair of data.pairs) {
      const ref = refs.reviews.find(r => r.pair_id === pair.id);
      const entries = ledger.entries.filter(e => e.pair_id === pair.id && e.mode === 'selected' && e.status === 'ok');
      if (!ref || ref.reviewer_type !== 'ai' || ref.reviewer !== 'Codex' || !ref.note
        || !Object.hasOwn(lib.RELATIONS, ref.label) || !Object.hasOwn(lib.DOCUMENTS, ref.document)
        || entries.length !== 1) throw new Error('review/answer');
      const e = entries[0], request = lib.requestFor(pair);
      if (e.dataset_hash !== data.dataset_hash || e.reference_hash !== refs.reference_hash
        || hash(e.request) !== e.request_hash || hash(request) !== e.request_hash
        || !Number.isFinite(Date.parse(ref.reviewed_at)) || Date.parse(ref.reviewed_at) >= Date.parse(e.started_at)
        || !Number.isFinite(Date.parse(e.started_at))) throw new Error('request');
      const result = lib.validate({ model: e.result.model, answers: e.result.answers, usage: { input_tokens: e.result.input_tokens } });
      const proposal = lib.propose(pair, result);
      for (const d of [pair.a, pair.b]) {
        if (!Number.isSafeInteger(Number(d.raw_item_id)) || Number(d.raw_item_id) <= 0
          || d.doc_key !== `item:${d.raw_item_id}` || sourceHash(d.title, d.body) !== d.content_hash
          || !/^https:\/\//.test(d.url)) throw new Error('source');
      }
      if (proposal.state !== 'candidate' || !linked(ref.label)) continue;
      const docs = [pair.a, pair.b].map((d, i) => ({
        raw_item_id: Number(d.raw_item_id), source_id: Number(d.source_id), title: lib.redact(d.title),
        url: d.url, published_at: d.published_at, source_hash: d.content_hash,
        metadata: request.state[i ? 'document_b' : 'document_a'].metadata,
        passages: request.state[i ? 'document_b' : 'document_a'].passages,
      }));
      proposals.push({ ...proposal, relation: ref.label, document_identity: ref.document,
        model_relation: result.answers.relation.choice, model_document_identity: result.answers.document.choice,
        review: { reviewer: 'Codex', reviewer_type: 'ai', reviewed_at: ref.reviewed_at,
          note: lib.redact(ref.note), independent_human_validation: false },
        documents: docs, dataset_hash: data.dataset_hash, reference_hash: refs.reference_hash,
        warning: 'Brongebonden AI-context, geen onafhankelijke bevestiging of nieuw feit. Lees de oorspronkelijke stukken; geen merge of automatische scorewijziging.' });
    }
    return { status: 'ready', proposals };
  } catch {
    return { status: 'invalid', proposals: [], warning: 'Jev-pilot ontbreekt deels of wijkt af van bevroren bron/review; voorstellen overgeslagen.' };
  }
}

function freshDocument(doc, row) {
  return row && doc.url === row.external_url && doc.source_id === Number(row.source_id)
    && (doc.published_at || null) === (row.published_at || null)
    && doc.source_hash === sourceHash(row.title, row.body);
}
async function loadJevContext(db, pilot = readPilot()) {
  const summary = { status: pilot.status, reviewed_candidates: pilot.proposals.length,
    fresh_candidates: 0, stale_candidates: 0, warning: pilot.warning || null };
  const bySignal = new Map();
  if (!pilot.proposals.length) return { summary, bySignal };
  const ids = [...new Set(pilot.proposals.flatMap(p => p.documents.map(d => d.raw_item_id)))];
  const marks = ids.map(() => '?').join(',');
  const rows = (await db.execute({ sql: `SELECT id,title,source_id,external_url,published_at,
    COALESCE(full_text,content,summary,'') AS body
    FROM raw_items WHERE id IN (${marks})`, args: ids })).rows;
  const current = new Map(rows.map(r => [Number(r.id), r]));
  const fresh = pilot.proposals.filter(p => p.documents.every(d => freshDocument(d, current.get(d.raw_item_id))));
  summary.fresh_candidates = fresh.length;
  summary.stale_candidates = pilot.proposals.length - fresh.length;
  if (!fresh.length) return { summary, bySignal };
  const parentIds = [...new Set(fresh.flatMap(p => p.documents.map(d => d.raw_item_id)))];
  const parts = (await db.execute({ sql: `SELECT parent_id,part_id FROM raw_item_parts
    WHERE parent_id IN (${parentIds.map(() => '?')})`, args: parentIds })).rows;
  const parent = new Map(parts.map(r => [Number(r.part_id), Number(r.parent_id)]));
  const itemIds = [...new Set([...parentIds, ...parent.keys()])];
  const links = (await db.execute({ sql: `SELECT raw_item_id,signal_id FROM signal_items
    WHERE raw_item_id IN (${itemIds.map(() => '?')})`, args: itemIds })).rows;
  for (const p of fresh) {
    const docIds = new Set(p.documents.map(d => d.raw_item_id));
    const signals = new Set(links.filter(r => docIds.has(Number(r.raw_item_id))
      || docIds.has(parent.get(Number(r.raw_item_id)))).map(r => Number(r.signal_id)));
    for (const id of signals) {
      if (!bySignal.has(id)) bySignal.set(id, []);
      bySignal.get(id).push(p);
    }
  }
  return { summary, bySignal };
}
module.exports = { sourceHash, readPilot, freshDocument, loadJevContext };
