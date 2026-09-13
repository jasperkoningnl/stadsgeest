const zlib = require('zlib');
const { Readable } = require('stream');
const { StringDecoder } = require('string_decoder');
const { load } = require('cheerio');
const { normalizeText, normalizePlace, semanticHash } = require('./phase3-core.cjs');

const LOCAL_CODES = new Set(['GM0307', 'GM0327']);
const LOCAL_PLACES = new Set(['amersfoort', 'leusden']);

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function zipEntries(buffer) {
  const signature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === signature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('ZIP: centraal register ontbreekt');
  const count = buffer.readUInt16LE(eocd + 10);
  let central = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(central) !== 0x02014b50) throw new Error('ZIP: ongeldig centraal record');
    const method = buffer.readUInt16LE(central + 10);
    const compressedSize = buffer.readUInt32LE(central + 20);
    const uncompressedSize = buffer.readUInt32LE(central + 24);
    const nameLength = buffer.readUInt16LE(central + 28);
    const extraLength = buffer.readUInt16LE(central + 30);
    const commentLength = buffer.readUInt16LE(central + 32);
    const localOffset = buffer.readUInt32LE(central + 42);
    const name = buffer.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    if (!name.endsWith('/')) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP: lokaal record ontbreekt voor ${name}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(start, start + compressedSize);
      const data = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
      if (!data) throw new Error(`ZIP: compressiemethode ${method} niet ondersteund voor ${name}`);
      if (data.length !== uncompressedSize) throw new Error(`ZIP: uitgepakte lengte klopt niet voor ${name}`);
      entries.set(name, data);
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipEntryCompressed(buffer, wantedName) {
  const signature = 0x06054b50; let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) if (buffer.readUInt32LE(offset) === signature) { eocd = offset; break; }
  if (eocd < 0) throw new Error('ZIP: centraal register ontbreekt');
  const count = buffer.readUInt16LE(eocd + 10); let central = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index++) {
    const method = buffer.readUInt16LE(central + 10); const compressedSize = buffer.readUInt32LE(central + 20);
    const nameLength = buffer.readUInt16LE(central + 28); const extraLength = buffer.readUInt16LE(central + 30); const commentLength = buffer.readUInt16LE(central + 32);
    const localOffset = buffer.readUInt32LE(central + 42); const name = buffer.subarray(central + 46, central + 46 + nameLength).toString('utf8');
    if (name === wantedName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26); const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      return { method, compressed: buffer.subarray(start, start + compressedSize) };
    }
    central += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP: ${wantedName} ontbreekt`);
}

function columnIndex(reference) {
  const letters = String(reference || '').replace(/[^A-Z]/gi, '').toUpperCase();
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function xlsxCellValue(cellXml, sharedStrings) {
  const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];
  if (type === 'inlineStr') return decodeXml([...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(''));
  const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] || '';
  if (type === 's') return sharedStrings[Number(raw)] || '';
  if (type === 'b') return raw === '1';
  return decodeXml(raw);
}

function parseXlsx(buffer) {
  const entries = zipEntries(buffer);
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const sharedStrings = [...sharedXml.matchAll(/<si[\s>][\s\S]*?<\/si>/g)].map(match =>
    decodeXml([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(part => part[1]).join('')));
  const sheets = [];
  for (const [name, data] of [...entries].filter(([entry]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry)).sort()) {
    const rows = [];
    for (const rowMatch of data.toString('utf8').matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
      const row = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>[\s\S]*?<\/c>/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(cellMatch[1])?.[1];
        const index = ref ? columnIndex(ref) : row.length;
        row[index] = normalizeText(xlsxCellValue(cellMatch[0], sharedStrings));
      }
      if (row.some(Boolean)) rows.push(row.map(value => value ?? ''));
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('XLSX-schemadrift: geen werkbladen');
  return sheets;
}

function parseOdsRow(rowXml) {
  let repeatRows = Number(/table:number-rows-repeated="(\d+)"/.exec(rowXml)?.[1] || 1);
  const row = [];
  for (const cell of rowXml.matchAll(/<table:(?:table-cell|covered-table-cell)\b([^>]*)>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>|<table:(?:table-cell|covered-table-cell)\b([^>]*)\/>/g)) {
    const attrs = cell[1] || cell[3] || '';
    const repeat = Number(/table:number-columns-repeated="(\d+)"/.exec(attrs)?.[1] || 1);
    if (repeat > 25000) throw new Error(`ODS-schemadrift: onveilige kolomherhaling ${repeat}`);
    const text = normalizeText(decodeXml([...(cell[2] || '').matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)]
      .map(match => match[1].replace(/<[^>]+>/g, ' ')).join(' ')));
    for (let i = 0; i < repeat; i++) row.push(text);
  }
  if (repeatRows > 1000) {
    if (row.some(Boolean)) throw new Error(`ODS-schemadrift: onveilige niet-lege rijherhaling ${repeatRows}`);
    repeatRows = 0;
  }
  return { row, repeatRows };
}

function parseOds(buffer, options = {}) {
  const entries = zipEntries(buffer);
  const xml = entries.get('content.xml');
  if (!xml) throw new Error('ODS-schemadrift: content.xml ontbreekt');
  const sheets = [];
  const tableStartNeedle = Buffer.from('<table:table'); const tableEndNeedle = Buffer.from('</table:table>');
  const rowStartNeedle = Buffer.from('<table:table-row'); const rowEndNeedle = Buffer.from('</table:table-row>');
  let tablePosition = 0; let totalRows = 0;
  while (tablePosition < xml.length) {
    let tableStart = xml.indexOf(tableStartNeedle, tablePosition);
    while (tableStart >= 0 && /[-\w:]/.test(String.fromCharCode(xml[tableStart + tableStartNeedle.length] || 0))) tableStart = xml.indexOf(tableStartNeedle, tableStart + tableStartNeedle.length);
    if (tableStart < 0) break;
    const openEnd = xml.indexOf(0x3e, tableStart); const tableEnd = xml.indexOf(tableEndNeedle, openEnd);
    if (openEnd < 0 || tableEnd < 0) throw new Error('ODS-schemadrift: onvolledige tabel');
    const opening = xml.subarray(tableStart, openEnd + 1).toString('utf8');
    const sheetName = decodeXml(/table:name="([^"]*)"/.exec(opening)?.[1] || `sheet-${sheets.length + 1}`);
    const rows = [];
    let rowPosition = openEnd + 1; let seenRows = 0;
    while (rowPosition < tableEnd) {
      const rowStart = xml.indexOf(rowStartNeedle, rowPosition); if (rowStart < 0 || rowStart >= tableEnd) break;
      const rowEnd = xml.indexOf(rowEndNeedle, rowStart); if (rowEnd < 0 || rowEnd >= tableEnd) throw new Error('ODS-schemadrift: onvolledige rij');
      const rowXml = xml.subarray(rowStart, rowEnd + rowEndNeedle.length).toString('utf8');
      const { row, repeatRows } = parseOdsRow(rowXml); seenRows += repeatRows; totalRows += repeatRows;
      const searchable = new Set(row.map(value => normalizeText(value).toLocaleLowerCase('nl-NL')));
      const hardKvk = options.localKvks && row.some(value => options.localKvks.has(String(value).replace(/\D/g, '')));
      const keep = !options.localOnly || rows.length < 100 || searchable.has('amersfoort') || searchable.has('gemeente amersfoort') || searchable.has('leusden') || searchable.has('gemeente leusden') || hardKvk;
      if (keep && row.some(Boolean)) for (let i = 0; i < repeatRows; i++) rows.push(row);
      rowPosition = rowEnd + rowEndNeedle.length;
    }
    if (rows.length) sheets.push({ name: sheetName, rows, totalRows: seenRows });
    tablePosition = tableEnd + tableEndNeedle.length;
  }
  if (!sheets.length) throw new Error('ODS-schemadrift: geen werkbladen');
  sheets.totalRows = totalRows;
  return sheets;
}

async function parseOdsFiltered(buffer, options = {}) {
  const entry = zipEntryCompressed(buffer, 'content.xml');
  const input = Readable.from(entry.compressed, { highWaterMark: 64 * 1024 });
  const stream = entry.method === 0 ? input : entry.method === 8 ? input.pipe(zlib.createInflateRaw()) : null;
  if (!stream) throw new Error(`ZIP: compressiemethode ${entry.method} niet ondersteund voor content.xml`);
  const decoder = new StringDecoder('utf8'); let pending = ''; let currentSheet = 'sheet-1'; let totalRows = 0;
  const sheets = new Map(); let kvkPattern = null; let kvkPatternSize = -1;
  function sheet() { if (!sheets.has(currentSheet)) sheets.set(currentSheet, { name: currentSheet, rows: [], totalRows: 0 }); return sheets.get(currentSheet); }
  function containsKnownKvk(rowXml) {
    const identities = [
      ...(options.localKvks || []).values(),
      ...[...(options.localSourceIds || []).values()].filter(value => String(value).length >= 3),
    ];
    if (!identities.length) return false;
    if (kvkPatternSize !== identities.length) {
      kvkPattern = new RegExp(`(?:${identities.map(value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`); kvkPatternSize = identities.length;
    }
    return kvkPattern?.test(rowXml) || false;
  }
  function consume(final = false) {
    while (true) {
      const tableAt = pending.indexOf('<table:table '); const rowAt = pending.indexOf('<table:table-row');
      if (tableAt >= 0 && (rowAt < 0 || tableAt < rowAt)) {
        const end = pending.indexOf('>', tableAt); if (end < 0) break;
        const opening = pending.slice(tableAt, end + 1); currentSheet = decodeXml(/table:name="([^"]*)"/.exec(opening)?.[1] || currentSheet);
        pending = pending.slice(end + 1); continue;
      }
      if (rowAt >= 0) {
        const end = pending.indexOf('</table:table-row>', rowAt); if (end < 0) { if (rowAt > 0) pending = pending.slice(rowAt); break; }
        const rowXml = pending.slice(rowAt, end + 18); const target = sheet();
        if (target.rows.length >= 5 && !/Amersfoort|Leusden/i.test(rowXml) && !containsKnownKvk(rowXml)) {
          const rawRepeat = Number(/table:number-rows-repeated="(\d+)"/.exec(rowXml)?.[1] || 1);
          const repeatRows = rawRepeat > 1000 ? parseOdsRow(rowXml).repeatRows : rawRepeat;
          target.totalRows += repeatRows; totalRows += repeatRows;
          pending = pending.slice(end + 18); continue;
        }
        const parsed = parseOdsRow(rowXml); target.totalRows += parsed.repeatRows; totalRows += parsed.repeatRows;
        const values = new Set(parsed.row.map(value => normalizeText(value).toLocaleLowerCase('nl-NL')));
        if (target.identifierIndexes === undefined) {
          const indexes = parsed.row.map((value, index) => ({ value: normalizeText(value), index })).filter(item => /kvknummer.*externalorganizationid|kvk_nummer|handelsregister|concerncode[\s_]*code/i.test(item.value));
          if (indexes.length) {
            target.identifierIndexes = indexes;
            target.kvkIndex = indexes.find(item => /kvk|handelsregister/i.test(item.value))?.index;
            target.selectedIndexes = parsed.row.map((value, column) => ({ value: normalizeText(value), column })).filter(item =>
              /concerncode[\s_]*code|kvknummer.*externalorganizationid|kvk_nummer|handelsregister|^naam[\s_]name$|naam van de organisatie.*geregistreerd|^straat[\s_]streetname$|^huisnummer[\s_]housenumber$|^postcode[\s_]postalcode$|^plaats[\s_]town$|(^|[\s_])(gemeente|vestigingsplaats|woonplaats|addresslocality)($|[\s_])|omzet|resultaat|totale?[\s_]?baten|totale?[\s_]?lasten|bedrijfsopbreng|personeelskosten|eigen[\s_]?vermogen|solvabil|liquid|schuld|verlies|winst|bezoldig|topinkomen|continuiteits|bestuurder|toezichthouder|raad[\s_]van[\s_]toezicht|commissaris/i.test(item.value)).map(item => item.column);
          }
        }
        const exactPlace = values.has('amersfoort') || values.has('gemeente amersfoort') || values.has('leusden') || values.has('gemeente leusden');
        if (exactPlace && options.localKvks && target.kvkIndex >= 0) {
          const discoveredKvk = String(parsed.row[target.kvkIndex] || '').replace(/\D/g, ''); if (discoveredKvk.length >= 7) options.localKvks.add(discoveredKvk);
        }
        if (exactPlace && options.localSourceIds) for (const item of target.identifierIndexes || []) { const value = normalizeText(parsed.row[item.index]); if (value) options.localSourceIds.add(value); }
        const hardKvk = options.localKvks && target.kvkIndex >= 0 && options.localKvks.has(String(parsed.row[target.kvkIndex] || '').replace(/\D/g, ''));
        const hardSourceIdentity = options.localSourceIds && (target.identifierIndexes || []).some(item => options.localSourceIds.has(normalizeText(parsed.row[item.index])));
        const keep = target.rows.length < 5 || exactPlace || hardKvk || hardSourceIdentity;
        if (keep && parsed.row.some(Boolean)) {
          const storedRow = target.selectedIndexes?.length ? target.selectedIndexes.map(index => parsed.row[index] || '') : parsed.row;
          for (let i = 0; i < parsed.repeatRows; i++) target.rows.push(storedRow);
        }
        pending = pending.slice(end + 18); continue;
      }
      if (!final && pending.length > 128) pending = pending.slice(-128);
      break;
    }
  }
  for await (const chunk of stream) { pending += decoder.write(chunk); consume(); }
  pending += decoder.end(); consume(true);
  const result = [...sheets.values()].filter(item => item.rows.length); result.totalRows = totalRows;
  if (!result.length) throw new Error('ODS-schemadrift: geen werkbladen');
  return result;
}

function normalizeHeader(value) {
  return normalizeText(value).toLocaleLowerCase('nl-NL').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function objectsFromSheet(sheet, requiredHeaderPatterns = []) {
  const headerIndex = sheet.rows.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    return normalized.filter(Boolean).length >= 2 && requiredHeaderPatterns.every(pattern => normalized.some(header => pattern.test(header)));
  });
  if (headerIndex < 0) return [];
  const headers = Array.from({ length: sheet.rows[headerIndex].length }, (_, index) => normalizeHeader(sheet.rows[headerIndex][index]));
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) return [];
  return sheet.rows.slice(headerIndex + 1).map(row => Object.fromEntries(headers.map((header, index) => [header || `_kolom_${index}`, normalizeText(row[index])]))).filter(row =>
    Object.entries(row).some(([key, value]) => !key.startsWith('_kolom_') && value));
}

function exactLocality(value) {
  const place = normalizePlace(value);
  return LOCAL_PLACES.has(place) || /^(gm)?0?(307|327)$/.test(place.replace(/\s/g, ''));
}

function localRowMatch(row, options = {}) {
  const localityKeys = Object.keys(row).filter(key => /(^|_)(gemeente|gemeentenaam|plaats|vestigingsplaats|woonplaats|addresslocality)($|_)/i.test(key));
  if (localityKeys.some(key => exactLocality(row[key]))) return { local: true, method: 'exact_locality', evidence: localityKeys.filter(key => exactLocality(row[key])).map(key => `${key}=${row[key]}`) };
  const codeKeys = Object.keys(row).filter(key => /gemeente.*code|gm_code/i.test(key));
  if (codeKeys.some(key => LOCAL_CODES.has(normalizeText(row[key]).toUpperCase()))) return { local: true, method: 'municipality_code', evidence: codeKeys.map(key => `${key}=${row[key]}`) };
  const kvk = normalizeText(Object.entries(row).find(([key]) => /kvk|handelsregister/i.test(key))?.[1]).replace(/\D/g, '');
  if (kvk && options.localKvks?.has(kvk)) return { local: true, method: 'hard_kvk', evidence: [`kvk=${kvk}`] };
  const sourceIdentity = normalizeText(Object.entries(row).find(([key]) => /concerncode|externalorganizationid/i.test(key))?.[1]);
  if (sourceIdentity && options.localSourceIds?.has(sourceIdentity)) return { local: true, method: 'source_identity', evidence: [`source_identity=${sourceIdentity}`] };
  return { local: false, method: null, evidence: [] };
}

async function loadLocalIdentity(db) {
  const kvks = new Set();
  const names = new Set();
  if (!db) return { kvks, names };
  const result = await db.execute(`SELECT DISTINCT ke.canonical_name,ei.identifier_type,ei.value
    FROM kg_entities ke
    LEFT JOIN entity_identifiers ei ON ei.entity_id=ke.id
    LEFT JOIN entity_locations el ON el.entity_id=ke.id
    LEFT JOIN locations l ON l.id=el.location_id
    WHERE ke.entity_type='organization' AND (l.city IN ('Amersfoort','Leusden') OR ke.source_org_id IS NOT NULL)`);
  for (const row of result.rows) {
    if (row.canonical_name) names.add(normalizeText(row.canonical_name).toLocaleLowerCase('nl-NL'));
    if (row.identifier_type === 'kvk' && row.value) kvks.add(String(row.value).replace(/\D/g, ''));
  }
  return { kvks, names };
}

function discoverLinks(html, baseUrl, predicate) {
  const $ = load(String(html));
  const links = [];
  $('a[href]').each((_, element) => {
    const href = new URL($(element).attr('href'), baseUrl).href;
    const text = normalizeText($(element).text());
    if (!predicate || predicate({ href, text })) links.push({ href, text });
  });
  return [...new Map(links.map(link => [link.href, link])).values()];
}

function parseJsonLd(html) {
  const $ = load(String(html));
  const values = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* andere JSON-LD-blokken mogen de Event-parser niet breken */ }
  });
  return values;
}

function canonicalEventRecords(html, sourceUrl) {
  const events = parseJsonLd(html).flatMap(value => value?.['@graph'] || value).filter(value => value?.['@type'] === 'Event');
  return events.flatMap(event => {
    const locality = event.location?.address?.addressLocality;
    if (!exactLocality(locality)) return [];
    const schedules = Array.isArray(event.eventSchedule) && event.eventSchedule.length ? event.eventSchedule : [{ startDate: event.startDate, endDate: event.endDate }];
    return schedules.filter(schedule => schedule.startDate).map(schedule => {
      const canonicalUrl = event.URL || event.url || sourceUrl;
      const externalId = /\/uitagenda\/(\d+)\//.exec(canonicalUrl)?.[1] || semanticHash(canonicalUrl).slice(0, 16);
      const record = {
        sourceKey: `uitagenda:${externalId}:${schedule.startDate}`,
        externalId, name: normalizeText(event.name), description: normalizeText(event.description),
        start: schedule.startDate, end: schedule.endDate || null, occurredAt: schedule.startDate,
        venue: normalizeText(event.location?.name), locality: normalizeText(locality),
        postalCode: normalizeText(event.location?.address?.postalCode), streetAddress: normalizeText(event.location?.address?.streetAddress),
        latitude: Number(event.location?.geo?.latitude) || null, longitude: Number(event.location?.geo?.longitude) || null,
        organizer: normalizeText(event.organizer?.name),
        participants: [event.performer, event.actor].flat().filter(item => item?.['@type'] === 'Person' && item.name).map(item => normalizeText(item.name)),
        sourceUrl: canonicalUrl,
      };
      record.semanticFields = { name: record.name, start: record.start, end: record.end, venue: record.venue, locality: record.locality, organizer: record.organizer, participants: record.participants };
      return record;
    });
  });
}

function tabularLocalRecords(sheets, options = {}) {
  const records = [];
  for (const sheet of sheets) {
    const occurrences = new Map();
    const objects = objectsFromSheet(sheet, options.requiredHeaderPatterns || []);
    objects.forEach((row, rowIndex) => {
      const match = localRowMatch(row, { localKvks: options.localKvks, localSourceIds: options.localSourceIds });
      if (!match.local) return;
      const identityFields = Object.keys(row).filter(key => /monument|kvk|concerncode|externalorganizationid|corporatie|instelling|zorgaanbieder|naam|gemeente|plaats|postcode/i.test(key));
      const identity = Object.fromEntries(identityFields.map(key => [key, row[key]]).filter(([, value]) => value));
      const baseKey = `${options.prefix}:${semanticHash({ sheet: sheet.name, identity }).slice(0, 24)}`;
      const occurrence = (occurrences.get(baseKey) || 0) + 1; occurrences.set(baseKey, occurrence);
      const sourceKey = occurrence === 1 ? baseKey : `${baseKey}:${occurrence}`;
      records.push({ sourceKey, sheet: sheet.name, row: rowIndex + 1, data: row, localMatch: match, sourceUrl: options.sourceUrl,
        semanticFields: row });
    });
  }
  return records;
}

function percentChange(previous, current) {
  const from = Number(previous); const to = Number(current);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return { from, to, absolute: to - from, relative: (to - from) / Math.abs(from) };
}

module.exports = {
  LOCAL_CODES, LOCAL_PLACES, canonicalEventRecords, decodeXml, discoverLinks, exactLocality, loadLocalIdentity,
  localRowMatch, normalizeHeader, objectsFromSheet, parseJsonLd, parseOds, parseOdsFiltered, parseOdsRow, parseXlsx, percentChange,
  tabularLocalRecords, zipEntries, zipEntryCompressed,
};
