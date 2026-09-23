const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  OpenKvkRegisterAdapter, buildUrl, daysToFetch, eventForRecord, isPersonalLegalForm, isSignalLegalForm,
  normalizeItem, parseResponse,
} = require('../../src/kg/adapters/openkvk-register.cjs');

// Verzonnen records in het formaat van api.overheid.io/v3/openkvk (fields[] gezet).
function item(overrides = {}) {
  return {
    kvknummer: '12345678', naam: 'Stichting Voorbeeld', actief: true, updated_at: '2026-09-22',
    rechtsvormCode: 'STI', rechtsvormOmschrijving: 'Stichting', inschrijvingstype: 'Rechtspersoon', vestiging: false,
    bezoeklocatie: { plaats: 'Amersfoort', straat: 'Voorbeeldstraat', huisnummer: '1', postcode: '3811 aa' },
    activiteiten: [{ code: '94991', omschrijving: 'Ideële organisaties', hoofdactiviteit: true }],
    slug: 'stichting-voorbeeld-12345678',
    ...overrides,
  };
}

describe('OpenKvK — parser', () => {
  it('leest het HAL-antwoord en herkent schemadrift', () => {
    const parsed = parseResponse({ totalItemCount: 1, pageCount: 1, _embedded: { bedrijf: [item()] } });
    assert.equal(parsed.items.length, 1);
    assert.deepEqual(parseResponse({ totalItemCount: 0, pageCount: 1 }).items, []);
    assert.throws(() => parseResponse({ totalItemCount: 3, pageCount: 1, _embedded: {} }), /schemadrift/);
    assert.throws(() => parseResponse({}), /totalItemCount/);
  });

  it('normaliseert naar een stabiele sleutel per KVK-nummer en vestiging', () => {
    const rp = normalizeItem(item());
    assert.equal(rp.sourceKey, 'openkvk:12345678:rp');
    assert.equal(rp.address.postcode, '3811AA');
    assert.equal(rp.occurredAt, '2026-09-22');
    const branch = normalizeItem(item({ vestiging: true, vestigingsnummer: '000011112222' }));
    assert.equal(branch.sourceKey, 'openkvk:12345678:000011112222');
  });

  it('laat niet-lokale en ongeldige records vallen', () => {
    assert.equal(normalizeItem(item({ bezoeklocatie: { plaats: 'Amsterdam' } })), null);
    assert.equal(normalizeItem(item({ kvknummer: '123' })), null);
    assert.ok(normalizeItem(item({ bezoeklocatie: { plaats: 'LEUSDEN' } })));
  });

  it('semantische hash negeert updated_at maar ziet adreswijziging', () => {
    const a = normalizeItem(item());
    assert.equal(a.semanticHash, normalizeItem(item({ updated_at: '2026-09-23' })).semanticHash);
    assert.notEqual(a.semanticHash, normalizeItem(item({ bezoeklocatie: { plaats: 'Amersfoort', straat: 'Andere straat', huisnummer: '2', postcode: '3811AB' } })).semanticHash);
  });

  it('bouwt de zoek-URL zonder API-sleutel', () => {
    const url = buildUrl('Amersfoort', '2026-09-22', 2);
    assert.match(url, /filters\[updated_at\]=2026-09-22/);
    assert.match(url, /size=100&page=2/);
    assert.doesNotMatch(url, /ovio-api-key/);
  });

  it('rechtsvormen: maatschappelijk versus persoonlijk', () => {
    assert.ok(isSignalLegalForm('Stichting'));
    assert.ok(isSignalLegalForm('Coöperatie'));
    assert.ok(!isSignalLegalForm('Vereniging van Eigenaars'));
    assert.ok(!isSignalLegalForm('Besloten Vennootschap'));
    assert.ok(isPersonalLegalForm('Eenmanszaak'));
    assert.ok(isPersonalLegalForm('Vennootschap Onder Firma'));
  });
});

describe('OpenKvK — dagvenster', () => {
  it('haalt zonder cursor alleen gisteren op', () => {
    assert.deepEqual(daysToFetch(null, '2026-09-24'), ['2026-09-23']);
  });
  it('vult een gat aan tot hooguit zeven dagen terug', () => {
    assert.deepEqual(daysToFetch('2026-09-21', '2026-09-24'), ['2026-09-22', '2026-09-23']);
    assert.equal(daysToFetch('2026-08-01', '2026-09-24').length, 7);
    assert.deepEqual(daysToFetch('2026-09-23', '2026-09-24'), []);
  });
});

