const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalEventRecords, exactLocality, localRowMatch, objectsFromSheet, parseOds, parseOdsFiltered, parseXlsx,
  tabularLocalRecords, zipEntries,
} = require('../../src/kg/phase4-core.cjs');
const {
  R8_FREQUENT_LOCAL_SPEAKER, R15_CARE_YEAR_OVER_YEAR, R16_HOUSING_YEAR_OVER_YEAR,
} = require('../../src/kg/detection-rules.cjs');
const { ADAPTERS, summarizeRun } = require('../../src/kg/detection-run.cjs');
const { extractGovernanceFacts, parseMunicipalCalendar, summarizeSensorThings } = require('../../src/kg/adapters/phase4-context-sources.cjs');
const { buildCareComparisons, buildDpiComparisons, eventForCare, eventForDpi } = require('../../src/kg/adapters/phase4-official-datasets.cjs');
const { siteNameMatches } = require('../../src/kg/adapters/phase4-official-datasets.cjs');

const FIXTURES = path.join(__dirname, '../fixtures/phase4');

function storedZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(value);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes); offset += local.length + nameBytes.length + data.length;
  }
  const centralData = Buffer.concat(centrals); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(centralData.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralData, eocd]);
}

test('fase 4 lokale filters accepteren alleen exacte doelgemeenten of hard KVK', () => {
  assert.equal(exactLocality('Gemeente Amersfoort'), true);
  assert.equal(exactLocality('Leusden'), true);
  assert.equal(exactLocality('Amersfoort aan de Maas'), false);
  assert.equal(localRowMatch({ gemeente: 'Utrecht', kvk_nummer: '12345678' }, { localKvks: new Set(['12345678']) }).method, 'hard_kvk');
  assert.equal(localRowMatch({ toelichting: 'actief in Amersfoort' }).local, false);
});

test('XLSX- en ODS-contracten lezen tabellen en signaleren kapotte containers', async () => {
  const xlsx = storedZip({
    'xl/sharedStrings.xml': '<sst><si><t>Gemeente</t></si><si><t>Naam</t></si><si><t>Amersfoort</t></si><si><t>Voorbeeld</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>',
  });
  const sheets = parseXlsx(xlsx); assert.equal(objectsFromSheet(sheets[0], [/gemeente/]).length, 1);
  assert.equal(tabularLocalRecords(sheets, { prefix: 'dpi', sourceUrl: 'fixture' }).length, 1);
  const ods = storedZip({ 'content.xml': '<office:document-content><table:table table:name="Data"><table:table-row><table:table-cell><text:p>Vestigingsplaats</text:p></table:table-cell><table:table-cell><text:p>Naam</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>Leusden</text:p></table:table-cell><table:table-cell><text:p>Zorg BV</text:p></table:table-cell></table:table-row></table:table></office:document-content>' });
  assert.equal(tabularLocalRecords(parseOds(ods), { prefix: 'care', sourceUrl: 'fixture' }).length, 1);
  assert.equal(tabularLocalRecords(await parseOdsFiltered(ods), { prefix: 'care', sourceUrl: 'fixture' }).length, 1);
  assert.throws(() => zipEntries(Buffer.from('geen zip')), /centraal register/);
  assert.throws(() => parseXlsx(storedZip({ 'doc.txt': 'leeg' })), /geen werkbladen/);
});

test('ODS-streamfilter draagt een lokaal KVK veilig over naar financiële tabellen', async () => {
  const row = cells => `<table:table-row>${cells.map(value => `<table:table-cell><text:p>${value}</text:p></table:table-cell>`).join('')}</table:table-row>`;
  const ods = storedZip({ 'content.xml': `<office:document-content><table:table table:name="Organisaties">${row(['kvknummer_externalorganizationid','plaats_town','naam_name'])}${row(['12345678','Amersfoort','Zorg A'])}</table:table><table:table table:name="Financieel">${row(['kvknummer_externalorganizationid','bedrijfsopbrengsten'])}${row(['12345678','1250000'])}${row(['99999999','9000000'])}</table:table></office:document-content>` });
  const localKvks = new Set(); const sheets = await parseOdsFiltered(ods, { localKvks });
  assert.equal(localKvks.has('12345678'), true);
  const records = tabularLocalRecords(sheets, { prefix: 'care', sourceUrl: 'fixture', localKvks });
  assert.equal(records.length, 2); assert.ok(records.some(record => record.data.bedrijfsopbrengsten === '1250000'));
});

test('jaar-op-jaarvergelijkingen gebruiken stabiele identiteiten en maken uitsluitend drempelevents', () => {
  const localMatch = { method: 'hard_kvk', evidence: ['kvk=12345678'] };
  const care2023 = { sheet: 'Financieel', data: { kvk_nummer: '12345678', naam: 'Zorg A', bedrijfsopbrengsten: '1000000' }, localMatch, sourceUrl: 'care-2023' };
  const care2024 = { sheet: 'Financieel', data: { kvk_nummer: '12345678', naam: 'Zorg A', bedrijfsopbrengsten: '1400000' }, localMatch, sourceUrl: 'care-2024' };
  const care = buildCareComparisons(new Map([[2023, [care2023]], [2024, [care2024]]])); assert.equal(care.length, 1);
  assert.equal(eventForCare('changed', care[0], null, 1).type, 'CARE_FINANCIAL_ANOMALY');
  const oldDpi = { data: { kvk_nummer: '12345678', daeb_indicatie: 'J', jaar: '2028', omschrijving: 'Nieuwbouw', type_veld: 'aantal', gemeente: 'Amersfoort', waarde: '100' }, localMatch, sourceUrl: 'dpi-2024' };
  const newDpi = { ...oldDpi, data: { ...oldDpi.data, waarde: '140' }, sourceUrl: 'dpi-2025' };
  const dpi = buildDpiComparisons([oldDpi], [newDpi], 2024, 2025); assert.equal(dpi.length, 1);
  const event = eventForDpi('changed', dpi[0], null, 1); assert.equal(event.type, 'HOUSING_INVESTMENT_ANOMALY'); assert.equal(event.journalisticallyRelevant, true);
});

