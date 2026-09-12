const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DATASETS,
  diffRecord,
  isLocalRecord,
  normalizeDuoRecord,
  validateResponse,
} = require('../../src/kg/adapters/duo-schoolvestigingen.cjs');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/duo', name), 'utf8'));
}

describe('DUO schoolvestigingen', () => {
  it('valideert en normaliseert een echte BO-response', () => {
    const result = validateResponse(fixture('bo-amersfoort.json'));
    const record = normalizeDuoRecord(result.records[0], DATASETS[0]);
    assert.equal(record.sourceKey, 'duo:bo:07EX00');
    assert.equal(record.gemeente, 'AMERSFOORT');
    assert.match(record.contentHash, /^[a-f0-9]{64}$/);
  });

  it('filtert exact op vestigingsgemeente en niet op losse regiotekst', () => {
    assert.equal(isLocalRecord({ GEMEENTENAAM: 'Amersfoort' }), true);
    assert.equal(isLocalRecord({ GEMEENTENAAM: 'Leusden' }), true);
    assert.equal(isLocalRecord({ GEMEENTENAAM: 'Lelystad', 'ONDERWIJSGEBIED NAAM': 'Harderwijk-Amersfoort' }), false);
  });

  it('geeft een duidelijke fout bij schemadrift', () => {
    const payload = fixture('bo-amersfoort.json');
    payload.result.fields = payload.result.fields.filter(field => field.id !== 'VESTIGINGSCODE');
    assert.throws(() => validateResponse(payload), /VESTIGINGSCODE/);
  });

  it('detecteert alleen semantische registerwijzigingen', () => {
    const result = validateResponse(fixture('vo-leusden.json'));
    const current = normalizeDuoRecord(result.records[0], DATASETS[1]);
    assert.deepEqual(diffRecord(current, current), []);
    const moved = { ...current, straat: 'Nieuweweg', contentHash: 'anders' };
    assert.deepEqual(diffRecord(current, moved).map(change => change.type), ['SCHOOL_ADDRESS_CHANGED']);
  });
});
