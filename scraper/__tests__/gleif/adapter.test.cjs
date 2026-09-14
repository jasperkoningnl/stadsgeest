// Tests voor scraper/src/kg/adapters/gleif-register.cjs
// Structuur: parsercontract, semantische hash, diff-logica, relatieparsing, hulpfuncties

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  compactRecord,
  extractCities,
  isLocalEntity,
  isWatchlisted,
  gleifSemanticHash,
  normalizeCity,
  parseRelationships,
  GleifRegisterAdapter,
} = require('../../src/kg/adapters/gleif-register.cjs');

// --- Fixtures ---

function makeEntity(overrides = {}) {
  return {
    attributes: {
      lei: overrides.lei || '529900T8BM49AURSDO55',
      entity: {
        legalName: { name: overrides.legalName || 'Test BV' },
        otherNames: overrides.otherNames || [],
        status: overrides.status || 'ACTIVE',
        legalAddress: {
          city: overrides.legalCity || 'Amersfoort',
          country: overrides.legalCountry || 'NL',
          postalCode: overrides.legalPostalCode || '3811 XX',
          addressLines: overrides.legalAddressLines || ['Stationsplein 1'],
        },
        headquartersAddress: {
          city: overrides.hqCity || 'Amersfoort',
          country: overrides.hqCountry || 'NL',
          postalCode: overrides.hqPostalCode || '3811 XX',
          addressLines: overrides.hqAddressLines || ['Stationsplein 1'],
        },
        otherAddresses: overrides.otherAddresses || [],
        jurisdiction: overrides.jurisdiction || 'NL',
        category: overrides.category || '',
        legalForm: { id: overrides.legalForm || 'BV' },
        expiration: overrides.expiration || {},
        successorEntity: overrides.successorEntity || {},
      },
      registration: {
        status: overrides.registrationStatus || 'ISSUED',
        lastUpdateDate: overrides.lastUpdate || '2024-06-01',
      },
    },
  };
}

function makeRelation(overrides = {}) {
  return {
    attributes: {
      relationship: {
        startNode: { id: overrides.startLei || '529900T8BM49AURSDO55' },
        endNode: { id: overrides.endLei || 'PARENT_LEI_12345' },
        type: overrides.type || 'IS_DIRECTLY_CONSOLIDATED_BY',
        status: overrides.status || 'ACTIVE',
        qualifiers: overrides.qualifiers || [],
      },
    },
  };
}

// --- Parsercontract ---

describe('compactRecord', () => {
  it('haalt alle relevante velden op', () => {
    const entity = makeEntity({ lei: 'ABC123', legalName: 'Voorbeeld BV' });
    const record = compactRecord(entity);
    assert.equal(record.lei, 'ABC123');
    assert.equal(record.legalName, 'Voorbeeld BV');
    assert.equal(record.status, 'ACTIVE');
    assert.equal(record.registrationStatus, 'ISSUED');
    assert.equal(record.legalCity, 'Amersfoort');
    assert.equal(record.hqCity, 'Amersfoort');
    assert.equal(record.legalForm, 'BV');
    assert.equal(record.lastUpdate, '2024-06-01');
  });

  it('verwerkt ontbrekende velden zonder fout', () => {
    const record = compactRecord({ attributes: {} });
    assert.equal(record.lei, undefined);
    assert.equal(record.legalName, '');
    assert.equal(record.status, '');
    assert.equal(record.hqCity, '');
  });

  it('voegt adresregels samen met komma', () => {
    const entity = makeEntity({ legalAddressLines: ['Regel 1', 'Regel 2'] });
    const record = compactRecord(entity);
    assert.equal(record.legalAddressLines, 'Regel 1, Regel 2');
  });

  it('pakt successorLei correct op', () => {
    const entity = makeEntity({ successorEntity: { lei: 'SUCC123' } });
    const record = compactRecord(entity);
    assert.equal(record.successorLei, 'SUCC123');
  });

  it('vangt otherNames op', () => {
    const entity = makeEntity({ otherNames: [{ name: 'Alias' }, { name: 'Handelsn.' }] });
    const record = compactRecord(entity);
    assert.deepEqual(record.otherNames, ['Alias', 'Handelsn.']);
  });
});

