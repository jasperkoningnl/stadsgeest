#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createClient } = require('@libsql/client');
const v1 = require('./jev-experiment-lib.cjs'), lib = require('./jev-followup-lib.cjs');
const sharedBudget = require('./jev-budget.cjs');
const ROOT = path.join(__dirname, '..'), BASE = path.join(ROOT, 'tmp', 'jev-experiment');
const OUT = path.join(BASE, 'followup'), ARCHIVE = path.join(ROOT, 'data', 'archive-research', 'archive.sqlite');
const SOURCE_IDS = [115, 116, 117, 118, 121, 122, 124, 129, 163, 164, 168, 162];
const read = (name, fallback) => fs.existsSync(path.join(OUT, name)) ? JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8')) : fallback;
function write(name, value) {
  const target = path.join(OUT, name), pending = target + '.writing';
  fs.writeFileSync(pending, JSON.stringify(value, null, 2) + '\n');
  for (let i = 0; ; i++) { try { fs.renameSync(pending, target); return; } catch (e) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 9) throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  } }
}
async function prepare() {
  if (read('dataset.json', null)) throw new Error('Vervolgdataset is al bevroren.');
  if (!fs.existsSync(ARCHIVE)) throw new Error('Lokale archiefkopie ontbreekt.');
  const db = createClient({ url: 'file:' + ARCHIVE.replace(/\\/g, '/') });
  let pool;
  try { await db.execute('PRAGMA query_only=ON'); pool = (await db.execute({
    sql: `SELECT doc_key,raw_item_id,source_id,source_name,title,url,published_at,content_hash,body FROM archive_documents
      WHERE kind='raw_item' AND source_id IN (${SOURCE_IDS.map(() => '?')}) AND length(body)>=200 ORDER BY id DESC LIMIT 1800`, args: SOURCE_IDS,
  })).rows.filter(d => /^https:\/\//.test(d.url || '') && !/inspreek|zienswijze|bezwaarschrift|persoonsgegevens|geheim|besloten/i.test(d.title)); }
  finally { db.close(); }
  const byKey = new Map(pool.map(d => [d.doc_key, d]));
  const pairs = [], seen = new Set();
  function add(a, b, group, stratum, original_id = null) {
    const id = v1.hash([a.doc_key, b.doc_key].sort()).slice(0, 16);
    if (seen.has(id)) return;
    seen.add(id); pairs.push({ id, topic: group, stratum, original_id, a, b, baseline: lib.structuralBaseline(a, b) });
  }
  const groups = new Map();
  for (const d of pool) {
    const m = lib.metadata(d); if (!m.agenda_title || d.body.length < 1000) continue;
    const key = m.authority + ':' + m.agenda_title;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(d);
  }
  // Vooraf gekozen verschillende dossiers; geen selecteren op Jev-antwoorden.
  const topics = ['onderzoeksverordening', 'zomerrapportage', 'ophalen input college', 'regiovisie jeugd',
    'rol van de raad', 'presentatie meerjarenbegroting', 'deelname veiligheidsregio', 'fiets veilig westzijde',
    'omgevingsprogramma energie', 'koedijkerweg', 'wijziging omgevingsvisie', 'circulaire transitie',
    'programmabegroting 2027', 'programma landelijk gebied', 'netuitbreiding amersfoort noord',
    'vastgoedbeleid', 'berenschotrapport'];
  for (const token of topics) {
    const eligible = [...groups].filter(([key, docs]) => key.includes(token) && docs.length >= 2);
    const authorities = new Set();
    for (const [key, docs] of eligible) {
      const authority = lib.metadata(docs[0]).authority;
      if (authorities.has(authority)) continue;
      authorities.add(authority); add(docs[0], docs[1], key, 'agenda_pair');
    }
  }
  const old = JSON.parse(fs.readFileSync(path.join(BASE, 'dataset.json'), 'utf8'));
  const audit = JSON.parse(fs.readFileSync(path.join(BASE, 'ai-audit.json'), 'utf8'));
  const diagnostics = new Set(audit.full_text_followups.map(r => r.pair_id));
  const oldSelected = [
    ...old.pairs.filter(p => diagnostics.has(p.id)),
    ...audit.reviews.filter(r => r.label === 'overlap_only' && !diagnostics.has(r.pair_id)).slice(0, 12).map(r => old.pairs.find(p => p.id === r.pair_id)),
    ...old.pairs.filter(p => ['00b3b17138408e23', '00f11ef0d057766a', '005f240dd2e92b3a', '026f105be9cb2e87'].includes(p.id)),
  ];
  for (const p of oldSelected) {
    const a = byKey.get(p.a.doc_key), b = byKey.get(p.b.doc_key);
    if (!a || !b) throw new Error('Oud diagnosepaar ontbreekt in bronpool.');
    add(a, b, diagnostics.has(p.id) ? `diagnostic:${p.id}` : `control:${p.id}`, diagnostics.has(p.id) ? 'full_text_diagnostic' : 'audit_control', p.id);
  }
  // Twee procedureparen met hetzelfde scoped zaakkenmerk, geselecteerd zonder model.
  const cases = new Map();
  for (const d of pool) { const m = lib.metadata(d); if (!m.authority || !m.case_id) continue;
    const key = m.authority + ':' + m.case_id; if (!cases.has(key)) cases.set(key, []); cases.get(key).push(d); }
  let added = 0;
  for (const [key, docs] of cases) {
    if (docs.length < 2 || /isselt/i.test(docs[0].title)) continue;
    const before = pairs.length; add(docs[0], docs[1], key, 'case_id_pair');
    if (pairs.length > before && ++added >= 2) break;
  }
  pairs.sort((a, b) => a.id.localeCompare(b.id));
  write('dataset.json', { version: lib.VERSION, created_at: new Date().toISOString(),
    archive_modified_at: fs.statSync(ARCHIVE).mtime.toISOString(), source_ids: SOURCE_IDS, pairs,
    dataset_hash: v1.hash(pairs), scope: 'Gerichte ontwikkelproef; diagnoseparen zijn bekend uit v1, nieuwe agendaparen zijn nog niet door Jev beoordeeld. Geen representatieve steekproef of onafhankelijke testset.' });
  console.log(JSON.stringify({ prepared: pairs.length, agenda_pairs: pairs.filter(p => p.stratum === 'agenda_pair').length,
    authorities: [...new Set(pairs.flatMap(p => [lib.metadata(p.a).authority, lib.metadata(p.b).authority]))], turso_reads: 0 }));
}
async function run(argv) {
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  if (!process.env.TYPESAFE_API_KEY) throw new Error('Jev-sleutel ontbreekt.');
  const dataset = read('dataset.json', null), refs = read('references.json', null);
  if (!dataset || v1.hash(dataset.pairs) !== dataset.dataset_hash) throw new Error('Dataset/hash ongeldig.');
  if (!refs || refs.dataset_hash !== dataset.dataset_hash || v1.hash(refs.reviews) !== refs.reference_hash || refs.reviews.length !== dataset.pairs.length
      || new Set(refs.reviews.map(r => r.pair_id)).size !== dataset.pairs.length
      || !refs.reviews.every(r => dataset.pairs.some(p => p.id === r.pair_id) && r.reviewer_type === 'ai' && Object.hasOwn(lib.RELATIONS, r.label))) throw new Error('AI-referentie moet compleet en bevroren zijn vóór API-verbruik.');
  const mode = argv[1] || 'selected';
  if (!['short', 'selected', 'reverse'].includes(mode)) throw new Error('Modus: short, selected of reverse.');
  const ledger = read('ledger.json', { entries: [] });
  if (ledger.entries.some(e => e.reference_hash !== refs.reference_hash)) throw new Error('Referenties gewijzigd na begin proef.');
  const pairs = mode === 'reverse' ? dataset.pairs.filter((_, i) => i % 3 === 0).slice(0, 16) : dataset.pairs;
  let done = 0;
  for (const pair of pairs) {
    const request = lib.requestFor(pair, mode === 'short' ? 'short' : 'selected', mode === 'reverse'), requestHash = v1.hash(request);
    if (ledger.entries.some(e => e.request_hash === requestHash && e.status !== 'not_sent')) continue;
    if (!sharedBudget.mayReserve(5)) throw new Error('Gedeeld proefbudget bereikt; gestopt vóór verzoek.');
    const body = JSON.stringify(request); if (Buffer.byteLength(body) > 28000) throw new Error('Invoer te groot.');
    const entry = { pair_id: pair.id, request_hash: requestHash, dataset_hash: dataset.dataset_hash, reference_hash: refs.reference_hash, request, mode,
      status: 'reserved', reserved_usd: v1.RESERVATION, started_at: new Date().toISOString() };
    ledger.entries.push(entry); write('ledger.json', ledger);
    try {
      const response = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.TYPESAFE_API_KEY, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Jev HTTP ' + response.status);
      entry.result = lib.validate(await response.json()); entry.status = 'ok'; entry.finished_at = new Date().toISOString();
    } catch (e) {
      entry.status = e.cause?.code === 'EACCES' ? 'not_sent' : 'unresolved'; write('ledger.json', ledger);
      throw new Error(e.message.startsWith('Jev HTTP') ? e.message : 'Aanroep niet bevestigd; geen automatische retry.');
    }
    write('ledger.json', ledger); done++;
    if (done % 15 === 0) console.log(JSON.stringify({ mode, done, total_accounted_usd: sharedBudget.total() }));
  }
  console.log(JSON.stringify({ mode, done, total_accounted_usd: sharedBudget.total() }));
}
function report() {
  const dataset = read('dataset.json', null), refs = read('references.json', null), ledger = read('ledger.json', { entries: [] });
  if (!dataset || !refs || v1.hash(dataset.pairs) !== dataset.dataset_hash || refs.dataset_hash !== dataset.dataset_hash
      || v1.hash(refs.reviews) !== refs.reference_hash || ledger.entries.some(e => e.reference_hash !== refs.reference_hash)) throw new Error('Rapportinvoer wijkt af van bevroren proef.');
  const prior = JSON.parse(fs.readFileSync(path.join(BASE, 'ledger.json'), 'utf8'));
  const modes = {};
  for (const mode of ['short', 'selected']) {
    const entries = ledger.entries.filter(e => e.status === 'ok' && e.mode === mode);
    const confusion = {}, misses = [], spurious = [], disputed = [];
    let exact = 0, linkAgreement = 0, documentAgreement = 0, total = 0;
    for (const e of entries) {
      const ref = refs.reviews.find(r => r.pair_id === e.pair_id); if (!ref) continue;
      const predicted = e.result.answers.relation.choice;
      const referenceLink = ['same_case', 'same_dossier', 'related_dossiers'].includes(ref.label);
      const modelLink = ['same_case', 'same_dossier', 'related_dossiers'].includes(predicted);
      total++; exact += Number(predicted === ref.label); linkAgreement += Number(modelLink === referenceLink);
      documentAgreement += Number(e.result.answers.document.choice === ref.document);
      const k = ref.label + ' -> ' + predicted; confusion[k] = (confusion[k] || 0) + 1;
      if (referenceLink && !modelLink) misses.push(e.pair_id);
      if (!referenceLink && modelLink) spurious.push(e.pair_id);
      if (predicted !== ref.label) disputed.push(e.pair_id);
    }
    modes[mode] = { completed: entries.length, compared_ai_references: total, exact_label_agreement: exact,
      link_agreement: linkAgreement, missed_reference_links: misses, spurious_reference_links: spurious, disputed_labels: disputed, confusion };
    modes[mode].document_agreement = documentAgreement;
  }
  const selected = ledger.entries.filter(e => e.status === 'ok' && e.mode === 'selected');
  const reverse = ledger.entries.filter(e => e.status === 'ok' && e.mode === 'reverse');
  const changes = reverse.filter(e => selected.find(s => s.pair_id === e.pair_id)?.result.answers.relation.choice !== e.result.answers.relation.choice);
  const referenceLinks = refs.reviews.filter(r => ['same_case', 'same_dossier', 'related_dossiers'].includes(r.label));
  const structureLinks = dataset.pairs.filter(p => ['same_case', 'same_dossier', 'related_dossiers'].includes(p.baseline.relation));
  const structural = { proposed_links: structureLinks.length,
    supported_by_ai_reference: structureLinks.filter(p => referenceLinks.some(r => r.pair_id === p.id)).length,
    missed_ai_reference_links: referenceLinks.filter(r => !structureLinks.some(p => p.id === r.pair_id)).map(r => r.pair_id),
    note: 'Agendacontext levert een dossierkandidaat, geen bevestigd feit. Zaakidentiteit en documentidentiteit worden afzonderlijk beoordeeld.' };
  const proposals = selected.map(e => lib.propose(dataset.pairs.find(p => p.id === e.pair_id), e.result));
  write('proposals.json', { dataset_hash: dataset.dataset_hash, confirmed: false, production_writes: 0, proposals });
  const candidates = proposals.filter(p => p.state === 'candidate');
  const hybrid = { candidates: candidates.length,
    supported_by_ai_reference: candidates.filter(p => referenceLinks.some(r => r.pair_id === p.pair_id)).length,
    missed_ai_reference_links: referenceLinks.filter(r => !candidates.some(p => p.pair_id === r.pair_id)).map(r => r.pair_id),
    metadata_restores_model_rejection: candidates.filter(p => p.flags.includes('model_disagrees_with_structure')).map(p => p.pair_id),
    document_identity_disagreements: proposals.filter(p => p.flags.includes('document_identity_disagreement')).map(p => p.pair_id),
    review_required: true, merge_allowed: false };
  const summary = { version: lib.VERSION, pairs: dataset.pairs.length, reference_type: 'ai', user_accepted_reference: refs.user_accepted_reference_basis === true, human_reviews: 0,
    strata: Object.fromEntries([...new Set(dataset.pairs.map(p => p.stratum))].map(k => [k, dataset.pairs.filter(p => p.stratum === k).length])),
    structure_candidates: structureLinks.length, structural,
    modes, hybrid, reverse_tests: reverse.length, reverse_relation_changes: changes.map(e => e.pair_id),
    cost_followup_usd: v1.budgetUsed(ledger.entries), cost_all_experiments_usd: sharedBudget.total(),
    turso_reads: 0, production_writes: 0, limitation: 'Overeenstemming met door Jasper geaccepteerde Codex-controle, geen onafhankelijke menselijke nauwkeurigheidsmeting. Geen productiepromotie.' };
  write('report.json', summary); console.log(JSON.stringify(summary, null, 2));
}
async function main(argv = process.argv.slice(2)) {
  fs.mkdirSync(OUT, { recursive: true }); const lock = path.join(BASE, 'experiment.lock');
  let fd; try { fd = fs.openSync(lock, 'wx'); } catch { throw new Error('Andere proef actief of vergrendeld.'); }
  try {
    const pending = path.join(OUT, 'ledger.json.writing');
    if (fs.existsSync(pending)) {
      const next = JSON.parse(fs.readFileSync(pending, 'utf8')), current = read('ledger.json', { entries: [] });
      if (!Array.isArray(next.entries) || next.entries.length < current.entries.length || !current.entries.every((e, i) => e.request_hash === next.entries[i].request_hash)) throw new Error('Budgetherstel vereist controle.');
      for (let i = 0; i < next.entries.length; i++) {
        const e = next.entries[i];
        if (e.result) { e.result = lib.validate({ model: e.result.model, answers: e.result.answers, usage: { input_tokens: e.result.input_tokens } }); e.status = 'ok'; }
        else if (i >= current.entries.length && e.status === 'reserved') e.status = 'not_sent';
      }
      write('ledger.json', next);
    }
    if (argv[0] === 'prepare') await prepare(); else if (argv[0] === 'run') await run(argv); else if (argv[0] === 'report') report();
    else throw new Error('Gebruik: jev-followup.cjs prepare | run short/selected/reverse | report');
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main };
