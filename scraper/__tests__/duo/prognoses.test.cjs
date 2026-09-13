const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  METADATA_URL,
  DuoPrognosesAdapter,
  assessForecastRealization,
  assessForecastRevision,
  assessForecastTrend,
  fullVestigingscode,
  normalizeForecastRows,
  parseCommaCsv,
  selectForecastResource,
} = require('../../src/kg/adapters/duo-prognoses.cjs');
const { R12_SCHOOL_FORECAST } = require('../../src/kg/detection-rules.cjs');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, '../fixtures/duo-prognoses', name), 'utf8');
}

function jsonFixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', relativePath), 'utf8'));
}

function fakeResponse(body, json = false) {
  return {
    ok: true,
    status: 200,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    async json() { return json ? body : JSON.parse(body); },
  };
}

function createFakeDb() {
  let sourceId = null;
  let nextRecordId = 1;
  let nextEventId = 1;
  const latestRecords = new Map();
  const eventIdentifiers = new Set();
  const writes = [];
  return {
    writes,
    async execute(query) {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args || []);
      if (/SELECT id FROM sources WHERE name/.test(sql)) {
        return { rows: sourceId ? [{ id: sourceId }] : [] };
      }
      if (/INSERT INTO sources/.test(sql)) {
        sourceId = 88;
        writes.push({ type: 'source' });
        return { rows: [], lastInsertRowid: sourceId };
      }
      if (/FROM source_records sr/.test(sql)) {
        return { rows: [...latestRecords.values()] };
      }
      if (/INSERT INTO source_records/.test(sql)) {
        const row = {
          id: nextRecordId++,
          source_key: args[1],
          raw_object: args[2],
          content_hash: args[3],
          semantic_hash: args[4],
          change_type: args.length === 6 ? args[5] : args[6],
        };
        latestRecords.set(row.source_key, row);
        writes.push({ type: 'record', sourceKey: row.source_key });
        return { rows: [], lastInsertRowid: row.id };
      }
      if (/SELECT entity_id FROM entity_identifiers/.test(sql)) {
        return { rows: [{ entity_id: 501 }] };
      }
      if (/SELECT id FROM kg_events/.test(sql)) {
        return { rows: eventIdentifiers.has(args[1]) ? [{ id: 1 }] : [] };
      }
      if (/INSERT INTO kg_events/.test(sql)) {
        const id = nextEventId++;
        eventIdentifiers.add(args[7]);
        writes.push({ type: 'event', eventType: args[0], sourceIdentifier: args[7] });
        return { rows: [], lastInsertRowid: id };
      }
      if (/^(\s*)(UPDATE|INSERT OR IGNORE)/.test(sql)) return { rows: [] };
      throw new Error(`Onverwachte testquery: ${sql}`);
    },
  };
}

function forecastRecord(values, version = '2026-07-03') {
  return {
    naam: 'Testschool',
    vestigingscode: 'TEST00',
    forecastVersion: version,
    forecasts: values.map(([year, pupils]) => ({ year, pupils })),
  };
}

describe('DUO prognoses — officieel schema en normalisatie', () => {
  it('selecteert de actuele officiële resource en versie', () => {
    const resource = selectForecastResource(JSON.parse(fixture('metadata.json')));
    assert.equal(resource.id, 'f27c0d5c-59a0-41b9-b23f-f3a7ee03d4ba');
    assert.equal(resource.version, '2026-07-03');
    assert.equal(resource.totalRecords, 127140);
  });

  it('leest decimale prognoses en koppelt suffix aan de volledige vestigingscode', () => {
    const rows = parseCommaCsv(fixture('07ex.csv'));
    assert.equal(fullVestigingscode(rows[0]), '07EX00');
    const schools = new Map([['07EX00', {
      instellingCode: '07EX', vestigingscode: '07EX00', naam: 'Vrije School Amersfoort',
      gemeente: 'AMERSFOORT', plaats: 'AMERSFOORT',
    }]]);
    const resource = selectForecastResource(JSON.parse(fixture('metadata.json')));
    const records = normalizeForecastRows([...rows].reverse(), schools, resource);
    assert.equal(records.length, 1);
    assert.equal(records[0].sourceKey, 'duo-prognose:bo:07EX00');
    assert.deepEqual([records[0].firstYear, records[0].lastYear], [2026, 2045]);
    assert.equal(records[0].forecasts[0].pupils, 420.87);
  });

  it('negeert rijvolgorde en naamopmaak in de semantische hash', () => {
    const rows = parseCommaCsv(fixture('07ex.csv'));
    const resource = selectForecastResource(JSON.parse(fixture('metadata.json')));
    const school = { instellingCode: '07EX', vestigingscode: '07EX00', naam: 'Naam A', gemeente: 'AMERSFOORT', plaats: 'AMERSFOORT' };
    const first = normalizeForecastRows(rows, new Map([['07EX00', school]]), resource)[0];
    const second = normalizeForecastRows([...rows].reverse(), new Map([['07EX00', { ...school, naam: 'NAAM B' }]]), resource)[0];
    assert.equal(first.contentHash, second.contentHash);
  });

  it('stopt duidelijk bij schemadrift', () => {
    assert.throws(
      () => parseCommaCsv('INSTELLINGSCODE,VESTIGINGSCODE,TYPE_PO,JAAR\n07EX,00,BO,2026\n'),
      /PROGNOSEAANTALLEN/,
    );
  });
});