// --- Hulpfuncties ---

describe('normalizeCity', () => {
  it('lowercase en trim', () => {
    assert.equal(normalizeCity('  Amersfoort  '), 'amersfoort');
  });

  it('verwerkt null/undefined als lege string', () => {
    assert.equal(normalizeCity(null), '');
    assert.equal(normalizeCity(undefined), '');
  });

  it('reduceert meervoudige spaties', () => {
    assert.equal(normalizeCity('De  Bilt'), 'de bilt');
  });
});

describe('extractCities', () => {
  it('haalt legal- en hq-stad op', () => {
    const entity = makeEntity({ legalCity: 'Amersfoort', hqCity: 'Leusden' });
    const cities = extractCities(entity);
    assert.ok(cities.has('amersfoort'));
    assert.ok(cities.has('leusden'));
  });

  it('includeert otherAddresses', () => {
    const entity = makeEntity({ otherAddresses: [{ city: 'Bunschoten' }] });
    const cities = extractCities(entity);
    assert.ok(cities.has('bunschoten'));
  });

  it('levert unieke steden (geen duplicaten)', () => {
    const entity = makeEntity({ legalCity: 'Amersfoort', hqCity: 'Amersfoort' });
    const cities = extractCities(entity);
    assert.equal(cities.size, 1);
  });
});

describe('isLocalEntity', () => {
  it('true als hqCity Amersfoort is', () => {
    assert.ok(isLocalEntity(makeEntity({ hqCity: 'Amersfoort' })));
  });

  it('true als legalCity Leusden is (ook als hq elders)', () => {
    assert.ok(isLocalEntity(makeEntity({ legalCity: 'Leusden', hqCity: 'Utrecht' })));
  });

  it('false als geen lokaal adres', () => {
    assert.ok(!isLocalEntity(makeEntity({ legalCity: 'Utrecht', hqCity: 'Amsterdam' })));
  });

  it('case-insensitief', () => {
    assert.ok(isLocalEntity(makeEntity({ hqCity: 'AMERSFOORT' })));
  });
});

describe('isWatchlisted', () => {
  it('true als LEI op watchlist staat', () => {
    const entity = makeEntity({ lei: 'ABC123' });
    assert.ok(isWatchlisted(entity, new Set(['ABC123'])));
  });

  it('false als LEI niet op watchlist staat', () => {
    const entity = makeEntity({ lei: 'ABC123' });
    assert.ok(!isWatchlisted(entity, new Set(['XYZ789'])));
  });

  it('false bij lege watchlist', () => {
    const entity = makeEntity({ lei: 'ABC123' });
    assert.ok(!isWatchlisted(entity, new Set()));
    assert.ok(!isWatchlisted(entity, null));
  });
});

// --- Semantische hash ---

describe('gleifSemanticHash', () => {
  it('bevat de sleutelvelden', () => {
    const record = compactRecord(makeEntity({ lei: 'AAA', legalName: 'Test' }));
    const hash = gleifSemanticHash(record);
    assert.ok(hash.includes('AAA'));
    assert.ok(hash.includes('Test'));
  });

  it('wijzigt bij naamsverandering', () => {
    const r1 = compactRecord(makeEntity({ legalName: 'Naam A' }));
    const r2 = compactRecord(makeEntity({ legalName: 'Naam B' }));
    assert.notEqual(gleifSemanticHash(r1), gleifSemanticHash(r2));
  });

  it('wijzigt bij statusverandering', () => {
    const r1 = compactRecord(makeEntity({ status: 'ACTIVE' }));
    const r2 = compactRecord(makeEntity({ status: 'INACTIVE' }));
    assert.notEqual(gleifSemanticHash(r1), gleifSemanticHash(r2));
  });

  it('wijzigt bij hq-adreswijziging', () => {
    const r1 = compactRecord(makeEntity({ hqCity: 'Amersfoort' }));
    const r2 = compactRecord(makeEntity({ hqCity: 'Leusden' }));
    assert.notEqual(gleifSemanticHash(r1), gleifSemanticHash(r2));
  });

  it('is stabiel bij gelijke data', () => {
    const r1 = compactRecord(makeEntity());
    const r2 = compactRecord(makeEntity());
    assert.equal(gleifSemanticHash(r1), gleifSemanticHash(r2));
  });
});