test('SEVESO-identiteit verdraagt alleen een kleine officiële naamvariant', () => {
  assert.equal(siteNameMatches('Handelmaatschappij A. Smit & Zn. B.V.', 'Handelsmaatschappij A. Smit & Zn. B.V.'), true);
  assert.equal(siteNameMatches('Smitters Transport B.V.', 'Handelsmaatschappij A. Smit & Zn. B.V.'), false);
});

test('UITagenda gebruikt JSON-LD, exacte plaats en expliciete persoonsrol', () => {
  const html = fs.readFileSync(path.join(FIXTURES, 'uitagenda.html'), 'utf8');
  const records = canonicalEventRecords(html, 'fixture'); assert.equal(records.length, 1);
  assert.equal(records[0].locality, 'Amersfoort'); assert.deepEqual(records[0].participants, ['Ada Voorbeeld']);
  assert.equal(records[0].occurredAt, records[0].start);
  assert.equal(canonicalEventRecords('<script type="application/ld+json">kapot</script>', 'fixture').length, 0);
});

test('gemeentekalender en governance-extractie bewaren hun journalistieke beperkingen', () => {
  const lines = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'calendar-lines.json'), 'utf8'));
  const calendar = parseMunicipalCalendar(lines, 2026, 'fixture'); assert.equal(calendar.length, 2);
  assert.ok(calendar.every(record => record.permitStatus === 'not_granted_by_calendar'));
  const governance = extractGovernanceFacts(fs.readFileSync(path.join(FIXTURES, 'governance.html'), 'utf8'), { organization: 'Lokale organisatie', url: 'fixture', kind: 'TOEZICHTHOUDER' });
  assert.ok(governance.length >= 2); assert.ok(governance.every(record => record.sourceClass === 'DECLARED_BY_ENTITY'));
});

test('Samen Meten filtert met de officiële polygoon en houdt kwaliteitslabels', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'sensor-things.json'), 'utf8'));
  const boundaries = [{ properties: { gm_naam: 'Amersfoort' }, geometry: { type: 'Polygon', coordinates: [[[5.3,52.1],[5.5,52.1],[5.5,52.2],[5.3,52.2],[5.3,52.1]]] } }];
  const records = summarizeSensorThings(payload, boundaries); assert.equal(records.length, 1); assert.equal(records[0].observations[0].quality, 'indicatief');
  assert.equal(summarizeSensorThings({ value: [] }, boundaries).length, 0);
});

test('R8 vereist vier optredens, drie organisatoren en een gekoppelde lokale persoon', async () => {
  const rows = [1,2,3,4].map(id => ({ id, source_identifier: `event-${id}`, provenance: JSON.stringify({ current: { venue: `Podium ${id <= 2 ? 1 : id}` } }) }));
  const event = { id: 4, occurred_at: '2026-09-13T12:00:00Z' };
  const context = { entities: [{ id: 7, entity_type: 'person', canonical_name: 'Ada Voorbeeld' }], db: { execute: async () => ({ rows }) } };
  assert.equal(await R8_FREQUENT_LOCAL_SPEAKER.condition(event, context), true);
  const signal = await R8_FREQUENT_LOCAL_SPEAKER.createSignal(event, context); assert.equal(signal.tier, 3); assert.equal(signal.provenance.review_required, true);
});

test('jaar-op-jaarregels hanteren absolute én relatieve journalistieke drempels', async () => {
  assert.equal(await R15_CARE_YEAR_OVER_YEAR.condition({ provenance: JSON.stringify({ journalistically_relevant: true, absolute_change: 300000, relative_change: 0.16 }) }), true);
  assert.equal(await R15_CARE_YEAR_OVER_YEAR.condition({ provenance: JSON.stringify({ journalistically_relevant: true, absolute_change: 300000, relative_change: 0.02 }) }), false);
  assert.equal(await R16_HOUSING_YEAR_OVER_YEAR.condition({ provenance: JSON.stringify({ journalistically_relevant: true, absolute_change: 12, relative_change: 0.25 }) }), true);
  assert.equal(await R16_HOUSING_YEAR_OVER_YEAR.condition({ provenance: '{}' }), false);
});

test('orkestrator behoudt fase 3, registreert fase 4 en accepteert geldige nulscope', () => {
  const names = ADAPTERS.map(([name]) => name); for (const name of ['ndw','zorg-jaarverantwoording','dpi','uitagenda','evenementenkalender','rijksmonumenten','seveso','governance','samen-meten']) assert.ok(names.includes(name));
  assert.deepEqual(summarizeRun({ total: 0, scope: 'monthly-scope-check-only' }), { recordsFound: 0, recordsNew: 0, recordsChanged: 0, recordsRemoved: 0 });
  assert.equal(ADAPTERS.find(([name]) => name === 'samen-meten')[2].featureFlag, 'STADSGEEST_ENABLE_SAMEN_METEN');
});
