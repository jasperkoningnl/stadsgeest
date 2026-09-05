// Tests voor entity-resolver scoring — Stadsgeest 2.0
// Draait met: node --test __tests__/entity-resolution/scoring.test.cjs
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStr, SCORES, THRESHOLDS } = require('../../src/kg/entity-resolver.cjs');

describe('normalizeStr', () => {
  it('lowercase en strip punten', () => {
    assert.equal(normalizeStr('Mr. J. de Vries'), 'mr j de vries');
  });

  it('dubbele spaties samenvoegen', () => {
    assert.equal(normalizeStr('Gemeente  Amersfoort'), 'gemeente amersfoort');
  });

  it('lege string', () => {
    assert.equal(normalizeStr(''), '');
    assert.equal(normalizeStr(null), '');
    assert.equal(normalizeStr(undefined), '');
  });

  it('trim', () => {
    assert.equal(normalizeStr('  Meander MC  '), 'meander mc');
  });
});

describe('SCORES', () => {
  it('identifier is het sterkste signaal', () => {
    assert.ok(SCORES.EXACT_IDENTIFIER > SCORES.WEBSITE_DOMAIN);
    assert.ok(SCORES.EXACT_IDENTIFIER > SCORES.EXACT_NAME);
  });

  it('website > BAG > naam', () => {
    assert.ok(SCORES.WEBSITE_DOMAIN > SCORES.BAG_ADDRESS);
    assert.ok(SCORES.BAG_ADDRESS > SCORES.EXACT_NAME);
    assert.ok(SCORES.EXACT_NAME > SCORES.NORMALIZED_NAME);
  });
});

describe('THRESHOLDS', () => {
  it('personen mogen niet auto-mergen op naam alleen', () => {
    // Naam geeft max 35 punten → ver onder PERSON_MIN van 110
    assert.ok(SCORES.EXACT_NAME < THRESHOLDS.PERSON_MIN);
    assert.ok(SCORES.EXACT_NAME + SCORES.NORMALIZED_NAME < THRESHOLDS.PERSON_MIN);
  });

  it('KvK-match alleen is genoeg voor auto-merge', () => {
    assert.ok(SCORES.EXACT_IDENTIFIER >= THRESHOLDS.AUTO_MERGE);
  });

  it('naam + website gaat naar review (80 < 90)', () => {
    const combined = SCORES.EXACT_NAME + SCORES.WEBSITE_DOMAIN;
    assert.ok(combined >= THRESHOLDS.REVIEW, 'naam + website moet >= review-drempel zijn');
    assert.ok(combined < THRESHOLDS.AUTO_MERGE, 'naam + website mag niet auto-mergen');
  });

  it('naam alleen gaat naar review voor organisatie', () => {
    assert.ok(SCORES.EXACT_NAME < THRESHOLDS.AUTO_MERGE);
    // naam (35) is onder review-drempel (70), dus zelfs geen review
    assert.ok(SCORES.EXACT_NAME < THRESHOLDS.REVIEW);
  });
});
