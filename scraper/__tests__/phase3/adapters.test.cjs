const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const FIXTURES = path.join(__dirname, '../fixtures/phase3');
const fixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const { isRecoveredUnconfirmed, missingTransition, parseDelimited, requireColumns, semanticHash } = require('../../src/kg/phase3-core.cjs');
const { parseAfmCsv, parseAfmXml } = require('../../src/kg/adapters/afm-register.cjs');
const { parseDnbCsv } = require('../../src/kg/adapters/dnb-register.cjs');
const { isLocalProject, parseRvoCsv, numberNl } = require('../../src/kg/adapters/rvo-projecten.cjs');
const { parseSru } = require('../../src/kg/adapters/koop-nonmunicipal.cjs');
const { parseNdwXml, pointInGeometry, pointInGeometryBuffered } = require('../../src/kg/adapters/ndw-planning.cjs');
const { assessInspectionChange, duoBranchCode, normalizeInspectionRecord } = require('../../src/kg/adapters/onderwijsinspectie-kwaliteit.cjs');
const { assessCrimePoint, backtestCrime, robustZ } = require('../../src/kg/adapters/politie-cbs-anomalies.cjs');
const { R5_CRIME_ANOMALY, R11_SCHOOL_ENROLLMENT, R12_SCHOOL_FORECAST } = require('../../src/kg/detection-rules.cjs');
const { evaluateHistoricalClusters } = require('../../backtest-phase3.cjs');

