const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseDetailHtml } = require('../../src/kg/adapters/asbestovertredingen.cjs');

describe('Asbestovertredingen detailparser', () => {
  it('leest de officiële h2/p-structuur zonder footer als stillegging te zien', () => {
    const html = fs.readFileSync(path.join(__dirname, '../fixtures/asbest/stichting-s-heeren-loo.html'), 'utf8');
    const detail = parseDetailHtml(html, '72501359-stichting-s-heeren-loo-zorggroep');
    assert.equal(detail.bedrijf, "Stichting 's Heeren Loo Zorggroep");
    assert.equal(detail.plaatsOvertreder, 'Amersfoort');
    assert.equal(detail.locatieText, 'Groene Allee 74 - Ermelo');
    assert.equal(detail.datum, '23-01-2025');
    assert.equal(detail.besluit, 'Boete');
    assert.equal(detail.stillegging, '');
    assert.match(detail.overtredingen, /Artikel 4\.54d/);
  });
});
