#!/usr/bin/env node
'use strict';

// Geïsoleerde, expliciet gestarte proef. Geen imports van productiejobs of writes naar Turso.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createClient } = require('@libsql/client');
const lib = require('./jev-experiment-lib.cjs');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tmp', 'jev-experiment');
const ARCHIVE = path.join(ROOT, 'data', 'archive-research', 'archive.sqlite');
// Beleids- en raadsstukken; geen ingekomen burgerbrieven, rechtszaken of sociale bronnen.
const SOURCE_IDS = [115, 116, 117, 118, 121, 122, 124, 129, 163, 164, 168, 162];
function file(name) { return path.join(OUT, name); }
function read(name, fallback) { return fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : fallback; }
function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 9) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function write(name, value) {
  fs.writeFileSync(file(name + '.writing'), JSON.stringify(value, null, 2) + '\n');
  renameRetry(file(name + '.writing'), file(name));
}
function option(argv, key, fallback) { const i = argv.indexOf(key); return i < 0 ? fallback : argv[i + 1]; }
async function prepare() {
  if (fs.existsSync(file('dataset.json'))) throw new Error('Bevroren dataset bestaat al; gebruik bestaande dataset.');
  if (!fs.existsSync(ARCHIVE)) throw new Error('Lokale archiefkopie ontbreekt; geen automatische productiesynchronisatie.');
  const db = createClient({ url: 'file:' + ARCHIVE.replace(/\\/g, '/') });
  let rows;
  try {
    await db.execute('PRAGMA query_only=ON');
    rows = (await db.execute({ sql: `SELECT doc_key,raw_item_id,source_id,source_name,title,url,published_at,content_hash,
      substr(body,1,100000) body, length(body)>100000 body_capped FROM archive_documents
      WHERE kind='raw_item' AND source_id IN (${SOURCE_IDS.map(() => '?').join(',')})
      AND length(body)>=200 ORDER BY id DESC LIMIT 1800`, args: SOURCE_IDS })).rows;
  } finally { db.close(); }
  const matching = await import(pathToFileURL(path.join(__dirname, 'intake-matching.mjs')).href);
  const documents = [], seen = new Set();
  for (const row of rows) {
    if (!/^https:\/\//i.test(row.url || '') || /inspreek|zienswijze|bezwaarschrift|persoonsgegevens|geheim|besloten/i.test(row.title || '')) continue;
    if (seen.has(row.content_hash)) continue;
    seen.add(row.content_hash); documents.push(row);
  }
  const tokenSets = documents.map(d => new Set(matching.tokenizeTitle(d.title)));
  const buckets = { title_link: [], weak_overlap: [], different: [] };
  for (let i = 0; i < documents.length; i++) for (let j = i + 1; j < documents.length; j++) {
    const a = documents[i], b = documents[j];
    if (a.raw_item_id === b.raw_item_id) continue;
    const shared = [...tokenSets[i]].filter(t => tokenSets[j].has(t));
    const baseline = matching.woordMatchScore(a, b) >= 3;
    const bucket = baseline ? 'title_link' : shared.length >= 2 ? 'weak_overlap' : shared.length === 0 ? 'different' : null;
    if (!bucket) continue;
    const id = lib.hash([a.doc_key, b.doc_key].sort()).slice(0, 16);
    buckets[bucket].push({ id, bucket, baseline_title_link: baseline,
      shared_title_terms: shared, a: i, b: j });
  }
  // Groepeer alle paren die een document delen; een document valt daardoor
  // nooit deels in afstellen en deels in toetsen.
  const selected = [], uses = new Map();
  for (const bucket of Object.keys(buckets)) {
    buckets[bucket].sort((a, b) => a.id.localeCompare(b.id));
    for (const candidate of buckets[bucket]) {
      if (selected.filter(p => p.bucket === bucket).length >= 100) break;
      if ((uses.get(candidate.a) || 0) >= 3 || (uses.get(candidate.b) || 0) >= 3) continue;
      selected.push(candidate);
      uses.set(candidate.a, (uses.get(candidate.a) || 0) + 1);
      uses.set(candidate.b, (uses.get(candidate.b) || 0) + 1);
    }
  }
  const parents = documents.map((_, i) => i);
  function find(i) { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; }
  for (const p of selected) parents[find(p.a)] = find(p.b);
  const groups = new Map();
  for (const p of selected) {
    const root = find(p.a);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p.id);
  }
  const pairs = selected.map(p => {
    const group = lib.hash(groups.get(find(p.a)).sort()).slice(0, 16);
    return { ...p, group, split: parseInt(group.slice(0, 8), 16) % 5 === 0 ? 'test' : 'development',
      a: lib.excerpt(documents[p.a], p.shared_title_terms), b: lib.excerpt(documents[p.b], p.shared_title_terms) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (pairs.length < 30) throw new Error('Onvoldoende kandidaatparen voor proef.');
  write('dataset.json', { version: lib.VERSION, created_at: new Date().toISOString(),
    archive_modified_at: fs.statSync(ARCHIVE).mtime.toISOString(), source_ids: SOURCE_IDS,
    source_documents: documents.length, pairs, dataset_hash: lib.hash(pairs),
    limits: 'Geen volledigheidsmeting van retrieval; gestratificeerde titelsteekproef. Split groepeert gedeelde documenten, geen bewezen projectgroepen.' });
  write('reviews.json', pairs.map(p => ({ pair_id: p.id, label: '', reviewer: '', reviewer_type: 'human', note: '' })));
  console.log(JSON.stringify({ prepared: pairs.length, documents: documents.length,
    buckets: Object.fromEntries(Object.keys(buckets).map(k => [k, pairs.filter(p => p.bucket === k).length])), turso_reads: 0 }));
}
async function run(argv) {
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY ontbreekt.');
  const dataset = read('dataset.json', null);
  if (!dataset || lib.hash(dataset.pairs) !== dataset.dataset_hash) throw new Error('Dataset ontbreekt of hash wijkt af.');
  const budget = Number(option(argv, '--budget', '1'));
  const limit = Number(option(argv, '--limit', '300'));
  const reverse = argv.includes('--reverse-options');
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1) throw new Error('Proefbudget moet tussen 0 en 1 USD liggen.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Limiet moet 1–300 zijn.');
  const ledger = read('ledger.json', { entries: [] });
  let done = 0;
  const strata = ['title_link', 'weak_overlap', 'different'].map(bucket => dataset.pairs.filter(p => p.bucket === bucket));
  const candidates = reverse ? Array.from({ length: Math.max(...strata.map(s => s.length)) }, (_, i) => strata.map(s => s[i]).filter(Boolean)).flat() : dataset.pairs;
  for (const pair of candidates.slice(0, limit)) {
    const request = lib.requestFor(pair, reverse), key = lib.hash(request);
    if (ledger.entries.some(e => e.request_hash === key && e.status !== 'not_sent')) continue;
    if (!lib.canReserve(ledger.entries, budget)) { console.log('Budgetgrens bereikt; gestopt vóór volgend verzoek.'); break; }
    // UTF-8-bytes zijn een conservatieve invoermaat. Ruim onder beide contextlimieten.
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded, 'utf8') > 28000) throw new Error('Invoer te groot; niet verzonden.');
    const entry = { pair_id: pair.id, request_hash: key, dataset_hash: dataset.dataset_hash,
      variant: reverse ? 'reverse_options' : 'normal', status: 'reserved', reserved_usd: lib.RESERVATION,
      started_at: new Date().toISOString() };
    ledger.entries.push(entry); write('ledger.json', ledger);
    try {
      const response = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.TYPESAFE_API_KEY, 'Content-Type': 'application/json' },
        body: encoded, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Jev HTTP ' + response.status + '; geen automatische retry.');
      entry.result = lib.validateResponse(await response.json()); entry.status = 'ok';
      entry.finished_at = new Date().toISOString();
    } catch (error) {
      const localAccessDenied = error.cause?.code === 'EACCES';
      entry.status = localAccessDenied ? 'not_sent' : 'unresolved';
      entry.error_code = localAccessDenied ? 'EACCES' : 'UNCONFIRMED';
      // Geen responsebody, headers of invoer in foutuitvoer: die kunnen geheimen bevatten.
      write('ledger.json', ledger);
      throw new Error(localAccessDenied ? 'Lokale netwerktoegang geweigerd (EACCES); verzoek niet verzonden.' :
        error.message.startsWith('Jev HTTP') ? error.message : 'Jev-aanroep niet bevestigd; reservering behouden, geen retry.');
    }
    // Opslagfouten zijn geen API-fouten. Laat het gevalideerde antwoord intact
    // in het tijdelijke bestand voor herstel zonder opnieuw betaald verzoek.
    write('ledger.json', ledger);
    done++;
    if (done % 25 === 0) console.log(JSON.stringify({ completed_this_run: done, accounted_usd: lib.budgetUsed(ledger.entries) }));
  }
  console.log(JSON.stringify({ completed_this_run: done, requests_recorded: ledger.entries.length, accounted_usd: lib.budgetUsed(ledger.entries) }));
}
function importReviews(input) {
  if (!input) throw new Error('Geef het gedownloade beoordelingenbestand op.');
  const dataset = read('dataset.json', null);
  const downloaded = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  if (!dataset || downloaded.dataset_hash !== dataset.dataset_hash || !Array.isArray(downloaded.reviews)) throw new Error('Beoordelingen horen niet bij deze bevroren dataset.');
  const ids = new Set(dataset.pairs.map(p => p.id)), seen = new Set();
  for (const r of downloaded.reviews) {
    if (!ids.has(r.pair_id) || seen.has(r.pair_id) || !Object.hasOwn(lib.LABELS, r.label)
        || r.reviewer_type !== 'human' || typeof r.reviewer !== 'string' || !r.reviewer.trim()
        || (r.note != null && typeof r.note !== 'string')) throw new Error('Ongeldige of dubbele menselijke beoordeling.');
    seen.add(r.pair_id);
  }
  const merged = new Map(read('reviews.json', []).map(r => [r.pair_id, r]));
  for (const r of downloaded.reviews) merged.set(r.pair_id, { pair_id: r.pair_id, label: r.label,
    reviewer: r.reviewer.trim().slice(0, 80), reviewer_type: 'human', note: (r.note || '').slice(0, 1000), reviewed_at: new Date().toISOString() });
  write('reviews.json', [...merged.values()]);
  console.log(JSON.stringify({ imported_human_reviews: downloaded.reviews.length }));
}
function report() {
  const dataset = read('dataset.json', null), ledger = read('ledger.json', { entries: [] });
  if (!dataset) throw new Error('Dataset ontbreekt.');
  const results = ledger.entries.filter(e => e.status === 'ok' && e.dataset_hash === dataset.dataset_hash);
  const normal = results.filter(e => e.variant === 'normal');
  const reversed = results.filter(e => e.variant === 'reverse_options');
  const changed = reversed.filter(e => {
    const first = normal.find(n => n.pair_id === e.pair_id);
    return first && first.result.answers.relation.choice !== e.result.answers.relation.choice;
  });
  const counts = Object.fromEntries(Object.keys(lib.LABELS).map(label => [label, normal.filter(e => e.result.answers.relation.choice === label).length]));
  const reviews = read('reviews.json', []);
  const summary = { dataset_pairs: dataset.pairs.length, completed: normal.length, option_order_tests: reversed.length,
    option_order_changed: changed.length, changed_pair_ids: changed.map(e => e.pair_id), predictions: counts,
    low_confidence: normal.filter(e => e.result.answers.relation.confidence < 0.7).length,
    noul_choice_disagreement: normal.filter(e => (e.result.answers.relation.choice === 'same_case') !== (e.result.answers.same_case.noul >= 0.5)).length,
    model: lib.MODEL, input_tokens: results.reduce((n, e) => n + e.result.input_tokens, 0),
    actual_recorded_usd: results.reduce((n, e) => n + e.result.cost_usd, 0), accounted_usd: lib.budgetUsed(ledger.entries),
    turso_reads: 0, production_writes: 0,
    by_candidate_bucket: Object.fromEntries(['title_link', 'weak_overlap', 'different'].map(bucket => {
      const ids = new Set(dataset.pairs.filter(p => p.bucket === bucket).map(p => p.id));
      return [bucket, Object.fromEntries(Object.keys(lib.LABELS).map(label => [label, normal.filter(e => ids.has(e.pair_id) && e.result.answers.relation.choice === label).length]))];
    })),
    evaluation: lib.evaluateLabels(dataset.pairs, ledger.entries, reviews),
    evaluation_by_split: Object.fromEntries(['development', 'test'].map(split => [split,
      lib.evaluateLabels(dataset.pairs.filter(p => p.split === split), ledger.entries, reviews)])),
    limitation: 'Uitkomsten zijn modelvoorstellen; geen bewezen kwaliteit, geen autonome merges of dossiers. Geen andere LLM vergeleken.' };
  write('report.json', summary);
  const review = dataset.pairs.map((p, i) => {
    const doc = d => `${d.title}\nBron: ${d.source}\nURL: ${d.url}\n${d.passages.map(s => `[tekens ${s.start}–${s.end}] ${s.text}`).join('\n\n')}`;
    return `PAAR ${i + 1} | ${p.id}\n\nDOCUMENT A\n${doc(p.a)}\n\nDOCUMENT B\n${doc(p.b)}\n\nMenselijk oordeel (same_case / related / overlap_only / unrelated / insufficient):\nReden:\n`;
  });
  fs.writeFileSync(file('review-blind.txt'), review.join('\n' + '='.repeat(70) + '\n\n'));
  const strata = ['title_link', 'weak_overlap', 'different'].map(bucket => dataset.pairs.filter(p => p.bucket === bucket).slice(0, 10));
  const starter = Array.from({ length: 10 }, (_, i) => strata.map(s => s[i]).filter(Boolean)).flat();
  const payload = JSON.stringify({ hash: dataset.dataset_hash, pairs: starter, labels: lib.LABELS }).replace(/</g, '\\u003c');
  fs.writeFileSync(file('beoordeling.html'), `<!doctype html><html lang="nl"><meta charset="utf-8"><title>Stadsgeest — documentverbanden beoordelen</title>
<style>body{font:17px/1.5 system-ui;max-width:1200px;margin:24px auto;padding:0 20px;color:#202a33;background:#f6f5f1}article{background:white;border:1px solid #ddd;padding:20px;flex:1;min-width:0}section{display:flex;gap:16px}pre{white-space:pre-wrap;font:15px/1.55 system-ui}button,select,input,textarea{font:inherit;padding:8px}button{cursor:pointer;margin:6px}textarea{width:95%;height:60px}a{overflow-wrap:anywhere}label{display:block;margin:12px 0}@media(max-width:750px){section{display:block}}</style>
<h1>Horen deze stukken bij elkaar?</h1><p>Deze eerste 30 paren komen uit drie soorten kandidaten. Je ziet de modelantwoorden niet. Beoordeel alleen wat de passages onderbouwen; kies bij ontbrekend bewijs “onvoldoende informatie”. Dit is een verkennende controle, geen representatieve kwaliteitsmeting.</p>
<label>Beoordelaar: <input id="who" placeholder="Naam of initialen"></label><p id="progress"></p><section><article id="a"></article><article id="b"></article></section>
<label>Jouw oordeel: <select id="label"><option value="">Nog niet beoordeeld</option></select></label><p id="help"></p><label>Toelichting: <textarea id="note"></textarea></label>
<button id="prev">Vorige</button><button id="next">Volgende</button><button id="download">Beoordelingen downloaden</button><p>Je keuzes worden alleen in deze browser bewaard. Download ze als bestand voor verwerking in de proef. De passages zijn selecties; ontbrekende tekst kan een verband bevatten.</p>
<script>const data=${payload};const storage='stadsgeest-jev-'+data.hash;let saved;try{saved=JSON.parse(localStorage.getItem(storage)||'{}')}catch{saved={}}let index=0;
const el=id=>document.getElementById(id);for(const [key,value] of Object.entries(data.labels)){const option=document.createElement('option');option.value=key;option.textContent=({same_case:'Dezelfde zaak of hetzelfde project',related:'Inhoudelijk verwant, verschillende zaken',overlap_only:'Alleen gedeelde naam, locatie of sjabloon',unrelated:'Verschillende onderwerpen',insufficient:'Onvoldoende informatie'})[key];el('label').append(option)}
function doc(target,d){const box=el(target);box.replaceChildren();const title=document.createElement('h2');title.textContent=d.title;box.append(title);const source=document.createElement('p');source.textContent=d.source+' | '+(d.published_at||'datum onbekend');box.append(source);const link=document.createElement('a');link.textContent='Open oorspronkelijke bron';link.href=d.url;link.target='_blank';link.rel='noopener noreferrer';box.append(link);for(const p of d.passages){const text=document.createElement('pre');text.textContent='[tekens '+p.start+'–'+p.end+']\\n'+p.text;box.append(text)}}
function show(){const p=data.pairs[index],r=saved[p.id]||{};doc('a',p.a);doc('b',p.b);el('label').value=r.label||'';el('note').value=r.note||'';el('who').value=r.reviewer||el('who').value;el('help').textContent=data.labels[el('label').value]||'';el('progress').textContent='Paar '+(index+1)+' van '+data.pairs.length+' | '+Object.values(saved).filter(r=>r.label&&r.reviewer).length+' beoordeeld';el('prev').disabled=index===0;el('next').disabled=index===data.pairs.length-1}
function save(){const p=data.pairs[index];saved[p.id]={pair_id:p.id,label:el('label').value,reviewer:el('who').value.trim(),reviewer_type:'human',note:el('note').value};try{localStorage.setItem(storage,JSON.stringify(saved))}catch{}el('help').textContent=data.labels[el('label').value]||''}
for(const id of ['label','note','who'])el(id).addEventListener('input',save);el('prev').onclick=()=>{save();index--;show()};el('next').onclick=()=>{save();index++;show()};el('download').onclick=()=>{save();const reviews=Object.values(saved).filter(r=>r.label&&r.reviewer);if(!reviews.length){alert('Vul eerst een oordeel en je naam of initialen in.');return}const url=URL.createObjectURL(new Blob([JSON.stringify({dataset_hash:data.hash,reviews},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='jev-beoordelingen.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};show();</script></html>`);
  console.log(JSON.stringify(summary, null, 2));
}
async function main(argv = process.argv.slice(2)) {
  fs.mkdirSync(OUT, { recursive: true });
  let lock;
  try { lock = fs.openSync(file('experiment.lock'), 'wx'); } catch { throw new Error('Proef is vergrendeld; geen tweede run starten.'); }
  try {
    if (fs.existsSync(file('ledger.json.writing'))) {
      const pending = JSON.parse(fs.readFileSync(file('ledger.json.writing'), 'utf8'));
      const current = read('ledger.json', { entries: [] });
      if (!Array.isArray(pending.entries) || pending.entries.length < current.entries.length
          || !current.entries.every((e, i) => e.request_hash === pending.entries[i].request_hash)) {
        throw new Error('Tijdelijk budgetbestand wijkt af; handmatige controle nodig.');
      }
      for (let i = 0; i < pending.entries.length; i++) {
        const e = pending.entries[i];
        if (e.result) {
          e.result = lib.validateResponse({ model: e.result.model, answers: e.result.answers, usage: { input_tokens: e.result.input_tokens } });
          e.status = 'ok';
        } else if (i >= current.entries.length && e.status === 'reserved') {
          // Nieuwe reservering is nog niet atomair vastgelegd: de netwerkstap
          // kan pas na die opslag starten, dus dit verzoek is niet verzonden.
          e.status = 'not_sent'; e.error_code = 'STORAGE_BEFORE_SEND';
        }
      }
      write('ledger.json', pending);
    }
    if (argv[0] === 'prepare') await prepare();
    else if (argv[0] === 'run') await run(argv);
    else if (argv[0] === 'import-reviews') importReviews(argv[1]);
    else if (argv[0] === 'report') report();
    else throw new Error('Gebruik: jev-experiment.cjs prepare | run [--limit 300] [--reverse-options] | report');
  } finally { fs.closeSync(lock); fs.unlinkSync(file('experiment.lock')); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
