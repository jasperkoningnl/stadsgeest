// Tests voor entity-resolver merge-logica — Stadsgeest 2.0
// Draait met: node --test __tests__/entity-resolution/merge.test.cjs
// Gebruikt de live Turso-database (read-only tests, geen mutaties)
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { EntityResolver } = require('../../src/kg/entity-resolver.cjs');

let resolver;

before(() => {
  resolver = new EntityResolver({ dryRun: true });
});

describe('EntityResolver.resolve — bestaande organisaties', () => {
  it('vindt Gemeente Amersfoort op exacte naam', async () => {
    const result = await resolver.resolve({
      name: 'Gemeente Amersfoort',
      entityType: 'organization',
    });
    assert.ok(result.match, 'Verwacht een match');
    assert.ok(result.score >= 35, `Score ${result.score} moet >= 35 (EXACT_NAME)`);
  });

  it('vindt Meander via alias "MMC"', async () => {
    const result = await resolver.resolve({
      name: 'MMC',
      entityType: 'organization',
    });
    assert.ok(result.match, 'Verwacht een match op alias MMC');
  });

  it('vindt De Alliantie via alias "Alliantie"', async () => {
    const result = await resolver.resolve({
      name: 'Alliantie',
      entityType: 'organization',
    });
    assert.ok(result.match, 'Verwacht een match op alias Alliantie');
  });

  it('vindt Gemeente via KvK-nummer', async () => {
    const result = await resolver.resolve({
      name: 'Onbekende naam',
      entityType: 'organization',
      identifiers: [{ type: 'kvk', value: '25544365' }],
    });
    assert.ok(result.match, 'Verwacht een match op KvK');
    assert.ok(result.score >= 100, `Score ${result.score} moet >= 100 (EXACT_IDENTIFIER)`);
    assert.equal(result.action, 'auto_merge');
  });
});

describe('EntityResolver.resolve — personen', () => {
  it('vindt persoon op exacte naam maar mergt niet automatisch', async () => {
    const result = await resolver.resolve({
      name: 'Lucas Bolsius',
      entityType: 'person',
    });
    assert.ok(result.match, 'Verwacht een match');
    // Persoon met alleen naammatch mag nooit auto_merge zijn
    assert.notEqual(result.action, 'auto_merge',
      'Personen mogen niet auto-mergen op naam alleen');
  });
});

describe('EntityResolver.resolve — onbekende entiteit', () => {
  it('geeft create-actie voor onbekende organisatie', async () => {
    const result = await resolver.resolve({
      name: 'Totaal Onbekend Bedrijf XYZ 999',
      entityType: 'organization',
    });
    assert.equal(result.action, 'create');
    assert.equal(result.match, null);
  });
});

describe('EntityResolver._determineAction', () => {
  it('organisatie: score 100 → auto_merge', () => {
    assert.equal(resolver._determineAction(100, 'organization'), 'auto_merge');
  });

  it('organisatie: score 75 → review', () => {
    assert.equal(resolver._determineAction(75, 'organization'), 'review');
  });

  it('organisatie: score 50 → create', () => {
    assert.equal(resolver._determineAction(50, 'organization'), 'create');
  });

  it('persoon: score 100 → review (niet auto_merge!)', () => {
    assert.equal(resolver._determineAction(100, 'person'), 'review');
  });

  it('persoon: score 110 → auto_merge', () => {
    assert.equal(resolver._determineAction(110, 'person'), 'auto_merge');
  });

  it('persoon: score 35 → create (naam alleen)', () => {
    assert.equal(resolver._determineAction(35, 'person'), 'create');
  });
});
