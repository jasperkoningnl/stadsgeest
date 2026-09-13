const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isDueAt, summarizeRun, parseOptions } = require('../../src/kg/detection-run.cjs');
const { DetectionEngine, sourceUrlFallback } = require('../../src/kg/detection-engine.cjs');

describe('detection-run orchestration', () => {
  it('normaliseert de verschillende adapterresultaten voor fetch_runs', () => {
    assert.deepEqual(summarizeRun({ total: 72, created: 2, updated: 1 }), {
      recordsFound: 72,
      recordsNew: 2,
      recordsChanged: 1,
      recordsRemoved: 0,
    });
    assert.deepEqual(summarizeRun({ lokaal: 5, events: 3, skipped: 7 }), {
      recordsFound: 12,
      recordsNew: 3,
      recordsChanged: 0,
      recordsRemoved: 0,
    });
  });

  it('leest selectie, terugkijkvenster en dry-run uit de CLI', () => {
    const options = parseOptions(['--dry-run', '--days=5', '--adapters=liander,lrk']);
    assert.equal(options.dryRun, true);
    assert.equal(options.days, 5);
    assert.deepEqual([...options.adapterNames], ['liander', 'lrk']);
  });

  it('respecteert broncadans maar laat een ontbrekende of oude run opnieuw toe', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    assert.equal(isDueAt(null, 24, now), true);
    assert.equal(isDueAt('2026-09-13T00:00:00Z', 20, now), false);
    assert.equal(isDueAt('2026-09-12T12:00:00Z', 20, now), true);
  });

  it('dedupliceert een feeditem op officiële identifier en niet op de gedeelde feed-URL', () => {
    assert.equal(sourceUrlFallback({ source_url: 'https://bron/feed', source_identifier: 'item-1' }), null);
    assert.equal(sourceUrlFallback({ source_url: 'https://bron/los-item' }), 'https://bron/los-item');
  });

  it('telt een al verwerkt event niet opnieuw als signaal of bevestiging', async () => {
    const writes = [];
    const db = {
      async execute({ sql }) {
        if (sql.includes('FROM kg_events')) return { rows: [{ id: 77, event_type: 'TEST', source_url: 'https://bron/77' }] };
        if (sql.includes('FROM event_entities')) return { rows: [] };
        if (sql.includes('FROM signals')) return { rows: [{ id: 901 }] };
        writes.push(sql);
        return { rows: [] };
      },
    };
    const engine = new DetectionEngine({ db, dryRun: false });
    engine.register({
      id: 'R_TEST',
      eventTypes: ['TEST'],
      condition: () => true,
      createSignal: () => ({ title: 'Bestaat al' }),
    });
    const result = await engine.evaluate({ since: '2020-01-01' });
    assert.equal(result.signalsCreated, 0);
    assert.equal(result.details[0].action, 'existing');
    assert.deepEqual(writes, []);
  });
});
