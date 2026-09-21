const PARSER_VERSION = 'permit-bag-bridge/1.0.0';

function normalizePostcode(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '');
}

function normalizeHouseNumber(value) {
  return String(value || '').toLowerCase().replace(/[\s-]+/g, '');
}

function extractAddress(title) {
  const text = String(title || '');
  const postcode = /\b(\d{4})\s*([A-Z]{2})\b/i.exec(text);
  if (!postcode) return null;
  const before = text.slice(0, postcode.index).replace(/[,\s]+$/, '');
  const house = /(\d+[A-Za-z]?(?:[-/][A-Za-z0-9]+)?)$/.exec(before);
  if (!house) return null;
  return {
    postalCode: normalizePostcode(`${postcode[1]}${postcode[2]}`),
    houseNumber: normalizeHouseNumber(house[1]),
  };
}

function classifyPermit(title) {
  const text = String(title || '').toLowerCase();
  if (/weigering|geweigerd|buiten behandeling/.test(text)) return 'PERMIT_REFUSED';
  if (/verleend|verleende/.test(text)) return 'PERMIT_GRANTED';
  if (/aanvraag|ontvangen/.test(text)) return 'PERMIT_APPLIED';
  return 'OMGEVINGSVERGUNNING';
}

async function backfillPermitEvents(db, options = {}) {
  const apply = options.apply === true;
  const limit = Number.isInteger(options.limit) ? options.limit : 5000;
  const locationRows = (await db.execute(`SELECT id,label,postal_code,house_number,bag_id
    FROM locations WHERE bag_id IS NOT NULL AND bag_id<>'' AND postal_code IS NOT NULL AND house_number IS NOT NULL`)).rows;
  const locations = new Map();
  for (const row of locationRows) {
    const key = `${normalizePostcode(row.postal_code)}:${normalizeHouseNumber(row.house_number)}`;
    if (!locations.has(key)) locations.set(key, []);
    locations.get(key).push(row);
  }
  const rows = (await db.execute({
    sql: `SELECT r.id,r.source_id,r.external_url,r.title,r.summary,r.published_at,r.raw_hash,s.name source_name
      FROM raw_items r JOIN sources s ON s.id=r.source_id
      WHERE (lower(s.name) LIKE '%vergunning%' OR s.name='Officiële Bekendmakingen — Leusden')
      AND lower(r.title) LIKE '%vergunning%' ORDER BY r.id LIMIT ?`,
    args: [limit],
  })).rows;
  const result = { mode: apply ? 'apply' : 'dry-run', permits: rows.length, parsed: 0, exactBagMatch: 0,
    ambiguousLocation: 0, linkedToEntity: 0, eventsCreated: 0, existingEvents: 0, examples: [] };
  for (const row of rows) {
    const address = extractAddress(row.title);
    if (!address) continue;
    result.parsed++;
    const matched = locations.get(`${address.postalCode}:${address.houseNumber}`) || [];
    if (matched.length !== 1) {
      if (matched.length > 1) result.ambiguousLocation++;
      continue;
    }
    const location = matched[0];
    result.exactBagMatch++;
    const entities = (await db.execute({
      sql: `SELECT DISTINCT ke.id FROM entity_locations el JOIN kg_entities ke ON ke.id=el.entity_id
        WHERE el.location_id=? AND ke.entity_type='organization' AND ke.merged_into_id IS NULL ORDER BY ke.id`,
      args: [location.id],
    })).rows;
    if (!entities.length) continue;
    result.linkedToEntity++;
    const sourceIdentifier = `raw-item:${row.id}`;
    const existing = (await db.execute({
      sql: 'SELECT id FROM kg_events WHERE source_id=? AND source_identifier=? LIMIT 1',
      args: [row.source_id, sourceIdentifier],
    })).rows[0];
    if (existing) { result.existingEvents++; continue; }
    if (result.examples.length < 5) result.examples.push({ rawItemId: Number(row.id), locationId: Number(location.id), bagId: location.bag_id, entities: entities.length });
    if (!apply) continue;
    const provenance = JSON.stringify({
      source_name: row.source_name, source_url: row.external_url, source_identifier: sourceIdentifier,
      raw_item_id: Number(row.id), location_id: Number(location.id), bag_id: String(location.bag_id),
      address_match: 'exact_postcode_house_number', parser_version: PARSER_VERSION,
    });
    const inserted = await db.execute({
      sql: `INSERT INTO kg_events(event_type,title,summary,published_at,fetched_at,source_id,source_url,
        source_identifier,raw_object_hash,parser_version,provenance)
        VALUES (?,?,?,?,datetime('now'),?,?,?,?,?,?)`,
      args: [classifyPermit(row.title), row.title, row.summary || row.title, row.published_at || null,
        row.source_id, row.external_url, sourceIdentifier, row.raw_hash || null, PARSER_VERSION, provenance],
    });
    const eventId = Number(inserted.lastInsertRowid);
    for (const entity of entities) await db.execute({
      sql: `INSERT OR IGNORE INTO event_entities(event_id,entity_id,role,evidence,confidence)
        VALUES (?,?,'subject',?,1.0)`,
      args: [eventId, entity.id, `Exact BAG-adres ${location.bag_id}`],
    });
    result.eventsCreated++;
  }
  return result;
}

module.exports = { PARSER_VERSION, normalizePostcode, normalizeHouseNumber, extractAddress, classifyPermit, backfillPermitEvents };