describe('DUO prognoses — journalistieke drempels', () => {
  it('laat normale modelruis buiten de eventstroom', () => {
    assert.equal(assessForecastTrend(forecastRecord([[2026, 200], [2030, 225]])), null);
    assert.equal(assessForecastRevision(
      forecastRecord([[2027, 300], [2028, 310]]),
      forecastRecord([[2027, 320], [2028, 325]], '2027-07-01'),
    ), null);
  });

  it('detecteert groei, herziening en afwijkende realisatie boven de gecombineerde grens', () => {
    const growth = assessForecastTrend(forecastRecord([[2026, 200], [2030, 240]]));
    assert.equal(growth.type, 'SCHOOL_FORECAST_GROWTH');
    const smallGrowth = assessForecastTrend(forecastRecord([[2026, 60], [2030, 82]]));
    assert.equal(smallGrowth.type, 'SCHOOL_FORECAST_GROWTH');
    const revision = assessForecastRevision(
      forecastRecord([[2027, 300], [2028, 310]]),
      forecastRecord([[2027, 250], [2028, 305]], '2027-07-01'),
    );
    assert.equal(revision.type, 'SCHOOL_FORECAST_REVISED_DOWN');
    const realization = assessForecastRealization(
      forecastRecord([[2026, 200], [2027, 205]]),
      { peiljaar: 2026, aantalLeerlingen: 235 },
    );
    assert.equal(realization.type, 'SCHOOL_FORECAST_OVERSHOOT');
  });

  it('laat R12 alleen gevalideerde, materiële prognose-events door', async () => {
    const event = {
      event_type: 'SCHOOL_FORECAST_REVISED_DOWN',
      title: 'Prognose bijgesteld',
      summary: 'Van 300 naar 250 leerlingen',
      source_url: 'https://onderwijsdata.duo.nl/datasets/wpoprognoses',
      provenance: JSON.stringify({
        journalistically_relevant: true,
        change_kind: 'revision',
        target_year: 2027,
        absolute_change: -50,
        relative_change: -1 / 6,
        previous: { forecasts: [{ year: 2027, pupils: 300 }] },
        current: { naam: 'Testschool', forecasts: [{ year: 2027, pupils: 250 }] },
      }),
    };
    assert.equal(await R12_SCHOOL_FORECAST.condition(event), true);
    const signal = await R12_SCHOOL_FORECAST.createSignal(event, { entities: [] });
    assert.equal(signal.category, 'onderwijs');
    assert.match(signal.title, /omlaag/);
  });
});

describe('DUO prognoses — integratie en idempotentie', () => {
  it('legt eerst alleen baseline vast en dupliceert geen event bij identieke runs', async () => {
    const db = createFakeDb();
    const metadata = JSON.parse(fixture('metadata.json'));
    const resourceUrl = metadata.result.resources[0].url;
    const address = jsonFixture('duo/bo-amersfoort.json');
    let csv = fixture('07ex.csv');
    const fetchImpl = async url => {
      if (url === METADATA_URL) return fakeResponse(metadata, true);
      if (url === resourceUrl) return fakeResponse(csv);
      if (url.startsWith('https://onderwijsdata.duo.nl/api/3/action/datastore_search?')) {
        return fakeResponse(address, true);
      }
      return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
    };
    const adapter = new DuoPrognosesAdapter({
      db,
      fetchImpl,
      actualRecords: [],
      minimumNationalRows: 1,
      minimumLocalSchools: 1,
    });

    const baseline = await adapter.run();
    assert.deepEqual(
      { total: baseline.total, baseline: baseline.baseline, events: baseline.events },
      { total: 1, baseline: true, events: 0 },
    );
    const recordsAfterBaseline = db.writes.filter(write => write.type === 'record').length;

    const identical = await adapter.run();
    assert.equal(identical.baseline, false);
    assert.equal(identical.events, 0);
    assert.equal(db.writes.filter(write => write.type === 'record').length, recordsAfterBaseline);

    csv = csv.replace('2030,402.32', '2030,350.00');
    const changed = await adapter.run();
    assert.equal(changed.events, 1);
    assert.equal(db.writes.filter(write => write.type === 'event').length, 1);

    const repeated = await adapter.run();
    assert.equal(repeated.events, 0);
    assert.equal(db.writes.filter(write => write.type === 'event').length, 1);
  });
});