// --- Relatieparsing ---

describe('parseRelationships', () => {
  it('parst een standaardrelatie', () => {
    const rels = parseRelationships([makeRelation()]);
    assert.equal(rels.length, 1);
    assert.equal(rels[0].startLei, '529900T8BM49AURSDO55');
    assert.equal(rels[0].endLei, 'PARENT_LEI_12345');
    assert.equal(rels[0].type, 'IS_DIRECTLY_CONSOLIDATED_BY');
    assert.equal(rels[0].status, 'ACTIVE');
  });

  it('filtert records zonder startLei of endLei', () => {
    const rels = parseRelationships([{
      attributes: { relationship: { startNode: { id: '' }, endNode: { id: 'X' }, type: 'T' } },
    }]);
    assert.equal(rels.length, 0);
  });

  it('parst qualifiers', () => {
    const rel = makeRelation({
      qualifiers: [{ qualifierDimension: 'ACCOUNTING', qualifierCategory: 'IFRS' }],
    });
    const rels = parseRelationships([rel]);
    assert.deepEqual(rels[0].qualifiers, ['ACCOUNTING:IFRS']);
  });

  it('retourneert lege array bij null/undefined', () => {
    assert.deepEqual(parseRelationships(null), []);
    assert.deepEqual(parseRelationships(undefined), []);
  });
});

// --- Diff-logica ---

