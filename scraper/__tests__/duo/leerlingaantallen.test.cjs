const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  PO_CSV_URL,
  VO_PAGE_URL,
  DuoLeerlingaantallenAdapter,
  assessEnrollmentChange,
  discoverVoFiles,
  normalizePoRows,
  normalizeVoRows,
  parsePublishedCount,
  parseSemicolonCsv,
} = require('../../src/kg/adapters/duo-leerlingaantallen.cjs');
const { R11_SCHOOL_ENROLLMENT } = require('../../src/kg/detection-rules.cjs');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, '../fixtures/duo-leerlingen', name), 'utf8');
}

function fakeResponse(body) {
  return { ok: true, status: 200, async text() { return body; } };
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
    latestRecords,
    eventIdentifiers,
    async execute(query) {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args || []);
      if (/SELECT id FROM sources WHERE name/.test(sql)) {
        return { rows: sourceId ? [{ id: sourceId }] : [] };
      }
      if (/INSERT INTO sources/.test(sql)) {
        sourceId = 77;
        writes.push({ type: 'source' });
        return { rows: [], lastInsertRowid: sourceId };
      }
      if (/FROM source_records sr/.test(sql)) {
        return { rows: [...latestRecords.values()] };
      }
      if (/INSERT INTO source_records/.test(sql)) {
        const [storedSourceId, sourceKey, rawObject, contentHash, semanticHash] = args;
        assert.equal(storedSourceId, sourceId);
        const row = {
          id: nextRecordId++,
          source_key: sourceKey,
          raw_object: rawObject,
          content_hash: contentHash,
          semantic_hash: semanticHash,
          change_type: args.length === 6 ? args[5] : args[6],
        };
        latestRecords.set(sourceKey, row);
        writes.push({ type: 'record', sourceKey });
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
        eventIdentifiers.add(args[6]);
        writes.push({ type: 'event', eventType: args[0], sourceIdentifier: args[6] });
        return { rows: [], lastInsertRowid: id };
      }
      if (/^(\s*)(UPDATE|INSERT OR IGNORE)/.test(sql)) return { rows: [] };
      throw new Error(`Onverwachte testquery: ${sql}`);
    },
  };
}

describe('DUO leerlingaantallen — schema en normalisatie', () => {
  it('parseert de officiële semikolon- en quotevorm correct', () => {
    const rows = parseSemicolonCsv('A;B\n1;"Basisschool ""Kla4"""\n');
    assert.deepEqual(rows, [{ A: '1', B: 'Basisschool "Kla4"' }]);
    assert.equal(parsePublishedCount('<5'), null);
    assert.equal(parsePublishedCount('57'), 57);
  });

  it('selecteert automatisch de nieuwste twee juiste VO-CSV-bestanden', () => {
    const files = discoverVoFiles(fixture('vo-page.html'));
    assert.deepEqual(files.map(file => file.year), [2025, 2024]);
    assert.match(files[0].url, /03\.-leerlingen-vo-per-vestiging-en-bestuur.*2025\.csv$/);
  });

  it('filtert exact op lokaal regulier BO en gebruikt een stabiele vestigingssleutel', () => {
    const rows = parseSemicolonCsv(fixture('po-2025.csv'));
    const records = normalizePoRows(rows);
    assert.deepEqual(records.map(record => record.sourceKey), [
      'duo-leerlingen:bo:01VI00',
      'duo-leerlingen:bo:16GL00',
    ]);
    assert.equal(records[0].peiljaar, 2025);
    assert.equal(records[0].vorigAantalLeerlingen, 194);
  });

  it('filtert VO exact op vestigingsgemeente en koppelt de vorige jaargang', () => {
    const files = discoverVoFiles(fixture('vo-page.html'));
    const records = normalizeVoRows(
      parseSemicolonCsv(fixture('vo-2025.csv')),
      parseSemicolonCsv(fixture('vo-2024.csv')),
      files,
    );
    assert.equal(records.length, 2);
    assert.equal(records[0].sourceKey, 'duo-leerlingen:vo:14RC00');
    assert.equal(records[0].aantalLeerlingen, 872);
    assert.equal(records[0].vorigAantalLeerlingen, 1035);
  });

  it('negeert sortering, naamopmaak en VAVO-detail in de semantische hash', () => {
    const files = discoverVoFiles(fixture('vo-page.html'));
    const current = parseSemicolonCsv(fixture('vo-2025.csv'));
    const previous = parseSemicolonCsv(fixture('vo-2024.csv'));
    const first = normalizeVoRows(current, previous, files);
    const changedPresentation = [...current].reverse();
    changedPresentation.find(row => row.VESTIGINGSCODE === '14RC00')['INSTELLINGSNAAM VESTIGING'] = '  MEERSCHOLEN  ';
    changedPresentation.find(row => row.VESTIGINGSCODE === '14RC00')['AANTAL VO LEERLINGEN UITBESTEED AAN VAVO'] = '999';
    const second = normalizeVoRows(changedPresentation, previous, files);
    assert.deepEqual(first.map(record => record.sourceKey), second.map(record => record.sourceKey));
    assert.deepEqual(first.map(record => record.contentHash), second.map(record => record.contentHash));
  });

  it('stopt duidelijk bij schemadrift', () => {
    const rows = parseSemicolonCsv(fixture('po-2025.csv'));
    delete rows[0].VESTIGINGSCODE;
    assert.throws(() => normalizePoRows(rows), /VESTIGINGSCODE/);
  });
});

