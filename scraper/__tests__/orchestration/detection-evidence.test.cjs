const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DetectionEngine } = require('../../src/kg/detection-engine.cjs');

describe('DetectionEngine bewijsbrug', () => {
  it('maakt één raw_item en koppelt dat idempotent aan het signaal', async () => {
    let rawItemId = null;
    const rawWrites = [];
    const links = new Set();
    const db = {
      async execute({ sql, args }) {
        if (sql.includes('SELECT id FROM raw_items')) return { rows: rawItemId ? [{ id: rawItemId }] : [] };
        if (sql.includes('INSERT OR IGNORE INTO raw_items')) {
          rawItemId = 7001;
          rawWrites.push(args);
          return { rows: [], lastInsertRowid: rawItemId };
        }
        if (sql.includes('INSERT OR IGNORE INTO signal_items')) {
          links.add(`${args[0]}:${args[1]}`);
          return { rows: [] };
        }
        throw new Error(`Onverwachte testquery: ${sql}`);
      },
    };
    const event = {
      id: 6,
      event_type: 'ASBESTOS_VIOLATION_PUBLISHED',
      source_id: 138,
      source_url: 'https://asbestovertredingen.nlarbeidsinspectie.nl/overtredingen/test',
      source_identifier: 'test',
      title: 'Asbestovertreding: Testbedrijf',
      summary: 'Officiële broninformatie',
      fetched_at: '2026-09-12T08:00:00Z',
      provenance: '{}',
    };
    const engine = new DetectionEngine({ db, dryRun: false });
    assert.equal(await engine.linkEvidenceForSignal(2230, event), 7001);
    assert.equal(await engine.linkEvidenceForSignal(2230, event), 7001);
    assert.equal(rawWrites.length, 1);
    assert.deepEqual([...links], ['2230:7001']);
  });
});
