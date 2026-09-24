// Tests voor detection-engine — Stadsgeest 2.0
// Draait met: node --test __tests__/detection-engine/engine.test.cjs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { DetectionEngine } = require('../../src/kg/detection-engine.cjs');

// Minimale mock-db voor unit tests (geen live database nodig)
function createMockDb(data = {}) {
  const events = data.events || [];
  const eventEntities = data.eventEntities || [];
  const aliases = data.aliases || [];
  const insertedSignals = [];

  return {
    insertedSignals,
    execute({ sql, args }) {
      if (sql.includes('FROM kg_events')) return { rows: events };
      if (sql.includes('FROM event_entities')) {
        const eventId = args[0];
        return { rows: eventEntities.filter(e => e.event_id === eventId) };
      }
      if (sql.includes('FROM kg_aliases')) return { rows: aliases };
      if (sql.includes('FROM signals WHERE detection_rule')) return { rows: [] };
      if (sql.includes('INSERT INTO signals')) {
        const id = insertedSignals.length + 9000;
        insertedSignals.push({ id, args });
        return { lastInsertRowid: BigInt(id) };
      }
      if (sql.includes('entity_signals')) return { rowsAffected: 1 };
      if (sql.includes('FROM entity_locations')) return { rows: [] };
      if (sql.includes('FROM entity_identifiers')) return { rows: [] };
      if (sql.includes('FROM kg_entities WHERE id')) return { rows: [{ id: args[0] }] };
      return { rows: [] };
    },
  };
}

