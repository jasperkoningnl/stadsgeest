// Tests voor scraper/src/kg/adapters/osm-context.cjs
// Structuur: queryopbouw, parsercontract, semantische hash, diff-logica, hulpfuncties

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOverpassQuery,
  compactOsmRecord,
  osmSemanticHash,
  osmRecordKey,
  AREA_IDS,
  RELEVANT_TAGS,
  OsmContextAdapter,
} = require('../../src/kg/adapters/osm-context.cjs');

// --- Fixtures ---

function makeElement(overrides = {}) {
  return {
    type: overrides.type || 'node',
    id: overrides.id || 12345,
    lat: overrides.lat || 52.1551,
    lon: overrides.lon || 5.3872,
    tags: {
      name: overrides.name || 'Testwinkel',
      shop: overrides.shop || 'supermarket',
      'addr:street': overrides.street || 'Utrechtseweg',
      'addr:housenumber': overrides.housenumber || '42',
      'addr:postcode': overrides.postcode || '3811 NB',
      'addr:city': overrides.city || 'Amersfoort',
      operator: overrides.operator || '',
      brand: overrides.brand || '',
      website: overrides.website || '',
      opening_hours: overrides.opening_hours || '',
      ...(overrides.extraTags || {}),
    },
  };
}

function makeWayElement(overrides = {}) {
  return {
    type: 'way',
    id: overrides.id || 67890,
    center: { lat: overrides.lat || 52.16, lon: overrides.lon || 5.39 },
    tags: {
      name: overrides.name || 'Kantoorpand',
      office: overrides.office || 'company',
      'addr:street': overrides.street || 'Stationsplein',
      'addr:housenumber': overrides.housenumber || '1',
      'addr:city': overrides.city || 'Amersfoort',
      ...(overrides.extraTags || {}),
    },
  };
}

// --- Queryopbouw ---

describe('buildOverpassQuery', () => {
  it('genereert geldige Overpass QL', () => {
    const query = buildOverpassQuery(AREA_IDS.amersfoort);
    assert.ok(query.includes('[out:json]'));
    assert.ok(query.includes(`area(${AREA_IDS.amersfoort})`));
    assert.ok(query.includes('out center tags'));
  });

  it('bevat alle relevante tags', () => {
    const query = buildOverpassQuery(AREA_IDS.amersfoort);
    for (const tag of RELEVANT_TAGS) {
      assert.ok(query.includes(`["${tag}"]`), `Tag ${tag} ontbreekt in query`);
    }
  });

  it('bevraagt nodes, ways en relations', () => {
    const query = buildOverpassQuery(AREA_IDS.leusden);
    assert.ok(query.includes('node['));
    assert.ok(query.includes('way['));
    assert.ok(query.includes('relation['));
  });
});

// --- Area-ID's ---

describe('AREA_IDS', () => {
  it('bevat Amersfoort en Leusden', () => {
    assert.ok(AREA_IDS.amersfoort);
    assert.ok(AREA_IDS.leusden);
  });

  it('heeft geldige Overpass area-formaat (3600xxxxxx)', () => {
    assert.ok(AREA_IDS.amersfoort > 3600000000);
    assert.ok(AREA_IDS.leusden > 3600000000);
  });
});

// --- Parsercontract ---

describe('compactOsmRecord', () => {
  it('haalt alle relevante velden op uit een node', () => {
    const element = makeElement({ name: 'Albert Heijn', brand: 'Albert Heijn' });
    const record = compactOsmRecord(element);
    assert.equal(record.osmId, 'node/12345');
    assert.equal(record.name, 'Albert Heijn');
    assert.equal(record.category, 'shop=supermarket');
    assert.equal(record.brand, 'Albert Heijn');
    assert.equal(record.street, 'Utrechtseweg');
    assert.equal(record.housenumber, '42');
    assert.equal(record.lat, 52.1551);
    assert.equal(record.lon, 5.3872);
  });

  it('pakt center-coördinaten van ways', () => {
    const element = makeWayElement({ lat: 52.16, lon: 5.39 });
    const record = compactOsmRecord(element);
    assert.equal(record.osmId, 'way/67890');
    assert.equal(record.lat, 52.16);
    assert.equal(record.lon, 5.39);
  });

  it('bepaalt categorie op eerste matchende tag', () => {
    const element = makeElement({ extraTags: { amenity: 'restaurant' } });
    // shop staat eerst in de fixture-tags, maar amenity staat in RELEVANT_TAGS
    // De eerste RELEVANT_TAGS match is 'shop' (want shop=supermarket is gezet)
    const record = compactOsmRecord(element);
    assert.ok(record.category.startsWith('shop='));
  });

  it('vangt contact:website en contact:phone op', () => {
    const element = {
      type: 'node', id: 99, lat: 52.15, lon: 5.38,
      tags: { name: 'Test', amenity: 'cafe', 'contact:website': 'https://test.nl', 'contact:phone': '033-1234567' },
    };
    const record = compactOsmRecord(element);
    assert.equal(record.website, 'https://test.nl');
    assert.equal(record.phone, '033-1234567');
  });

  it('verwerkt ontbrekende tags zonder fout', () => {
    const record = compactOsmRecord({ type: 'node', id: 1, tags: {} });
    assert.equal(record.name, '');
    assert.equal(record.category, '');
    assert.equal(record.street, '');
  });

  it('vangt KVK-referentie en BAG-id op', () => {
    const element = makeElement({ extraTags: { 'ref:kvk': '12345678', 'ref:bag': '0307100000' } });
    const record = compactOsmRecord(element);
    assert.equal(record.kvk, '12345678');
    assert.equal(record.bagId, '0307100000');
  });

  it('vangt wikidata-referentie op', () => {
    const element = makeElement({ extraTags: { wikidata: 'Q12345' } });
    const record = compactOsmRecord(element);
    assert.equal(record.wikidata, 'Q12345');
  });
});

