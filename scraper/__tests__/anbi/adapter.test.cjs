const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAnbiRecords,
  filterLocal,
  recordKey,
  anbiSemanticHash,
  discoverDownloadUrl,
  normalizePlace,
} = require('../../src/kg/adapters/anbi-register.cjs');

// — Fixtures als in-memory sheets (hetzelfde formaat als parseXlsx retourneert) —

/** Minimale fixture: header + drie rijen, twee lokaal. */
function makeSheets(rows) {
  return [{
    name: 'xl/worksheets/sheet1.xml',
    rows: [
      ['RSIN', 'dossiernummer', 'naam', 'vestigingsplaats', 'website', 'ingangsdatum'],
      ...rows,
    ],
  }];
}

const ROWS_BASIC = [
  ['123456789', 'D001', 'Stichting Lokaal', 'Amersfoort', 'https://lokaal.nl', '2020-01-01'],
  ['987654321', 'D002', 'Stichting Elders', 'Utrecht', 'https://elders.nl', '2021-03-15'],
  ['111111111', 'D003', 'Leusden Helpt', 'Leusden', '', '2022-06-01'],
];

const LANDING_HTML = `
<html><body>
  <a href="https://download.belastingdienst.nl/anbi/ANBI_2026.zip">Download gecomprimeerd bestand</a>
  <a href="/iets-anders">Meer informatie</a>
</body></html>
`;

const LANDING_HTML_XLSX = `
<html><body>
  <a href="/data/anbi-export.xlsx">ANBI-bestand downloaden</a>
</body></html>
`;

describe('ANBI-adapter parsercontract', () => {
  it('parseert sheets en vindt records met RSIN-kolom', () => {
    const sheets = makeSheets(ROWS_BASIC);
    const records = parseAnbiRecords(sheets);
    assert.equal(records.length, 3);
    assert.equal(records[0].rsin, '123456789');
    assert.equal(records[0].naam, 'Stichting Lokaal');
    assert.equal(records[1].vestigingsplaats, 'Utrecht');
  });

  it('filtert op lokale vestigingsplaats (Amersfoort en Leusden)', () => {
    const sheets = makeSheets(ROWS_BASIC);
    const all = parseAnbiRecords(sheets);
    const local = filterLocal(all);
    assert.equal(local.length, 2);
    assert.deepEqual(local.map(r => r.naam), ['Stichting Lokaal', 'Leusden Helpt']);
  });

  it('negeert hoofdletters en witruimte bij plaatsfiltering', () => {
    const sheets = makeSheets([
      ['222222222', 'D004', 'Test', '  AMERSFOORT  ', '', ''],
      ['333333333', 'D005', 'Test2', 'amersfoort', '', ''],
    ]);
    const local = filterLocal(parseAnbiRecords(sheets));
    assert.equal(local.length, 2);
  });

  it('slaat lege rijen en rijen zonder identifier over', () => {
    const sheets = makeSheets([
      ['', '', '', 'Amersfoort', '', ''],
      ['444444444', 'D006', 'Met ID', 'Amersfoort', '', ''],
    ]);
    const records = parseAnbiRecords(sheets);
    assert.equal(records.length, 1);
    assert.equal(records[0].rsin, '444444444');
  });

  it('vindt headers in de eerste 10 rijen ook met lege voorloopregels', () => {
    const sheets = [{
      name: 'xl/worksheets/sheet1.xml',
      rows: [
        ['', '', '', '', '', ''],
        ['Metadata: versie 2.0'],
        ['RSIN', 'dossiernummer', 'naam', 'vestigingsplaats', 'website', 'ingangsdatum'],
        ['555555555', 'D007', 'Laat Gevonden', 'Amersfoort', '', ''],
      ],
    }];
    const records = parseAnbiRecords(sheets);
    assert.equal(records.length, 1);
    assert.equal(records[0].naam, 'Laat Gevonden');
  });

  it('meldt schemadrift wanneer geen herkenbare header bestaat', () => {
    const sheets = [{
      name: 'xl/worksheets/sheet1.xml',
      rows: [
        ['kolom_a', 'kolom_b', 'kolom_c'],
        ['waarde', 'waarde', 'waarde'],
      ],
    }];
    const records = parseAnbiRecords(sheets);
    assert.equal(records.length, 0, 'geen records zonder herkenbare header');
  });
});