describe('DUO leerlingaantallen — journalistieke drempels', () => {
  const record = (from, to) => ({
    sourceKey: 'duo-leerlingen:bo:TEST00',
    peiljaar: 2026,
    aantalLeerlingen: to,
    previous: { peiljaar: 2025, aantalLeerlingen: from },
  });

  it('laat normale schommelingen buiten de eventstroom', () => {
    const current = record(400, 425);
    assert.equal(assessEnrollmentChange(current.previous, current), null);
    const percentageOnly = record(50, 66);
    assert.equal(assessEnrollmentChange(percentageOnly.previous, percentageOnly), null);
  });

  it('detecteert absolute, gecombineerde en kleine-schooluitschieters', () => {
    assert.equal(assessEnrollmentChange(record(1500, 1390).previous, record(1500, 1390)).type, 'SCHOOL_ENROLLMENT_DECLINE');
    assert.equal(assessEnrollmentChange(record(400, 350).previous, record(400, 350)).type, 'SCHOOL_ENROLLMENT_DECLINE');
    assert.equal(assessEnrollmentChange(record(26, 57).previous, record(26, 57)).type, 'SCHOOL_ENROLLMENT_GROWTH');
  });

  it('laat R11 alleen door bij aantoonbaar relevante DUO-provenance', async () => {
    const event = {
      event_type: 'SCHOOL_ENROLLMENT_DECLINE',
      title: 'Opvallende leerlingkrimp',
      summary: 'Van 400 naar 350 leerlingen',
      source_url: 'https://duo.nl/',
      provenance: JSON.stringify({
        journalistically_relevant: true,
        absolute_change: -50,
        relative_change: -0.125,
        previous: { aantalLeerlingen: 400 },
        current: { aantalLeerlingen: 350, naam: 'Testschool', peiljaar: 2026 },
      }),
    };
    assert.equal(await R11_SCHOOL_ENROLLMENT.condition(event), true);
    const signal = await R11_SCHOOL_ENROLLMENT.createSignal(event, { entities: [] });
    assert.equal(signal.category, 'onderwijs');
    assert.match(signal.title, /leerlingkrimp/);
  });
});

describe('DUO leerlingaantallen — integratie en idempotentie', () => {
  it('legt eerst alleen baseline vast en dupliceert geen events bij identieke runs', async () => {
    const db = createFakeDb();
    let poText = fixture('po-2025.csv');
    const responses = new Map([
      [VO_PAGE_URL, fixture('vo-page.html')],
    ]);
    const fetchImpl = async url => {
      if (url === PO_CSV_URL) return fakeResponse(poText);
      if (url === VO_PAGE_URL) return fakeResponse(responses.get(VO_PAGE_URL));
      if (/2025\.csv$/.test(url)) return fakeResponse(fixture('vo-2025.csv'));
      if (/2024\.csv$/.test(url)) return fakeResponse(fixture('vo-2024.csv'));
      return { ok: false, status: 404, async text() { return ''; } };
    };
    const adapter = new DuoLeerlingaantallenAdapter({
      db,
      fetchImpl,
      minimumRows: { po: 1, vo: 1, localPo: 1, localVo: 1 },
    });

    const baseline = await adapter.run();
    assert.deepEqual({ total: baseline.total, baseline: baseline.baseline, events: baseline.events }, { total: 4, baseline: true, events: 0 });
    const recordsAfterBaseline = db.writes.filter(write => write.type === 'record').length;

    const identical = await adapter.run();
    assert.equal(identical.baseline, false);
    assert.equal(identical.events, 0);
    assert.equal(db.writes.filter(write => write.type === 'record').length, recordsAfterBaseline);

    poText = fixture('po-2025.csv')
      .replace('LEERLINGEN_2024;LEERLINGEN_2025', 'LEERLINGEN_2025;LEERLINGEN_2026')
      .replace('194;200', '200;200')
      .replace('452;403', '403;350');
    const changed = await adapter.run();
    assert.equal(changed.events, 1);
    assert.equal(db.writes.filter(write => write.type === 'event').length, 1);

    const repeated = await adapter.run();
    assert.equal(repeated.events, 0);
    assert.equal(db.writes.filter(write => write.type === 'event').length, 1);
  });
});