describe('osmRecordKey', () => {
  it('gebruikt osmId als sleutel', () => {
    const record = compactOsmRecord(makeElement());
    assert.equal(osmRecordKey(record), 'node/12345');
  });
});

// --- Semantische hash ---

describe('osmSemanticHash', () => {
  it('bevat sleutelvelden', () => {
    const record = compactOsmRecord(makeElement({ name: 'Jumbo' }));
    const hash = osmSemanticHash(record);
    assert.ok(hash.includes('Jumbo'));
    assert.ok(hash.includes('node/12345'));
  });

  it('is stabiel bij gelijke data', () => {
    const r1 = compactOsmRecord(makeElement());
    const r2 = compactOsmRecord(makeElement());
    assert.equal(osmSemanticHash(r1), osmSemanticHash(r2));
  });

  it('wijzigt bij naamsverandering', () => {
    const r1 = compactOsmRecord(makeElement({ name: 'A' }));
    const r2 = compactOsmRecord(makeElement({ name: 'B' }));
    assert.notEqual(osmSemanticHash(r1), osmSemanticHash(r2));
  });

  it('wijzigt bij adreswijziging', () => {
    const r1 = compactOsmRecord(makeElement({ street: 'Straat A' }));
    const r2 = compactOsmRecord(makeElement({ street: 'Straat B' }));
    assert.notEqual(osmSemanticHash(r1), osmSemanticHash(r2));
  });

  it('rondt coördinaten af op 4 decimalen', () => {
    const r1 = compactOsmRecord(makeElement({ lat: 52.15510001 }));
    const r2 = compactOsmRecord(makeElement({ lat: 52.15510009 }));
    assert.equal(osmSemanticHash(r1), osmSemanticHash(r2));
  });

  it('verschilt bij significante positiewijziging', () => {
    const r1 = compactOsmRecord(makeElement({ lat: 52.1551 }));
    const r2 = compactOsmRecord(makeElement({ lat: 52.1562 }));
    assert.notEqual(osmSemanticHash(r1), osmSemanticHash(r2));
  });
});

// --- Diff-logica ---

describe('diff-logica', () => {
  function makeDiffAdapter() {
    return new OsmContextAdapter({ db: {}, dryRun: true });
  }

  function snapshotFromRecords(records) {
    const snapshot = {};
    for (const r of records) {
      snapshot[r.osmId] = { hash: osmSemanticHash(r), ...r };
    }
    return snapshot;
  }

  it('baseline (geen vorig snapshot): alles in added', () => {
    const adapter = makeDiffAdapter();
    const records = [compactOsmRecord(makeElement({ id: 1 })), compactOsmRecord(makeElement({ id: 2 }))];
    const changes = adapter._diff(records, null);
    assert.equal(changes.added.length, 2);
    assert.equal(changes.changed.length, 0);
    assert.equal(changes.removed.length, 0);
  });

  it('ongewijzigde records: geen changes', () => {
    const adapter = makeDiffAdapter();
    const records = [compactOsmRecord(makeElement({ id: 1 }))];
    const prev = snapshotFromRecords(records);
    const changes = adapter._diff(records, prev);
    assert.equal(changes.added.length, 0);
    assert.equal(changes.changed.length, 0);
    assert.equal(changes.removed.length, 0);
  });

  it('nieuw record wordt gedetecteerd', () => {
    const adapter = makeDiffAdapter();
    const prev = snapshotFromRecords([compactOsmRecord(makeElement({ id: 1 }))]);
    const current = [
      compactOsmRecord(makeElement({ id: 1 })),
      compactOsmRecord(makeElement({ id: 2, name: 'Nieuw' })),
    ];
    const changes = adapter._diff(current, prev);
    assert.equal(changes.added.length, 1);
    assert.equal(changes.added[0].osmId, 'node/2');
  });

  it('gewijzigd record wordt gedetecteerd', () => {
    const adapter = makeDiffAdapter();
    const prev = snapshotFromRecords([compactOsmRecord(makeElement({ id: 1, name: 'Oud' }))]);
    const current = [compactOsmRecord(makeElement({ id: 1, name: 'Nieuw' }))];
    const changes = adapter._diff(current, prev);
    assert.equal(changes.changed.length, 1);
    assert.equal(changes.changed[0].current.name, 'Nieuw');
  });

  it('verwijderd record wordt gedetecteerd', () => {
    const adapter = makeDiffAdapter();
    const prev = snapshotFromRecords([
      compactOsmRecord(makeElement({ id: 1 })),
      compactOsmRecord(makeElement({ id: 2 })),
    ]);
    const current = [compactOsmRecord(makeElement({ id: 1 }))];
    const changes = adapter._diff(current, prev);
    assert.equal(changes.removed.length, 1);
    assert.equal(changes.removed[0].osmId, 'node/2');
  });

  it('standaard geen events (STRUCTURED_CONTEXT)', () => {
    // emitSoftEvents is standaard false
    const adapter = makeDiffAdapter();
    assert.equal(adapter.emitSoftEvents, false);
  });
});
