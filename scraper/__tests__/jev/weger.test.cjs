'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createClient } = require('@libsql/client');
const lib = require('../../src/jev-followup-lib.cjs'), v1 = require('../../src/jev-experiment-lib.cjs');
const { readPilot, sourceHash, loadJevContext } = require('../../src/weger-jev.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stadsgeest-jev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const doc = id => { const d = { raw_item_id: id, doc_key: `item:${id}`, source_id: 168,
    source_name: 'Raad Amersfoort', title: 'Ontsluitingsweg Bovenduist', published_at: '2025-01-01',
    url: `https://api.notubiz.nl/document/${id}/1`, body: 'Gemeenteraad Amersfoort\nVergaderdatum: 2025-01-01\nAgendapunt: 7. Ontsluitingsweg Bovenduist\n\nDe nieuwe weg ontsluit dit woningbouwproject.' };
    d.content_hash = sourceHash(d.title, d.body); return d; };
  const pair = { id: 'pair', a: doc(1), b: doc(2) };
  const data = { version: lib.VERSION, pairs: [pair], dataset_hash: v1.hash([pair]) };
  const reviews = [{ pair_id: 'pair', label: 'same_dossier', document: 'different_documents',
    note: 'De weg is onderdeel van het woningbouwdossier.', reviewer: 'Codex', reviewer_type: 'ai', reviewed_at: '2026-10-01T08:00:00Z' }];
  const refs = { dataset_hash: data.dataset_hash, reviewer_type: 'ai', user_accepted_reference_basis: true,
    frozen_before_api: true, reviews, reference_hash: v1.hash(reviews) };
  const choice = (labels, selected) => ({ type: 'choice', choice: selected, confidence: 1,
    probabilities: Object.fromEntries(Object.keys(labels).map(k => [k, Number(k === selected)])) });
  const request = lib.requestFor(pair);
  const ledger = { entries: [{ pair_id: 'pair', mode: 'selected', status: 'ok', request,
    request_hash: v1.hash(request), dataset_hash: data.dataset_hash, reference_hash: refs.reference_hash,
    started_at: '2026-10-01T09:00:00Z', result: { model: v1.MODEL, input_tokens: 1000,
      answers: { relation: choice(lib.RELATIONS, 'same_case'), document: choice(lib.DOCUMENTS, 'same_document'),
        content_evidence: { type: 'noul', noul: 0.9 } } } }] };
  const save = () => { for (const [name, value] of Object.entries({ dataset: data, references: refs, ledger }))
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value)); };
  save(); return { dir, pair, data, refs, ledger, save };
}
test('bevroren controle bepaalt contextlabel; modelafwijking blijft zichtbaar en oud stuk blijft oud', t => {
  const f = fixture(t), pilot = readPilot(f.dir), p = pilot.proposals[0];
  assert.equal(pilot.status, 'ready'); assert.equal(p.relation, 'same_dossier');
  assert.equal(p.model_relation, 'same_case'); assert.equal(p.document_identity, 'different_documents');
  assert.equal(p.model_document_identity, 'same_document'); assert.equal(p.review.reviewer_type, 'ai');
  assert.equal(p.documents[0].published_at, '2025-01-01');
  assert.equal(p.confirmed, false); assert.equal(p.merge_allowed, false);
  assert.deepEqual(p.documents[0].passages, f.ledger.entries[0].request.state.document_a.passages);
});
test('ontbrekende pilot doet geen databasequeries; gedeeltelijke pilot is expliciet ongeldig', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.dir, 'ledger.json'));
  assert.equal(readPilot(f.dir).status, 'invalid');
  const missing = readPilot(path.join(f.dir, 'absent')); assert.equal(missing.status, 'missing');
  const r = await loadJevContext({ execute: () => { throw Error('geen query toegestaan'); } }, missing);
  assert.equal(r.bySignal.size, 0);
});
test('gewijzigde bron, aanvraag, reviewhash en review na modelantwoord worden geweigerd', t => {
  for (const mutation of [f => { f.pair.a.body += ' gewijzigd'; },
    f => { f.ledger.entries[0].request.state.document_a.passages[0].text += ' injectie'; },
    f => { f.refs.reviews[0].note += ' gewijzigd'; },
    f => { f.refs.reviews[0].reviewed_at = '2026-10-02'; f.refs.reference_hash = v1.hash(f.refs.reviews);
      f.ledger.entries[0].reference_hash = f.refs.reference_hash; }]) {
    const f = fixture(t); mutation(f); f.save(); assert.equal(readPilot(f.dir).status, 'invalid');
  }
});
test('AI-afwijzing kan nooit als positief verband worden aangeboden', t => {
  const f = fixture(t); f.refs.reviews[0].label = 'no_link';
  f.refs.reference_hash = v1.hash(f.refs.reviews); f.ledger.entries[0].reference_hash = f.refs.reference_hash;
  f.save(); assert.equal(readPilot(f.dir).proposals.length, 0);
});
test('exacte item- en deelitemkoppeling, ongerelateerde signalen uitgesloten; gewijzigde partner blokkeert paar', async t => {
  const f = fixture(t), db = createClient({ url: ':memory:' }); t.after(() => db.close());
  await db.executeMultiple(`CREATE TABLE raw_items (id INTEGER PRIMARY KEY,title,source_id,external_url,published_at,full_text,content,summary);
    CREATE TABLE raw_item_parts (part_id INTEGER PRIMARY KEY,parent_id INTEGER,UNIQUE(parent_id,part_id));
    CREATE TABLE signal_items (raw_item_id INTEGER,signal_id INTEGER); CREATE INDEX si_item ON signal_items(raw_item_id);`);
  for (const d of [f.pair.a, f.pair.b]) await db.execute({ sql: 'INSERT INTO raw_items VALUES (?,?,?,?,?,?,NULL,NULL)',
    args: [d.raw_item_id, d.title, d.source_id, d.url, d.published_at, d.body] });
  await db.executeMultiple('INSERT INTO raw_item_parts VALUES(11,1); INSERT INTO signal_items VALUES(11,7),(1,7),(2,8),(99,9);');
  const pilot = readPilot(f.dir), r = await loadJevContext(db, pilot);
  assert.deepEqual([...r.bySignal.keys()].sort(), [7,8]); assert.equal(r.bySignal.get(7).length, 1);
  assert.equal(r.summary.fresh_candidates, 1);
  await db.execute("UPDATE raw_items SET title='Veranderd stuk' WHERE id=2");
  const changed = await loadJevContext(db, pilot);
  assert.equal(changed.bySignal.size, 0); assert.equal(changed.summary.stale_candidates, 1);
});
