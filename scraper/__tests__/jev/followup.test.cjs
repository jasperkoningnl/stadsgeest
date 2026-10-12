'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const lib = require('../../src/jev-followup-lib.cjs');
const v1 = require('../../src/jev-experiment-lib.cjs');
function doc(place = 'Amersfoort', caseId = '123456', agenda = 'Project Bovenduist') {
  return { doc_key: place + caseId, title: 'Raad ' + place + ': Project Bovenduist', source_name: 'Raad ' + place,
    url: 'https://api.notubiz.nl/document/' + (place === 'Amersfoort' ? '100' : '200') + '/1',
    body: `Gemeenteraad ${place} - Commissie Omgeving\nVergaderdatum: 2026-10-07\nAgendapunt: 7. ${agenda}\nSoort document: Raadsvoorstel\n\nZaaknummer ${caseId} Aanleiding Een woningbouwproject met een nieuwe ontsluitingsweg.` };
}
test('zaakkenmerken worden binnen dezelfde overheid gebruikt; agendapunt is geen zaakidentiteit', () => {
  const a = doc(), b = { ...doc(), url: 'https://api.notubiz.nl/document/101/1' };
  assert.equal(lib.structuralBaseline(a, b).relation, 'same_case');
  const other = doc('Leusden'); assert.notEqual(lib.structuralBaseline(a, other).relation, 'same_case');
  const differentCase = { ...doc('Amersfoort', '654321'), url: 'https://api.notubiz.nl/document/102/1' };
  assert.equal(lib.structuralBaseline(a, differentCase).relation, 'same_dossier');
});
test('algemene agendapunten verbinden niet alle stukken met elkaar', () => {
  for (const agenda of ['Actualiteiten', 'Termijnagenda B&E', 'Ontvangen berichten', 'Vaststellen besluitenlijst gemeenteraad']) {
    assert.equal(lib.metadata(doc('Amersfoort', '123456', agenda)).agenda_key, null);
  }
});
test('identiteit van bronstuk is apart van identiteit van bestuurlijke zaak', () => {
  const a = { ...doc(), body: 'Een bronrapport zonder zaakkenmerk. '.repeat(20) };
  const b = { ...a, doc_key: 'second', url: 'https://amersfoort.notubiz.nl/document/100/2/titel' };
  const result = lib.structuralBaseline(a, b);
  assert.equal(result.document, 'same_document'); assert.equal(result.relation, 'insufficient');
  assert.equal(lib.documentKey('https://example.org/document/100/1'), null);
});
test('relevante passage wordt voorbij de eerste 1100 tekens gevonden, met controleerbare posities', () => {
  const a = { ...doc(), body: 'Aanleiding Algemeen beleid zonder projectverwijzing. '.repeat(80) + ' Het UPLG wordt gefinancierd uit dit programma. ' + 'Algemene overige tekst. '.repeat(80) };
  const b = { ...doc(), title: 'Utrechts Programma Landelijk Gebied UPLG', body: 'Het UPLG is het provinciale programma.' };
  const selected = lib.passages(a, b, 'selected');
  assert.ok(selected.some(p => p.start > 1100 && p.text.includes('UPLG')));
  assert.ok(selected.every(p => p.text === lib.redact(lib.norm(a.body).slice(p.start, p.end))));
  assert.ok(lib.passages(a, b, 'short').every(p => !p.text.includes('UPLG')));
});
test('redactie behoudt datums en verwijdert internationale en gespatieerde lokale telefoons', () => {
  const text = lib.redact('2026-10-07 en 03-02-2026. +31 88 348 20 00 of 088 878 1000. test @example.nl');
  assert.ok(text.includes('2026-10-07')); assert.ok(text.includes('03-02-2026'));
  assert.ok(!text.includes('348 20')); assert.ok(!text.includes('878 1000')); assert.ok(!text.includes('@example'));
});
test('AI-referentie en verwachte uitkomst worden niet aan Jev meegegeven', () => {
  const p = { a: doc(), b: doc('Leusden'), reference: 'GEHEIME_REFERENTIE', baseline: { relation: 'VERWACHTE_UITKOMST' } };
  const request = lib.requestFor(p);
  assert.ok(!JSON.stringify(request).includes('GEHEIME_REFERENTIE'));
  assert.ok(!JSON.stringify(request).includes('VERWACHTE_UITKOMST'));
  assert.deepEqual(Object.keys(lib.requestFor(p, 'selected', true).questions.relation.criteria), Object.keys(lib.RELATIONS).reverse());
});
test('vervolgproef deelt budget met eerste proef, inclusief onzekere aanroepen', () => {
  const old = [{ status: 'ok', result: { cost_usd: 0.5 } }], next = [{ status: 'unresolved' }];
  assert.equal(v1.canReserve([...old, ...next], 0.501), false);
});
test('modelafwijzing kan bronstructuur niet stilzwijgend weggooien; proef doet geen merges', () => {
  const pair = { id: 'pair', a: doc(), b: { ...doc('Amersfoort', '654321'), url: 'https://api.notubiz.nl/document/101/1' } };
  const result = { answers: { relation: { choice: 'no_link', confidence: 0.95 }, document: { choice: 'different_documents' }, content_evidence: { noul: 0.1 } } };
  const proposal = lib.propose(pair, result);
  assert.equal(proposal.state, 'candidate'); assert.equal(proposal.relation, 'same_dossier');
  assert.ok(proposal.flags.includes('model_disagrees_with_structure'));
  assert.equal(proposal.confirmed, false); assert.equal(proposal.merge_allowed, false); assert.equal(proposal.review_required, true);
});
test('vervolgrespons faalt bij modeldrift, verkeerd tokengebruik of onbekende labels', () => {
  const choice = labels => ({ type: 'choice', choice: Object.keys(labels)[0], confidence: 1,
    probabilities: Object.fromEntries(Object.keys(labels).map((k, i) => [k, i ? 0 : 1])) });
  const response = () => ({ model: v1.MODEL, usage: { input_tokens: 1000 }, answers: {
    relation: choice(lib.RELATIONS), document: choice(lib.DOCUMENTS), content_evidence: { type: 'noul', noul: 0.9 } } });
  assert.equal(lib.validate(response()).cost_usd, 1000 * v1.PRICE);
  for (const mutate of [r => r.model = 'jev-latest', r => r.usage.input_tokens = NaN,
    r => r.answers.relation.choice = 'unknown', r => r.answers.content_evidence.noul = 1.1,
    r => r.answers.document.probabilities.same_document = 0.2]) {
    const r = response(); mutate(r); assert.throws(() => lib.validate(r));
  }
});
