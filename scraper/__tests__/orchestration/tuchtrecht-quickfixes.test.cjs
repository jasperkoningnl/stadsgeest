// Regressietests voor de tuchtrecht-quickfixes:
// - planning (minimumHours 144) in de ADAPTERS-array
// - eventtypes in R3_NATIONAL_SANCTION
// - vaste identiteit R1–R16

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ADAPTERS, isDueAt } = require('../../src/kg/detection-run.cjs');
const {
  R3_NATIONAL_SANCTION, RULE_IDENTITIES,
} = require('../../src/kg/detection-rules.cjs');

describe('tuchtrecht planning', () => {
  it('heeft een schedule met sourceName en minimumHours 144', () => {
    const entry = ADAPTERS.find(([name]) => name === 'tuchtrecht');
    assert.ok(entry, 'tuchtrecht ontbreekt in ADAPTERS');
    const schedule = entry[2];
    assert.ok(schedule, 'tuchtrecht heeft geen schedule-object');
    assert.equal(schedule.sourceName, 'Open Data Tuchtrecht');
    assert.equal(schedule.minimumHours, 144);
  });

  it('isDueAt blokkeert bij een recente run binnen 144 uur', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    // 100 uur geleden: niet due (100 < 144)
    const recent = new Date(now - 100 * 3600000).toISOString();
    assert.equal(isDueAt(recent, 144, now), false);
  });

  it('isDueAt laat door bij een run ouder dan 144 uur', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    // 145 uur geleden: due (145 >= 144)
    const old = new Date(now - 145 * 3600000).toISOString();
    assert.equal(isDueAt(old, 144, now), true);
  });

  it('isDueAt laat door als er geen eerdere run is', () => {
    assert.equal(isDueAt(null, 144), true);
  });
});

describe('tuchtrecht eventtypes in R3', () => {
  it('R3 bevat DISCIPLINARY_RULING_PUBLISHED', () => {
    assert.ok(
      R3_NATIONAL_SANCTION.eventTypes.includes('DISCIPLINARY_RULING_PUBLISHED'),
      'DISCIPLINARY_RULING_PUBLISHED ontbreekt in R3',
    );
  });

  it('R3 bevat DISCIPLINARY_MEASURE_IMPOSED', () => {
    assert.ok(
      R3_NATIONAL_SANCTION.eventTypes.includes('DISCIPLINARY_MEASURE_IMPOSED'),
      'DISCIPLINARY_MEASURE_IMPOSED ontbreekt in R3',
    );
  });

  it('R3 behoudt de bestaande ACM/AP/asbest/SEVESO-eventtypes', () => {
    const verwacht = [
      'ACM_SANCTION_PUBLISHED', 'ACM_DECISION_PUBLISHED',
      'AP_SANCTION_PUBLISHED', 'AP_ORDER_PUBLISHED',
      'INSPECTION_VIOLATION', 'ASBESTOS_VIOLATION_PUBLISHED', 'ASBESTOS_WORK_STOPPED',
      'SEVESO_INSPECTION_PUBLISHED', 'SEVESO_VIOLATION_RECORDED',
    ];
    for (const type of verwacht) {
      assert.ok(R3_NATIONAL_SANCTION.eventTypes.includes(type), `${type} ontbreekt in R3`);
    }
  });
});

describe('R3 veiligheidsgrens: entity-koppeling vereist', () => {
  // Mock-context met db die lokale entity_locations vindt
  function mockDb(hasLocal) {
    return {
      async execute({ sql }) {
        if (sql.includes('entity_locations')) {
          return { rows: hasLocal ? [{ city: 'Amersfoort' }] : [] };
        }
        if (sql.includes('kg_entities')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }

  it('accepteert een tuchtrechtevent met gekoppelde lokale entiteit', async () => {
    const event = {
      id: 1,
      event_type: 'DISCIPLINARY_RULING_PUBLISHED',
      title: 'Tuchtuitspraak accountant',
      summary: 'Maatregel opgelegd',
    };
    const context = {
      entities: [{ entity_id: 42, entity_type: 'organization', canonical_name: 'Kantoor BV' }],
      db: mockDb(true),
    };
    const result = await R3_NATIONAL_SANCTION.condition(event, context);
    assert.equal(result, true);
  });

  it('wijst een tuchtrechtevent zonder entities af', async () => {
    const event = {
      id: 2,
      event_type: 'DISCIPLINARY_MEASURE_IMPOSED',
      title: 'Tuchtmaatregel',
    };
    const context = { entities: [], db: mockDb(false) };
    const result = await R3_NATIONAL_SANCTION.condition(event, context);
    assert.equal(result, false);
  });

  it('wijst een tuchtrechtevent met niet-lokale entiteit af (plaatsnaam-only)', async () => {
    const event = {
      id: 3,
      event_type: 'DISCIPLINARY_RULING_PUBLISHED',
      title: 'Tuchtuitspraak met plaatsnaam Amsterdam',
    };
    const context = {
      entities: [{ entity_id: 99, entity_type: 'organization', canonical_name: 'Extern BV' }],
      db: mockDb(false), // geen lokale entity_locations, geen source_person/org_id
    };
    const result = await R3_NATIONAL_SANCTION.condition(event, context);
    assert.equal(result, false);
  });
});

describe('R1–R16 identiteiten intact', () => {
  it('bevat exact R1 t/m R16 in de juiste volgorde', () => {
    const keys = Object.keys(RULE_IDENTITIES);
    assert.deepEqual(keys, Array.from({ length: 16 }, (_, i) => `R${i + 1}`));
  });

  it('vaste namen ongewijzigd', () => {
    assert.equal(RULE_IDENTITIES.R1, 'Bedrijfsuitbreiding via vergunning');
    assert.equal(RULE_IDENTITIES.R2, 'Bestuurdersnetwerk-verandering');
    assert.equal(RULE_IDENTITIES.R3, 'Landelijke sanctie lokaal bedrijf');
    assert.equal(RULE_IDENTITIES.R4, 'Lokale persoon in externe bron');
    assert.equal(RULE_IDENTITIES.R5, 'Robuuste anomalie geregistreerde misdrijven');
    assert.equal(RULE_IDENTITIES.R6, 'Kinderopvang inspectie-tekortkoming');
    assert.equal(RULE_IDENTITIES.R7, 'Grote of terugkerende netwerkstoring');
    assert.equal(RULE_IDENTITIES.R8, 'Veelgevraagde lokale spreker of maker');
    assert.equal(RULE_IDENTITIES.R9, 'Organisatieverandering uit registerdiff');
    assert.equal(RULE_IDENTITIES.R10, 'Multi-source versterking');
    assert.equal(RULE_IDENTITIES.R11, 'Opvallende ontwikkeling leerlingaantal');
    assert.equal(RULE_IDENTITIES.R12, 'Opvallende ontwikkeling schoolprognose');
    assert.equal(RULE_IDENTITIES.R13, 'Betekenisvolle wijziging Onderwijsinspectie');
    assert.equal(RULE_IDENTITIES.R14, 'Grote lokale verkeersmaatregel');
    assert.equal(RULE_IDENTITIES.R15, 'Materiële jaar-op-jaarverandering zorg');
    assert.equal(RULE_IDENTITIES.R16, 'Materiële jaar-op-jaarverandering woningcorporatieplan');
  });
});