describe('fase 3 broncontracten', () => {
  it('parseert quoted CSV deterministisch en meldt schemadrift', () => {
    const rows = parseDelimited('a;b\n"x;y";z\n', ';');
    assert.deepEqual(rows, [{ a: 'x;y', b: 'z' }]);
    assert.throws(() => requireColumns(rows, ['c'], 'test'), /schemadrift/);
    assert.equal(semanticHash({ b: 2, a: ' x ' }), semanticHash({ a: 'x', b: 2 }));
  });

  it('bevestigt verwijdering pas na twee runs en onderdrukt tijdelijk verdwijnen', () => {
    const first = missingTransition('bron:1', { hash: 'origineel', changeType: 'added', record: { sourceKey: 'bron:1' } });
    assert.equal(first.confirmed, false); assert.equal(first.tombstone._missingCount, 1);
    assert.equal(isRecoveredUnconfirmed({ hash: first.tombstone.semanticHash, changeType: 'changed', record: first.tombstone }, 'origineel'), true);
    const second = missingTransition('bron:1', { hash: first.tombstone.semanticHash, changeType: 'changed', record: first.tombstone });
    assert.equal(second.confirmed, true); assert.equal(second.tombstone._priorSemanticHash, 'origineel');
  });

  it('filtert AFM uitsluitend op exacte lokale vestigingsplaats', () => {
    const rows = parseAfmCsv(fixture('afm.csv'));
    assert.deepEqual(rows.map(row => row.name), ['Lokale Adviseur B.V.', 'Leusdense Financiën']);
  });

  it('leest uit de volledige AFM-XML ook KVK, vergunning en product/dienst', () => {
    const parsed = parseAfmXml(fixture('afm.xml'));
    assert.equal(parsed.nationalRows, 2); assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].kvk, '12345678'); assert.equal(parsed.records[0].licenses[0].number, '12000001');
    assert.equal(parsed.records[0].licenses[0].products[0].services[0].name, 'Adviseren');
  });

  it('filtert DNB op plaats of harde watchlist, niet op een handelsnaamwoord', () => {
    assert.deepEqual(parseDnbCsv(fixture('dnb.csv')).map(row => row.relation), ['B100']);
    assert.deepEqual(parseDnbCsv(fixture('dnb.csv'), new Set(['kvk:87654321'])).map(row => row.relation), ['B100', 'B200']);
  });

  it('filtert RVO via officiële geometrie of expliciete plaats en leest Nederlandse bedragen', () => {
    const boundaries = [{ type: 'Feature', properties: { gemeentecode: 'GM0307' }, geometry: { type: 'Polygon', coordinates: [[[5.3,52.1],[5.5,52.1],[5.5,52.2],[5.3,52.2],[5.3,52.1]]] } }];
    const rows = parseRvoCsv(fixture('rvo.csv'), boundaries);
    assert.deepEqual(rows.map(row => row.projectNumber), ['RVO-1']);
    assert.equal(numberNl('150.000,00'), 150000);
    assert.equal(isLocalProject({ Aanvrager: '87654321|Elders B.V.', Projecttitel: '', Projectbeschrijving: '', Partners: '' }, [], new Set(['kvk:87654321'])), true);
  });

  it('dedupliceert KOOP op officiële identifier en eist lokale metadata', () => {
    const rows = parseSru(fixture('koop.xml'), 'Staatscourant');
    assert.equal(rows.length, 1); assert.equal(rows[0].identifier, 'stcrt-2026-1');
  });

  it('filtert NDW geometrisch en negeert een Amersfoortseweg buiten de grens', () => {
    const boundary = { type: 'Feature', properties: { gemeentenaam: 'Amersfoort', gemeentecode: 'GM0307' }, geometry: { type: 'Polygon', coordinates: [[[5.3,52.1],[5.5,52.1],[5.5,52.2],[5.3,52.2],[5.3,52.1]]] } };
    assert.equal(pointInGeometry([5.38, 52.15], boundary.geometry), true);
    assert.equal(pointInGeometryBuffered([5.295, 52.15], boundary.geometry, 1), true);
    assert.equal(pointInGeometryBuffered([5.2, 52.15], boundary.geometry, 1), false);
    const rows = parseNdwXml(fixture('ndw.xml'), [boundary], new Date('2026-09-13T00:00:00Z'));
    assert.equal(rows.length, 1); assert.equal(rows[0].closure, true); assert.equal(rows[0].sourceKey, 'ndw:NDW_LOCAL:REC1');
  });

  it('koppelt Inspectie-pseudocode aan DUO en onderdrukt ontbrekende oordelen', () => {
    const element = { id: 1, pseudocode: '00ML|05', naam: 'School', sectorcode: 'VO', town: 'Amersfoort', eigenschappen: { eigenschappen: [] } };
    assert.equal(duoBranchCode(element), '00ML05');
    const current = normalizeInspectionRecord(element, { oordeel: { effectieveWaardeomschrijving: 'Zeer zwak', dimensieomschrijving: 'Kwaliteit' }, indicatoren: {} }, [{ rapportnummer: 7, publicatienaam: 'Onderzoek', vaststellingsdatum: '12-09-2026' }]);
    assert.equal(assessInspectionChange('changed', current, { ...current, judgment: 'Voldoende', reports: [] }).direction, 'worse');
    assert.equal(assessInspectionChange('changed', { ...current, judgment: '' }, current), null);
  });

  it('onderdrukt kleine politieaantallen en detecteert een robuust tweemaandenpatroon', async () => {
    const area = 'BU03070000', crime = '1.1.1', periods = [];
    for (let year = 2021; year <= 2025; year++) for (let month = 1; month <= 12; month++) periods.push({ WijkenEnBuurten: area, SoortMisdrijf: crime, Perioden: `${year}MM${String(month).padStart(2,'0')}`, GeregistreerdeMisdrijven_1: 5 });
    periods.push({ WijkenEnBuurten: area, SoortMisdrijf: crime, Perioden: '2026MM01', GeregistreerdeMisdrijven_1: 10 });
    periods.push({ WijkenEnBuurten: area, SoortMisdrijf: crime, Perioden: '2026MM02', GeregistreerdeMisdrijven_1: 14 });
    periods.push({ WijkenEnBuurten: 'GM0307', SoortMisdrijf: crime, Perioden: '2025MM02', GeregistreerdeMisdrijven_1: 100 });
    periods.push({ WijkenEnBuurten: 'GM0307', SoortMisdrijf: crime, Perioden: '2026MM02', GeregistreerdeMisdrijven_1: 105 });
    const areas = new Map([[area, { municipality: 'GM0307', name: 'Buurt' }]]);
    assert.equal(assessCrimePoint({ WijkenEnBuurten: area, SoortMisdrijf: crime, Perioden: '2026MM03', GeregistreerdeMisdrijven_1: 3 }, periods, areas).reason, 'minimum_count');
    const result = assessCrimePoint(periods.find(row => row.Perioden === '2026MM02' && row.WijkenEnBuurten === area), periods, areas);
    assert.equal(result.anomaly, true); assert.ok(robustZ(14, [5,5,5,5,5,5]) >= 3.5);
    const event = { provenance: JSON.stringify({ ...result, reason: 'trigger', map_year: 2025 }) };
    assert.equal(await R5_CRIME_ANOMALY.condition(event), true);
  });

  it('backtest 24 maanden telt onderdrukking en multi-sourceclusters uitlegbaar', () => {
    const rows = []; for (let month = 1; month <= 24; month++) rows.push({ WijkenEnBuurten: 'BU1', SoortMisdrijf: 'X', Perioden: `2024MM${String(month).padStart(2,'0')}`, GeregistreerdeMisdrijven_1: 1 });
    const result = backtestCrime(rows, new Map([['BU1', { municipality: 'GM1' }]]), 24); assert.equal(result.months, 24); assert.equal(result.signals, 0);
    const history = evaluateHistoricalClusters([{ signal_id: 1, source_id: 10, published_at: '2025-01-01', status: 'published' },
      { signal_id: 1, source_id: 11, published_at: '2025-01-15', status: 'published' }], 24);
    assert.equal(history.within90, 1); assert.equal(history.retainedRate, 1);
  });

  it('reserveert oorspronkelijke regelnummers en verplaatst DUO naar R11/R12', () => {
    assert.equal(R5_CRIME_ANOMALY.id, 'R5'); assert.equal(R11_SCHOOL_ENROLLMENT.id, 'R11'); assert.equal(R12_SCHOOL_FORECAST.id, 'R12');
  });
});
