const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { coordinates, selectExactAddress, lookupBag, backfillBagLocations } = require('../../src/kg/bag-locations.cjs');

const LOCATION = { postal_code: '3811LM', house_number: '1', municipality: 'Amersfoort' };
const DOC = {
  bron: 'BAG', type: 'adres', postcode: '3811LM', huis_nlt: '1', gemeentenaam: 'Amersfoort',
  nummeraanduiding_id: '0307200000408911', centroide_ll: 'POINT(5.38416472 52.15671963)',
  weergavenaam: 'Stadhuisplein 1, 3811LM Amersfoort', rdf_seealso: 'https://bag.example/1',
};

test('selecteert alleen een exacte BAG-adresmatch in de doelgemeente', () => {
  assert.equal(selectExactAddress(LOCATION, [{ ...DOC, postcode: '3811XX' }, DOC]), DOC);
  assert.equal(selectExactAddress(LOCATION, [{ ...DOC, gemeentenaam: 'Utrecht' }]), null);
  assert.equal(selectExactAddress(LOCATION, [{ ...DOC, huis_nlt: '10' }]), null);
});

test('leest BAG-id en WGS84-coördinaten uit het actuele PDOK-contract', async () => {
  let requested;
  const match = await lookupBag(LOCATION, async url => {
    requested = new URL(url);
    return { ok: true, json: async () => ({ response: { docs: [DOC] } }) };
  });
  assert.equal(requested.searchParams.get('fq'), 'type:adres');
  assert.equal(match.bagId, '0307200000408911');
  assert.deepEqual(coordinates(DOC.centroide_ll), { lon: 5.38416472, lat: 52.15671963 });
});

test('dry-run schrijft niet; apply vult uitsluitend exacte matches', async () => {
  const db = createClient({ url: ':memory:' });
  await db.execute(`CREATE TABLE locations(id INTEGER PRIMARY KEY,label TEXT,street TEXT,house_number TEXT,postal_code TEXT,city TEXT,municipality TEXT,bag_id TEXT,lat REAL,lon REAL)`);
  await db.execute("INSERT INTO locations VALUES(1,'Stadhuis','Stadhuisplein','1','3811LM','Amersfoort','Amersfoort',NULL,NULL,NULL)");
  const fetchImpl = async () => ({ ok: true, json: async () => ({ response: { docs: [DOC] } }) });
  const dry = await backfillBagLocations(db, { fetchImpl });
  assert.equal(dry.matched, 1);
  assert.equal((await db.execute('SELECT bag_id FROM locations')).rows[0].bag_id, null);
  const applied = await backfillBagLocations(db, { fetchImpl, apply: true });
  assert.equal(applied.updated, 1);
  assert.equal((await db.execute('SELECT bag_id FROM locations')).rows[0].bag_id, DOC.nummeraanduiding_id);
  db.close();
});