describe('ANBI-adapter semantische hash en sleutel', () => {
  it('recordKey kiest RSIN boven dossiernummer', () => {
    assert.equal(recordKey({ rsin: '123', dossiernummer: 'D1' }), '123');
    assert.equal(recordKey({ rsin: '', dossiernummer: 'D1' }), 'D1');
  });

  it('semanticHash is deterministisch en verandert bij inhoudelijke wijziging', () => {
    const a = { rsin: '123', dossiernummer: 'D1', naam: 'Test', vestigingsplaats: 'Amersfoort', website: '' };
    const b = { ...a, naam: 'Test Gewijzigd' };
    assert.equal(anbiSemanticHash(a), anbiSemanticHash(a), 'zelfde input → zelfde hash');
    assert.notEqual(anbiSemanticHash(a), anbiSemanticHash(b), 'andere naam → andere hash');
  });

  it('semanticHash is gevoelig voor website maar niet voor onbekende velden', () => {
    const base = { rsin: '123', dossiernummer: '', naam: 'X', vestigingsplaats: 'Y', website: '' };
    const metSite = { ...base, website: 'https://x.nl' };
    const metExtra = { ...base, onbekend_veld: 'negeer mij' };
    assert.notEqual(anbiSemanticHash(base), anbiSemanticHash(metSite));
    assert.equal(anbiSemanticHash(base), anbiSemanticHash(metExtra));
  });
});

