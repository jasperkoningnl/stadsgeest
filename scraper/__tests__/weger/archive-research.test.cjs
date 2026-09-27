'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { ensureSchema } = require('../../src/archive-local.cjs');
const { SPOREN, inhoudHash, scoreKandidaat, uniekOpDocument } = require('../../src/archive-research-lib.cjs');
const { documentFromAttachment, documentFromRaw, upsertStatements } = require('../../src/archive-sync.cjs');
const { zoekSpoor } = require('../../src/archive-research.cjs');

test('documenttransformaties bewaren herkomst en maken stabiele sleutels', () => {
  const now = '2026-09-26T20:00:00.000Z';
  const item = documentFromRaw({ id: 12, source_id: 3, source_name: 'Gemeente', title: 'Tekort', body: 'Er is een tekort.', external_url: 'https://bron/12' }, now);
  const bijlage = documentFromAttachment({ id: 9, raw_item_id: 12, source_id: 3, source_name: 'Gemeente', title: 'Bijlage', body: 'Liquiditeitsprognose', url: 'https://bron/b9' }, now);
  assert.equal(item.docKey, 'item:12');
  assert.equal(bijlage.docKey, 'attachment:9');
  assert.equal(bijlage.rawItemId, 12);
  assert.equal(item.contentHash.length, 64);
});

test('onderzoeksscore beloont meerdere concrete termen en bijlagen', () => {
  const spoor = SPOREN.find((s) => s.id === 'juridisch_conflict');
  const result = scoreKandidaat(spoor, { kind: 'attachment', title: 'Aansprakelijkstelling', body: 'Na de ingebrekestelling volgde een kort geding.' });
  assert.deepEqual(result.termen, ['aansprakelijk', 'ingebrekestelling', 'kort geding']);
  assert.ok(result.score >= 7);
});

test('hoogstens één kandidaat per onderliggend raw_item blijft over', () => {
  const result = uniekOpDocument([
    { doc_key: 'attachment:1', raw_item_id: 8, inhoud_hash: inhoudHash('zelfde') },
    { doc_key: 'attachment:2', raw_item_id: 8, inhoud_hash: inhoudHash('anders') },
    { doc_key: 'item:9', raw_item_id: 9, inhoud_hash: inhoudHash('zelfde') },
    { doc_key: 'item:10', raw_item_id: 10, inhoud_hash: inhoudHash('uniek') },
  ], 10);
  assert.deepEqual(result.map((x) => x.doc_key), ['attachment:1', 'item:10']);
});

test('standaardcontractclausules worden geen juridisch archiefsignaal', () => {
  const spoor = SPOREN.find((s) => s.id === 'juridisch_conflict');
  const boiler = scoreKandidaat(spoor, {
    kind: 'attachment', title: 'Algemene voorwaarden',
    body: 'Opdrachtgever kan zonder enige aanmaning of ingebrekestelling ontbinden. Partijen aanvaarden de aansprakelijkheid volgens de algemene voorwaarden.',
  });
  assert.deepEqual(boiler.termen, []);
  const echt = scoreKandidaat(spoor, { kind: 'attachment', title: 'Conflict', body: 'De gemeente is aansprakelijk gesteld. Daarna volgde een kort geding.' });
  assert.deepEqual(echt.termen, ['aansprakelijk', 'kort geding']);
});

test('FTS-onderzoek vindt lokaal een kandidaat en slaat onveranderde historie over', async () => {
  const db = createClient({ url: 'file::memory:' });
  try {
    await ensureSchema(db);
    const doc = documentFromRaw({ id: 44, source_id: 2, source_name: 'Woo', title: 'Onderzoek contract', body: 'De gemeente is aansprakelijk gesteld. Daarna volgde een kort geding.', external_url: 'https://bron/44' }, new Date().toISOString());
    await db.batch(upsertStatements(doc), 'write');
    const spoor = SPOREN.find((s) => s.id === 'juridisch_conflict');
    const eerste = await zoekSpoor(db, spoor, 10);
    assert.equal(eerste.length, 1);
    await db.execute({
      sql: 'INSERT INTO archive_candidate_history(track,doc_key,content_hash,first_seen_at,last_seen_at) VALUES (?,?,?,?,?)',
      args: [spoor.id, doc.docKey, doc.contentHash, '2026-09-26', '2026-09-26'],
    });
    assert.equal((await zoekSpoor(db, spoor, 10)).length, 0);
  } finally {
    db.close();
  }
});
