// Migratie-verificatietests — Stadsgeest 2.0
// Controleert dat alle M1-M4 tabellen en kolommen bestaan en correct gevuld zijn.
// Draait met: node --test __tests__/migrations/verify-schema.test.cjs
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');

let db;

before(() => {
  db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
});

async function getColumns(table) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.map(row => row.name);
}

async function getCount(table) {
  const r = await db.execute(`SELECT COUNT(*) as n FROM ${table}`);
  return Number(r.rows[0].n);
}

describe('M1: kolommen op bestaande tabellen', () => {
  it('sources heeft source_class, adapter_version, source_manifest', async () => {
    const cols = await getColumns('sources');
    assert.ok(cols.includes('source_class'), 'source_class ontbreekt');
    assert.ok(cols.includes('adapter_version'), 'adapter_version ontbreekt');
    assert.ok(cols.includes('source_manifest'), 'source_manifest ontbreekt');
  });

  it('signals heeft detection_rule, provenance', async () => {
    const cols = await getColumns('signals');
    assert.ok(cols.includes('detection_rule'), 'detection_rule ontbreekt');
    assert.ok(cols.includes('provenance'), 'provenance ontbreekt');
  });

  it('raw_items heeft raw_hash, semantic_hash', async () => {
    const cols = await getColumns('raw_items');
    assert.ok(cols.includes('raw_hash'), 'raw_hash ontbreekt');
    assert.ok(cols.includes('semantic_hash'), 'semantic_hash ontbreekt');
  });
});

describe('M2: entity-tabellen bestaan en hebben juiste kolommen', () => {
  it('kg_entities', async () => {
    const cols = await getColumns('kg_entities');
    for (const c of ['id', 'entity_type', 'canonical_name', 'normalized_name', 'source_person_id', 'source_org_id', 'merged_into_id']) {
      assert.ok(cols.includes(c), `kg_entities.${c} ontbreekt`);
    }
  });

  it('entity_identifiers', async () => {
    const cols = await getColumns('entity_identifiers');
    for (const c of ['id', 'entity_id', 'identifier_type', 'value']) {
      assert.ok(cols.includes(c), `entity_identifiers.${c} ontbreekt`);
    }
  });

  it('kg_aliases', async () => {
    const cols = await getColumns('kg_aliases');
    for (const c of ['id', 'entity_id', 'alias', 'normalized_alias', 'match_mode', 'score_weight']) {
      assert.ok(cols.includes(c), `kg_aliases.${c} ontbreekt`);
    }
  });

  it('locations', async () => {
    const cols = await getColumns('locations');
    for (const c of ['id', 'label', 'city', 'bag_id', 'lat', 'lon']) {
      assert.ok(cols.includes(c), `locations.${c} ontbreekt`);
    }
  });

  it('entity_locations', async () => {
    const cols = await getColumns('entity_locations');
    for (const c of ['id', 'entity_id', 'location_id', 'relation_type']) {
      assert.ok(cols.includes(c), `entity_locations.${c} ontbreekt`);
    }
  });
});

describe('M3: relatie- en event-tabellen bestaan', () => {
  for (const table of ['kg_relations', 'kg_events', 'event_entities', 'source_records', 'fetch_runs', 'entity_merge_candidates']) {
    it(`${table} bestaat`, async () => {
      const cols = await getColumns(table);
      assert.ok(cols.length > 0, `${table} heeft geen kolommen`);
    });
  }
});

describe('M4: data-seed is uitgevoerd', () => {
  it('kg_entities bevat personen en organisaties', async () => {
    const persons = await db.execute("SELECT COUNT(*) as n FROM kg_entities WHERE entity_type='person'");
    const orgs = await db.execute("SELECT COUNT(*) as n FROM kg_entities WHERE entity_type='organization'");
    assert.ok(Number(persons.rows[0].n) >= 100, `Verwacht >= 100 personen, kreeg ${persons.rows[0].n}`);
    assert.ok(Number(orgs.rows[0].n) >= 30, `Verwacht >= 30 organisaties, kreeg ${orgs.rows[0].n}`);
  });

  it('kg_aliases bevat gemigreerde aliassen', async () => {
    const n = await getCount('kg_aliases');
    assert.ok(n >= 400, `Verwacht >= 400 aliassen, kreeg ${n}`);
  });

  it('kg_relations bevat gemigreerde rollen', async () => {
    const n = await getCount('kg_relations');
    assert.ok(n >= 100, `Verwacht >= 100 relaties, kreeg ${n}`);
  });

  it('entity_identifiers bevat handmatige seeds', async () => {
    const n = await getCount('entity_identifiers');
    assert.ok(n >= 20, `Verwacht >= 20 identifiers, kreeg ${n}`);
  });
});

describe('Integriteit', () => {
  it('geen kg_entities zonder type', async () => {
    const r = await db.execute("SELECT COUNT(*) as n FROM kg_entities WHERE entity_type IS NULL");
    assert.equal(Number(r.rows[0].n), 0);
  });

  it('geen kg_aliases zonder entity_id die bestaat', async () => {
    const r = await db.execute(`
      SELECT COUNT(*) as n FROM kg_aliases ka
      LEFT JOIN kg_entities ke ON ke.id = ka.entity_id
      WHERE ke.id IS NULL
    `);
    assert.equal(Number(r.rows[0].n), 0, 'Weesaliassen gevonden');
  });

  it('geen kg_relations naar niet-bestaande entities', async () => {
    const r = await db.execute(`
      SELECT COUNT(*) as n FROM kg_relations kr
      LEFT JOIN kg_entities s ON s.id = kr.subject_id
      LEFT JOIN kg_entities o ON o.id = kr.object_id
      WHERE s.id IS NULL OR o.id IS NULL
    `);
    assert.equal(Number(r.rows[0].n), 0, 'Weesrelaties gevonden');
  });
});