describe('ANBI-adapter diff-logica', () => {
  // Importeer de klasse zelf voor diff-tests
  const { AnbiRegisterAdapter } = require('../../src/kg/adapters/anbi-register.cjs');

  it('detecteert nieuwe ANBI bij eerste snapshot', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const records = [
      { rsin: '100', dossiernummer: 'D1', naam: 'Nieuw', vestigingsplaats: 'Amersfoort', website: '' },
    ];
    const events = adapter._diff(records, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ANBI_ADDED');
    assert.equal(events[0].key, '100');
  });

  it('detecteert naamswijziging', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const prev = {
      '100': { hash: anbiSemanticHash({ rsin: '100', dossiernummer: '', naam: 'Oud', vestigingsplaats: 'Amersfoort', website: '' }),
        rsin: '100', dossiernummer: '', naam: 'Oud', vestigingsplaats: 'Amersfoort', website: '' },
    };
    const current = [{ rsin: '100', dossiernummer: '', naam: 'Nieuw', vestigingsplaats: 'Amersfoort', website: '' }];
    const events = adapter._diff(current, prev);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ANBI_NAME_CHANGED');
  });

  it('detecteert websitewijziging', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const prev = {
      '200': { hash: anbiSemanticHash({ rsin: '200', dossiernummer: '', naam: 'Test', vestigingsplaats: 'Amersfoort', website: '' }),
        rsin: '200', dossiernummer: '', naam: 'Test', vestigingsplaats: 'Amersfoort', website: '' },
    };
    const current = [{ rsin: '200', dossiernummer: '', naam: 'Test', vestigingsplaats: 'Amersfoort', website: 'https://nieuw.nl' }];
    const events = adapter._diff(current, prev);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ANBI_WEBSITE_CHANGED');
  });

  it('markeert verdwijning als pending bij eerste afwezigheid (tweerunsbevestiging)', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const prev = {
      '300': { hash: 'x', rsin: '300', naam: 'Verdwenen', vestigingsplaats: 'Amersfoort', website: '' },
    };
    const events = adapter._diff([], prev);
    // Eerste keer afwezig: geen ANBI_REMOVED event, alleen pending
    assert.equal(events.length, 0, 'eerste afwezigheid mag geen REMOVED opleveren');
    assert.ok(adapter._pendingRemovals['300'], 'moet als pending gemarkeerd zijn');
    assert.ok(adapter._pendingRemovals['300']._pending_removal, 'pending_removal flag moet gezet zijn');
  });

  it('bevestigt verwijdering pas na twee opeenvolgende afwezigheden', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    // Simuleer snapshot na eerste afwezigheid (met _pending_removal flag)
    const prev = {
      '300': { hash: 'x', rsin: '300', naam: 'Verdwenen', vestigingsplaats: 'Amersfoort', website: '', _pending_removal: true },
    };
    const events = adapter._diff([], prev);
    assert.equal(events.length, 1, 'tweede afwezigheid moet REMOVED opleveren');
    assert.equal(events[0].type, 'ANBI_REMOVED');
    assert.equal(events[0].key, '300');
  });

  it('produceert geen event bij derde afwezigheid na bevestigde removal', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    // Simuleer snapshot na bevestigde verwijdering (tweede afwezigheid)
    const prev = {
      '300': { hash: 'x', rsin: '300', naam: 'Verdwenen', vestigingsplaats: 'Amersfoort', website: '', _pending_removal: true },
    };
    // Tweede run: bevestigt verwijdering
    const events2 = adapter._diff([], prev);
    assert.equal(events2.length, 1, 'tweede afwezigheid moet REMOVED opleveren');
    assert.equal(events2[0].type, 'ANBI_REMOVED');

    // De entry mag NIET in _pendingRemovals zitten (definitief verwijderd)
    assert.ok(!adapter._pendingRemovals['300'], 'bevestigde removal mag niet als pending bewaard worden');

    // Bouw het volgende snapshot: alleen de pending removals komen erin
    // Simuleer een derde run met een leeg snapshot (entry is verdwenen)
    const adapter3 = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const nextSnapshot = {}; // entry '300' is er niet meer
    const events3 = adapter3._diff([], nextSnapshot);
    assert.equal(events3.length, 0, 'derde afwezigheid na bevestigde removal mag geen event opleveren');
  });

  it('annuleert pending removal als RSIN terugkomt', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const prev = {
      '300': { hash: 'x', rsin: '300', naam: 'Verdwenen', vestigingsplaats: 'Amersfoort', website: '', _pending_removal: true },
    };
    const current = [{ rsin: '300', dossiernummer: '', naam: 'Verdwenen', vestigingsplaats: 'Amersfoort', website: '' }];
    const events = adapter._diff(current, prev);
    // Record is terug, dus geen REMOVED en niet meer pending
    const removed = events.filter(e => e.type === 'ANBI_REMOVED');
    assert.equal(removed.length, 0, 'terugkerend RSIN mag niet verwijderd worden');
  });

  it('produceert nul events bij identiek snapshot (idempotentie)', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const record = { rsin: '400', dossiernummer: '', naam: 'Stabiel', vestigingsplaats: 'Amersfoort', website: '' };
    const prev = {
      '400': { hash: anbiSemanticHash(record), ...record },
    };
    const events = adapter._diff([record], prev);
    assert.equal(events.length, 0, 'geen events bij identieke data');
  });

  it('detecteert gelijktijdige naam- en websitewijziging als twee events', () => {
    const adapter = new AnbiRegisterAdapter({ db: {}, dryRun: true });
    const prev = {
      '500': { hash: anbiSemanticHash({ rsin: '500', dossiernummer: '', naam: 'Oud', vestigingsplaats: 'Amersfoort', website: 'https://oud.nl' }),
        rsin: '500', dossiernummer: '', naam: 'Oud', vestigingsplaats: 'Amersfoort', website: 'https://oud.nl' },
    };
    const current = [{ rsin: '500', dossiernummer: '', naam: 'Nieuw', vestigingsplaats: 'Amersfoort', website: 'https://nieuw.nl' }];
    const events = adapter._diff(current, prev);
    assert.equal(events.length, 2);
    const types = events.map(e => e.type).sort();
    assert.deepEqual(types, ['ANBI_NAME_CHANGED', 'ANBI_WEBSITE_CHANGED']);
  });
});

describe('ANBI-adapter downloadlink-detectie', () => {
  it('vindt een ZIP-downloadlink op de landingspagina', () => {
    const url = discoverDownloadUrl(LANDING_HTML);
    assert.equal(url, 'https://download.belastingdienst.nl/anbi/ANBI_2026.zip');
  });

  it('vindt een XLSX-link als fallback', () => {
    const url = discoverDownloadUrl(LANDING_HTML_XLSX);
    assert.ok(url, 'moet een URL vinden');
    assert.ok(url.includes('.xlsx'), 'moet een XLSX-link zijn');
  });

  it('retourneert null wanneer geen downloadlink bestaat', () => {
    const url = discoverDownloadUrl('<html><body><p>Geen links</p></body></html>');
    assert.equal(url, null);
  });
});

describe('ANBI-adapter normalizePlace', () => {
  it('normaliseert plaatsnamen case-insensitive', () => {
    assert.equal(normalizePlace('Amersfoort'), 'amersfoort');
    assert.equal(normalizePlace('  LEUSDEN  '), 'leusden');
    assert.equal(normalizePlace(''), '');
    assert.equal(normalizePlace(null), '');
  });
});