describe('diff-logica', () => {
  // Gebruik de interne _diff via een adapter-instantie
  function makeDiffAdapter() {
    return new GleifRegisterAdapter({
      db: {}, dryRun: true, watchlist: new Set(),
    });
  }

  function snapshotFromRecords(records, relations = new Map()) {
    const snapshot = {};
    for (const r of records) {
      snapshot[r.lei] = {
        hash: gleifSemanticHash(r),
        ...r,
        parentRelations: relations.get(r.lei) || [],
      };
    }
    return snapshot;
  }

  it('baseline (geen vorig snapshot): alles is LEI_ENTITY_ADDED', () => {
    const adapter = makeDiffAdapter();
    const records = [compactRecord(makeEntity({ lei: 'A1' })), compactRecord(makeEntity({ lei: 'A2' }))];
    const events = adapter._diff(records, new Map(), null);
    assert.equal(events.length, 2);
    assert.ok(events.every(e => e.type === 'LEI_ENTITY_ADDED'));
  });

  it('ongewijzigde records: geen events', () => {
    const adapter = makeDiffAdapter();
    const records = [compactRecord(makeEntity({ lei: 'A1' }))];
    const prev = snapshotFromRecords(records);
    const events = adapter._diff(records, new Map(), prev);
    assert.equal(events.length, 0);
  });

  it('naamswijziging detecteert LEGAL_NAME_CHANGED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1', legalName: 'Oud' }))];
    const prev = snapshotFromRecords(prevRecords);
    const current = [compactRecord(makeEntity({ lei: 'A1', legalName: 'Nieuw' }))];
    const events = adapter._diff(current, new Map(), prev);
    assert.ok(events.some(e => e.type === 'LEGAL_NAME_CHANGED' && e.lei === 'A1'));
  });

  it('hq-wijziging detecteert HEADQUARTERS_CHANGED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1', hqCity: 'Amersfoort' }))];
    const prev = snapshotFromRecords(prevRecords);
    const current = [compactRecord(makeEntity({ lei: 'A1', hqCity: 'Leusden' }))];
    const events = adapter._diff(current, new Map(), prev);
    assert.ok(events.some(e => e.type === 'HEADQUARTERS_CHANGED' && e.lei === 'A1'));
  });

  it('statuswijziging detecteert ENTITY_STATUS_CHANGED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1', status: 'ACTIVE' }))];
    const prev = snapshotFromRecords(prevRecords);
    const current = [compactRecord(makeEntity({ lei: 'A1', status: 'INACTIVE' }))];
    const events = adapter._diff(current, new Map(), prev);
    assert.ok(events.some(e => e.type === 'ENTITY_STATUS_CHANGED' && e.lei === 'A1'));
  });

  it('opvolgerregistratie detecteert SUCCESSOR_RECORDED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1' }))];
    const prev = snapshotFromRecords(prevRecords);
    const current = [compactRecord(makeEntity({ lei: 'A1', successorEntity: { lei: 'SUCC1' } }))];
    const events = adapter._diff(current, new Map(), prev);
    assert.ok(events.some(e => e.type === 'SUCCESSOR_RECORDED' && e.lei === 'A1'));
  });

  it('relatiewijziging detecteert PARENT_RELATION_CHANGED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1' }))];
    const prevRelations = new Map([['A1', [{ startLei: 'A1', endLei: 'P1', type: 'IS_DIRECTLY_CONSOLIDATED_BY' }]]]);
    const prev = snapshotFromRecords(prevRecords, prevRelations);

    const current = [compactRecord(makeEntity({ lei: 'A1' }))];
    const curRelations = new Map([['A1', [{ startLei: 'A1', endLei: 'P2', type: 'IS_DIRECTLY_CONSOLIDATED_BY' }]]]);
    const events = adapter._diff(current, curRelations, prev);
    assert.ok(events.some(e => e.type === 'PARENT_RELATION_CHANGED' && e.lei === 'A1'));
  });

  it('verdwenen ACTIVE entity wordt ENTITY_STATUS_CHANGED, niet removed', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [
      compactRecord(makeEntity({ lei: 'A1', status: 'ACTIVE' })),
      compactRecord(makeEntity({ lei: 'A2', status: 'ACTIVE' })),
    ];
    const prev = snapshotFromRecords(prevRecords);
    const current = [compactRecord(makeEntity({ lei: 'A1', status: 'ACTIVE' }))];
    // A2 is verdwenen
    const events = adapter._diff(current, new Map(), prev);
    const a2Events = events.filter(e => e.lei === 'A2');
    assert.equal(a2Events.length, 1);
    assert.equal(a2Events[0].type, 'ENTITY_STATUS_CHANGED');
    assert.equal(a2Events[0].record.status, 'NOT_IN_RESPONSE');
    assert.ok(a2Events[0].note);
  });

  it('verdwenen INACTIVE entity genereert geen event', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1', status: 'INACTIVE', registrationStatus: 'RETIRED' }))];
    const prev = snapshotFromRecords(prevRecords);
    const events = adapter._diff([], new Map(), prev);
    assert.equal(events.length, 0);
  });

  it('nieuwe entity in niet-baseline: LEI_ENTITY_ADDED', () => {
    const adapter = makeDiffAdapter();
    const prevRecords = [compactRecord(makeEntity({ lei: 'A1' }))];
    const prev = snapshotFromRecords(prevRecords);
    const current = [
      compactRecord(makeEntity({ lei: 'A1' })),
      compactRecord(makeEntity({ lei: 'A2' })),
    ];
    const events = adapter._diff(current, new Map(), prev);
    assert.ok(events.some(e => e.type === 'LEI_ENTITY_ADDED' && e.lei === 'A2'));
    assert.ok(!events.some(e => e.lei === 'A1')); // A1 ongewijzigd
  });
});