describe('OpenKvK — events', () => {
  const stichting = normalizeItem(item());
  const bv = normalizeItem(item({ rechtsvormOmschrijving: 'Besloten Vennootschap', naam: 'Voorbeeld B.V.' }));

  it('tijdens de opwarmperiode geen "nieuw" en geen opheffing van onbekenden', () => {
    assert.equal(eventForRecord({ record: stichting, previous: null, knownElsewhere: false, warmup: true }), null);
    const inactive = normalizeItem(item({ actief: false }));
    assert.equal(eventForRecord({ record: inactive, previous: null, knownElsewhere: false, warmup: true }), null);
    const known = eventForRecord({ record: inactive, previous: null, knownElsewhere: true, warmup: true, entityId: 7 });
    assert.equal(known.type, 'KVK_REGISTRATION_DISSOLVED');
    assert.equal(known.journalisticallyRelevant, true);
  });

  it('na de opwarmperiode: nieuwe stichting relevant, nieuwe BV alleen graafcontext', () => {
    const s = eventForRecord({ record: stichting, previous: null, knownElsewhere: false, warmup: false });
    assert.equal(s.type, 'KVK_REGISTRATION_ADDED');
    assert.equal(s.journalisticallyRelevant, true);
    assert.match(s.uncertainty, /geen inschrijfdatum/);
    const b = eventForRecord({ record: bv, previous: null, knownElsewhere: false, warmup: false });
    assert.equal(b.journalisticallyRelevant, false);
    const k = eventForRecord({ record: stichting, previous: null, knownElsewhere: true, warmup: false });
    assert.equal(k.journalisticallyRelevant, false, 'een al bekende organisatie is niet nieuw');
  });

  it('actief → niet actief is een opheffing, eenmalig per KVK-nummer', () => {
    const inactive = normalizeItem(item({ actief: false }));
    const e = eventForRecord({ record: inactive, previous: stichting, knownElsewhere: false, warmup: false });
    assert.equal(e.type, 'KVK_REGISTRATION_DISSOLVED');
    assert.equal(e.sourceIdentifier, 'openkvk:12345678:dissolved');
    assert.equal(eventForRecord({ record: inactive, previous: inactive, knownElsewhere: false, warmup: false }), null);
  });

  it('wijziging van naam of adres; activiteitscode alleen is geen event', () => {
    const moved = normalizeItem(item({ bezoeklocatie: { plaats: 'Leusden', straat: 'Nieuweweg', huisnummer: '5', postcode: '3831AA' } }));
    const e = eventForRecord({ record: moved, previous: stichting, knownElsewhere: true, warmup: false });
    assert.equal(e.type, 'KVK_REGISTRATION_CHANGED');
    assert.deepEqual(e.changedFields, ['address']);
    assert.equal(e.journalisticallyRelevant, true);
    const newCode = normalizeItem(item({ activiteiten: [{ code: '85599', omschrijving: 'Overig onderwijs', hoofdactiviteit: true }] }));
    assert.equal(eventForRecord({ record: newCode, previous: stichting, knownElsewhere: true, warmup: false }), null);
  });
});

describe('OpenKvK — belbudget', () => {
  function fakeDb() {
    return { execute: async () => ({ rows: [], lastInsertRowid: 0 }) };
  }
  function fakeFetch(counter) {
    return async url => {
      counter.urls.push(url);
      const body = { totalItemCount: 1, pageCount: 1, _embedded: { bedrijf: [item()] } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
  }

  it('stuurt de sleutel als header en haalt per dag beide plaatsen op', async () => {
    const counter = { urls: [] };
    const headers = [];
    const adapter = new OpenKvkRegisterAdapter({
      db: fakeDb(), dryRun: true, apiKey: 'test', now: () => new Date('2026-09-24T06:15:00Z'),
      fetchImpl: async (url, init) => { headers.push(init.headers['ovio-api-key']); return fakeFetch(counter)(url); },
    });
    const result = await adapter.run();
    assert.equal(result.calls, 2);
    assert.deepEqual(result.days, ['2026-09-23']);
    assert.ok(headers.every(value => value === 'test'));
    assert.ok(counter.urls.every(url => !url.includes('ovio-api-key')));
    assert.equal((await adapter.health()).status, 'ok');
  });

  it('stopt bij het maximum aantal calls en meldt dat als verdacht', async () => {
    const counter = { urls: [] };
    const adapter = new OpenKvkRegisterAdapter({
      db: fakeDb(), dryRun: true, apiKey: 'test', maxCalls: 1, now: () => new Date('2026-09-24T06:15:00Z'),
      fetchImpl: fakeFetch(counter),
    });
    const result = await adapter.run();
    assert.equal(counter.urls.length, 1);
    assert.deepEqual(result.days, []);
    assert.equal((await adapter.health()).status, 'suspect');
  });

  it('weigert te draaien zonder sleutel', async () => {
    const adapter = new OpenKvkRegisterAdapter({ db: fakeDb(), dryRun: true, apiKey: '' });
    await assert.rejects(() => adapter.run(), /OVERHEID_IO_KEY/);
  });
});