describe('DetectionEngine', () => {

  describe('register()', () => {
    it('registreert een geldige regel', () => {
      const engine = new DetectionEngine({ dryRun: true, db: createMockDb() });
      engine.register({
        id: 'TEST1', name: 'Testregel', eventTypes: ['inspection'],
        condition: () => true,
        createSignal: () => ({ title: 'Test', summary: 'Test' }),
      });
      assert.equal(engine.rules.size, 1);
      assert.ok(engine.rules.has('TEST1'));
    });

    it('gooit fout bij ontbrekende velden', () => {
      const engine = new DetectionEngine({ dryRun: true, db: createMockDb() });
      assert.throws(() => engine.register({ name: 'Incompleet' }), /mist vereiste velden/);
    });

    it('overschrijft regel met zelfde id', () => {
      const engine = new DetectionEngine({ dryRun: true, db: createMockDb() });
      engine.register({ id: 'R1', condition: () => true, createSignal: () => ({}) });
      engine.register({ id: 'R1', condition: () => false, createSignal: () => ({}) });
      assert.equal(engine.rules.size, 1);
    });
  });

  describe('evaluate()', () => {
    it('evalueert events en matcht regels op event_type', async () => {
      const db = createMockDb({
        events: [
          { id: 1, event_type: 'inspection', source_url: 'http://x', created_at: new Date().toISOString() },
          { id: 2, event_type: 'permit', source_url: 'http://y', created_at: new Date().toISOString() },
        ],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      const conditionCalls = [];
      engine.register({
        id: 'R_INSP', name: 'Inspectie', eventTypes: ['inspection'],
        condition: (ev) => { conditionCalls.push(ev.id); return true; },
        createSignal: (ev) => ({ title: `Inspectie ${ev.id}`, summary: 'test' }),
      });
      const result = await engine.evaluate({ since: '2020-01-01' });
      assert.equal(result.evaluated, 2);
      assert.equal(result.signalsCreated, 1);
      assert.deepEqual(conditionCalls, [1]);
    });

    it('slaat event over als condition false retourneert', async () => {
      const db = createMockDb({
        events: [{ id: 1, event_type: 'inspection', source_url: 'http://x', created_at: new Date().toISOString() }],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      engine.register({
        id: 'R_NEVER', eventTypes: ['inspection'],
        condition: () => false, createSignal: () => ({ title: 'Nooit' }),
      });
      const result = await engine.evaluate({ since: '2020-01-01' });
      assert.equal(result.evaluated, 1);
      assert.equal(result.signalsCreated, 0);
    });

    it('filtert op ruleIds als opgegeven', async () => {
      const db = createMockDb({
        events: [{ id: 1, event_type: 'any', source_url: 'http://x', created_at: new Date().toISOString() }],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      engine.register({ id: 'R_A', condition: () => true, createSignal: () => ({ title: 'A' }) });
      engine.register({ id: 'R_B', condition: () => true, createSignal: () => ({ title: 'B' }) });
      const result = await engine.evaluate({ since: '2020-01-01', ruleIds: ['R_B'] });
      assert.equal(result.signalsCreated, 1);
      assert.equal(result.details[0].ruleId, 'R_B');
    });

    it('vangt fouten in regels op zonder te crashen', async () => {
      const db = createMockDb({
        events: [{ id: 1, event_type: 'any', source_url: 'http://x', created_at: new Date().toISOString() }],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      engine.register({
        id: 'R_CRASH',
        condition: () => { throw new Error('Kapot'); },
        createSignal: () => ({}),
      });
      const result = await engine.evaluate({ since: '2020-01-01' });
      assert.equal(result.evaluated, 1);
      assert.equal(result.signalsCreated, 0);
      assert.equal(result.details[0].action, 'error');
      assert.ok(result.details[0].error.includes('Kapot'));
    });

    it('schrijft signalen in niet-dryRun modus', async () => {
      const db = createMockDb({
        events: [{ id: 1, event_type: 'test', source_url: 'http://x', source_name: 'Bron', created_at: new Date().toISOString() }],
      });
      const engine = new DetectionEngine({ dryRun: false, db });
      engine.register({
        id: 'R_WRITE', eventTypes: ['test'],
        condition: () => true,
        createSignal: () => ({ title: 'Nieuw signaal', summary: 'Details', tier: 1, category: 'handhaving' }),
      });
      const result = await engine.evaluate({ since: '2020-01-01' });
      assert.equal(result.signalsCreated, 1);
      assert.equal(result.details[0].action, 'created');
      assert.equal(result.details[0].signalId, 9000);
      assert.equal(db.insertedSignals.length, 1);
    });
  });

  describe('findLocalEntities()', () => {
    it('vindt entities via alias-matching in tekst', async () => {
      const db = createMockDb({
        aliases: [
          { alias: 'Gemeente Amersfoort', normalized_alias: 'gemeente amersfoort', entity_id: 1, canonical_name: 'Gemeente Amersfoort', entity_type: 'organization' },
          { alias: 'De Alliantie', normalized_alias: 'de alliantie', entity_id: 2, canonical_name: 'Woonstichting De Alliantie', entity_type: 'organization' },
          { alias: 'ABC', normalized_alias: 'abc', entity_id: 3, canonical_name: 'ABC Corp', entity_type: 'organization' },
        ],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      const results = await engine.findLocalEntities('De gemeente Amersfoort heeft samen met De Alliantie plannen gemaakt.');
      assert.equal(results.length, 2);
      assert.equal(results[0].canonicalName, 'Gemeente Amersfoort');
      assert.equal(results[1].canonicalName, 'Woonstichting De Alliantie');
    });

    it('retourneert lege array bij lege tekst', async () => {
      const engine = new DetectionEngine({ dryRun: true, db: createMockDb() });
      assert.deepEqual(await engine.findLocalEntities(''), []);
      assert.deepEqual(await engine.findLocalEntities(null), []);
    });

    it('vindt elke entity maar een keer', async () => {
      const db = createMockDb({
        aliases: [
          { alias: 'Meander Medisch Centrum', normalized_alias: 'meander medisch centrum', entity_id: 5, canonical_name: 'Meander MC', entity_type: 'organization' },
          { alias: 'Meander', normalized_alias: 'meander', entity_id: 5, canonical_name: 'Meander MC', entity_type: 'organization' },
        ],
      });
      const engine = new DetectionEngine({ dryRun: true, db });
      const results = await engine.findLocalEntities('Het Meander Medisch Centrum, ook wel Meander, opent een afdeling.');
      assert.equal(results.length, 1);
    });
  });

  describe('isLocallyRelevant()', () => {
    it('retourneert true als entity een source_person/org_id heeft', async () => {
      const engine = new DetectionEngine({ dryRun: true, db: createMockDb() });
      const result = await engine.isLocallyRelevant(1);
      assert.equal(result, true);
    });
  });
});
