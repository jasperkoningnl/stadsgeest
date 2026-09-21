// Migratie-verificatietests — Stadsgeest 2.0
// Controleert dat alle M1-M5 tabellen en kolommen bestaan en correct gevuld zijn.
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

describe('M4b: handmatige seed- en mergeprovenance', () => {
  for (const table of ['manual_entity_seeds', 'entity_merge_audits', 'bag_match_exceptions']) {
    it(`${table} bestaat`, async () => assert.ok((await getColumns(table)).length > 0));
  }

  it('kernseeds hebben bron, reden en reviewdatum', async () => {
    const invalid = await db.execute(`SELECT COUNT(*) n FROM manual_entity_seeds
      WHERE source_url NOT LIKE 'https://%' OR reason IS NULL OR length(reason)<20 OR review_due_at IS NULL`);
    assert.equal(Number(invalid.rows[0].n), 0);
    assert.ok(await getCount('manual_entity_seeds') >= 6);
  });
});

describe('M5: fase-3-provenance en backtests', () => {
  it('sources heeft controlevelden en alle fase-3-tabellen bestaan', async () => {
    const sourceColumns = await getColumns('sources');
    for (const column of ['last_verified_at', 'terms_checked_at', 'owner_contact']) assert.ok(sourceColumns.includes(column));
    for (const table of ['source_snapshots', 'statistical_baselines', 'area_versions', 'phase3_backtests']) {
      assert.ok((await getColumns(table)).length > 0, `${table} ontbreekt`);
    }
  });

  it('fase-3-bronnen hebben een baseline en succesvolle run', async () => {
    const names = ['Onderwijsinspectie — kwaliteitsoordelen', 'KOOP — niet-gemeentelijke officiële publicaties',
      'AFM — register financiële dienstverleners', 'DNB — openbaar register',
      'Politie/CBS — geregistreerde misdrijven per buurt', 'NDW — wegwerkzaamheden en evenementen', 'RVO — Projectendatabase'];
    for (const name of names) {
      const result = await db.execute({ sql: `SELECT s.id,
        EXISTS(SELECT 1 FROM source_records sr WHERE sr.source_id=s.id AND sr.source_key='__baseline_complete__') baseline,
        EXISTS(SELECT 1 FROM fetch_runs fr WHERE fr.source_id=s.id AND fr.status='ok') successful_run
        FROM sources s WHERE s.name=?`, args: [name] });
      assert.equal(result.rows.length, 1, `${name} ontbreekt`);
      assert.equal(Number(result.rows[0].baseline), 1, `${name} heeft geen baseline`);
      assert.equal(Number(result.rows[0].successful_run), 1, `${name} heeft geen succesvolle run`);
    }
  });

  it('beide fase-3-backtests beslaan minimaal 24 maanden', async () => {
    for (const testName of ['politie-r5', 'eventclusters-r10']) {
      const result = await db.execute({ sql: 'SELECT MAX(months) months FROM phase3_backtests WHERE test_name=?', args: [testName] });
      assert.ok(Number(result.rows[0].months) >= 24, `${testName} mist 24 maanden`);
    }
  });
});

describe('M6: fase-4-audit en jaar-op-jaarbacktests', () => {
  for (const table of ['phase4_backtests', 'phase4_source_audits']) {
    it(`${table} bestaat`, async () => { assert.ok((await getColumns(table)).length > 0); });
  }

  it('beide fase-4-jaarparen zijn reproduceerbaar vastgelegd', async () => {
    for (const [name, from, to] of [['zorg-r15', 2023, 2024], ['dpi-r16', 2024, 2025]]) {
      const result = await db.execute({ sql: `SELECT * FROM phase4_backtests WHERE test_name=? ORDER BY created_at DESC LIMIT 1`, args: [name] });
      assert.equal(result.rows.length, 1, `${name} ontbreekt`);
      assert.ok(Number(result.rows[0].period_from) <= from && Number(result.rows[0].period_to) >= to);
      assert.ok(Number(result.rows[0].input_count) > 0);
    }
  });
});

describe('M7: fase-5-leerloop', () => {
  it('feedback heeft idempotentie, dimensie en bevroren attributie', async () => {
    const columns = await getColumns('tip_feedback');
    for (const column of ['request_id','verdict','dimension','feedback_schema_version','duplicate_of']) assert.ok(columns.includes(column));
    const orphan = await db.execute(`SELECT COUNT(*) n FROM tip_feedback tf LEFT JOIN editorial_feedback_contexts c ON c.feedback_id=tf.id WHERE c.feedback_id IS NULL`);
    assert.equal(Number(orphan.rows[0].n), 0);
  });

  it('uitkomsten en evaluaties hebben additieve tabellen', async () => {
    for (const table of ['editorial_outcomes','tip_outcomes','editorial_outcome_events','phase5_evaluations','phase5_review_cycles','phase5_review_events','phase5_calibration_proposals','phase5_retention_runs']) {
      assert.ok((await getColumns(table)).length > 0, `${table} ontbreekt`);
    }
  });

  it('een gepubliceerd artikel kan maar eenmaal meetellen', async () => {
    const duplicates = await db.execute(`SELECT normalized_url,COUNT(*) n FROM editorial_outcomes GROUP BY normalized_url HAVING COUNT(*)>1`);
    assert.equal(duplicates.rows.length, 0);
    const missing = await db.execute(`SELECT COUNT(*) n FROM editorial_outcomes WHERE status='published' AND without_stadsgeest NOT IN (0,1)`);
    assert.equal(Number(missing.rows[0].n), 0);
  });

  it('geen kalibratie is zonder bewijs en menselijke goedkeuring toegepast', async () => {
    const invalid = await db.execute(`SELECT COUNT(*) n FROM phase5_calibration_proposals WHERE status='applied'
      AND (sample_size<minimum_sample OR monthly_cycles<2 OR approved_by IS NULL OR approved_at IS NULL)`);
    assert.equal(Number(invalid.rows[0].n), 0);
  });
});

describe('M8: fase-1-golden-setbeoordeling', () => {
  for (const table of ['phase1_golden_candidates', 'phase1_golden_reviews']) {
    it(`${table} bestaat`, async () => assert.ok((await getColumns(table)).length > 0));
  }

  it('heeft minimaal 200 brononderbouwde automatische matches', async () => {
    const result = await db.execute(`SELECT COUNT(*) n FROM phase1_golden_candidates
      WHERE identifier_type IN ('kvk','rsin','lei') AND evidence_url LIKE 'https://%'`);
    assert.ok(Number(result.rows[0].n) >= 200);
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
