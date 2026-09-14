// Adapter: ANBI-bestuurdersmonitor — openbare bestuurspagina's lokale ANBI's
// Pilot: volgt alleen een expliciete allowlist van organisatie-URL's.
// Detecteert: bestuurswisselingen via inhoudelijke diff op openbare pagina's.
// Geen productiedatabasewrites; geen dagelijkse planning.

const path = require('path');
const { load } = require('cheerio');
const {
  normalizeText, semanticHash, fetchBuffer, ensureSource,
  runVersionedDataset,
} = require('../phase3-core.cjs');

const ADAPTER_VERSION = '0.2.0-pilot';
const SOURCE_NAME = 'ANBI-bestuursmonitor';

// ─── Allowlist ────────────────────────────────────────────────────────
// Alleen deze URL's worden opgehaald. Uitbreiden vereist handmatige review.
const DEFAULT_ALLOWLIST = [
  // Placeholder: in pilot vullen fixtures deze in.
];

// ─── Rolherkenning ────────────────────────────────────────────────────
const ROLE_PATTERNS = [
  // Specifieke samenstellingen eerst (longest match first)
  { pattern: /\bvicevoorzitter\b/i, normalized: 'vicevoorzitter' },
  { pattern: /\balgemeen\s+bestuurslid\b/i, normalized: 'algemeen bestuurslid' },
  { pattern: /\blid\s+(?:raad\s+van\s+toezicht|rvt)\b/i, normalized: 'lid raad van toezicht' },
  { pattern: /\braad\s+van\s+toezicht\b/i, normalized: 'lid raad van toezicht' },
  // Daarna enkelvoudige rollen
  { pattern: /\bvoorzitter\b/i, normalized: 'voorzitter' },
  { pattern: /\bsecretaris\b/i, normalized: 'secretaris' },
  { pattern: /\bpenningmeester\b/i, normalized: 'penningmeester' },
  { pattern: /\bbestuurslid\b/i, normalized: 'bestuurslid' },
  { pattern: /\bbestuurder\b/i, normalized: 'bestuurder' },
  { pattern: /\btoezichthouder\b/i, normalized: 'toezichthouder' },
  { pattern: /\bcommissaris\b/i, normalized: 'commissaris' },
];

// Naam-patroon: minstens twee woorden, begint met hoofdletter,
// staat een of meer opeenvolgende tussenvoegsels toe (van, de, der, den, etc.)
const TUSSENVOEGSEL = '(?:\\s+(?:van|de|der|den|ten|ter|het|el|al|van\\s+de|van\\s+der|van\\s+den|van\\s+het))+';
const NAME_RE = new RegExp(
  `[A-ZÀ-ÖØ-Ý][\\p{L}.'''\\-]+(?:${TUSSENVOEGSEL})?\\s+[A-ZÀ-ÖØ-Ý][\\p{L}.'''\\-]+`,
  'u',
);

function matchRole(text) {
  for (const { pattern, normalized } of ROLE_PATTERNS) {
    if (pattern.test(text)) return normalized;
  }
  return null;
}

function matchName(text) {
  const cleaned = text
    .replace(/\b(meneer|mevrouw|dhr\.?|mw\.?|mr\.?|dr\.?|ir\.?|ing\.?|prof\.?)\s+/gi, '')
    .replace(/\s*\([^)]*\).*$/, '')
    .trim();
  const match = cleaned.match(NAME_RE);
  return match ? normalizeText(match[0]) : null;
}

// ─── Normaliseer persoonsnaam voor vergelijking ───────────────────────
// Hiermee detecteren we naamopmaakvariaties (initialen, titels)
// zonder echte persoonswijziging.
function normalizePersonName(name) {
  return normalizeText(name)
    .replace(/^(meneer|mevrouw|dhr\.?|mw\.?|mr\.?|dr\.?|ir\.?|ing\.?|prof\.?)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('nl-NL')
    .trim();
}

// ─── HTML tabel-parser ────────────────────────────────────────────────
function extractFromTable($, config) {
  const records = [];
  $('table').each((_, table) => {
    const headerCells = $(table).find('thead th, thead td, tr:first-child th, tr:first-child td');
    const headers = headerCells.toArray().map(cell => normalizeText($(cell).text()).toLowerCase());
    // Zoek kolommen voor naam en rol/functie
    const nameCol = headers.findIndex(h => /^naam$|persoon|bestuurder/i.test(h));
    const roleCol = headers.findIndex(h => /functie|rol|positie|taak/i.test(h));
    if (nameCol < 0 && roleCol < 0) return; // geen herkenbare bestuurstabel

    const rows = $(table).find('tbody tr, tr').toArray().slice(headerCells.length > 0 ? 0 : 1);
    for (const row of rows) {
      const cells = $(row).find('td').toArray().map(cell => normalizeText($(cell).text()));
      if (!cells.length) continue;
      const cellText = cells.join(' ');
      const name = nameCol >= 0 ? matchName(cells[nameCol]) : matchName(cellText);
      const role = roleCol >= 0 ? matchRole(cells[roleCol]) : matchRole(cellText);
      if (!name || !role) continue;
      const evidence = cellText.slice(0, 240);
      records.push(makeBoardRecord(config, name, role, cells[roleCol] || role, evidence));
    }
  });
  return records;
}

// ─── HTML kop+lijst-parser ────────────────────────────────────────────
function extractFromHeadingsAndLists($, config) {
  const records = [];
  $('h1, h2, h3, h4, h5, li, p, dd, span, div').each((_, element) => {
    const text = normalizeText($(element).text());
    if (!text || text.length > 300) return;
    const role = matchRole(text);
    if (!role) return;
    const name = matchName(text);
    if (!name) return;
    records.push(makeBoardRecord(config, name, role, text, text.slice(0, 240)));
  });
  return records;
}

function makeBoardRecord(config, person, role, rawRoleText, evidence) {
  const normalizedPerson = normalizePersonName(person);
  return {
    sourceKey: `anbi-board:${semanticHash({ url: config.url, normalizedPerson, role }).slice(0, 24)}`,
    person,
    normalizedPerson,
    role,
    rawRoleText: normalizeText(rawRoleText).slice(0, 240),
    organization: config.organization,
    sourceUrl: config.url,
    evidence: evidence.slice(0, 240),
    sourceClass: 'DECLARED_BY_ENTITY',
    confidence: 0.9,
    adapterVersion: ADAPTER_VERSION,
    // Semantische velden voor diff: verandering in naam of rol = inhoudelijk
    semanticFields: { normalizedPerson, role, organization: config.organization },
  };
}

// ─── Hoofdparser: combineert tabel- en koppen-extractie ───────────────
function parseBoard(html, config) {
  const $ = load(String(html));
  $('script, style, nav, footer, header, noscript').remove();

  // Probeer eerst tabel; als die levert, gebruik die (structureler)
  const tableRecords = extractFromTable($, config);
  const headingRecords = extractFromHeadingsAndLists($, config);

  // Dedupliceer op genormaliseerde persoon + rol
  const seen = new Map();
  for (const record of [...tableRecords, ...headingRecords]) {
    const key = `${record.normalizedPerson}::${record.role}`;
    if (!seen.has(key)) seen.set(key, record);
  }

  return [...seen.values()];
}

// ─── Relatie naar KG ──────────────────────────────────────────────────
async function ensureBoardRelation(db, record, sourceId, dryRun) {
  if (dryRun) return null;

  // Vind of maak de organisatie-entiteit
  let org = await db.execute({
    sql: `SELECT id FROM kg_entities WHERE entity_type='organization' AND lower(canonical_name)=lower(?) LIMIT 1`,
    args: [record.organization],
  });
  if (!org.rows.length) {
    org = await db.execute({
      sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization',?,lower(?)) RETURNING id`,
      args: [record.organization, record.organization],
    });
  }
  const orgId = Number(org.rows[0].id);

  // Persoon: brongebonden identiteit via URL+genormaliseerde naam
  // Geen automatische merge op alleen naam!
  const identifier = `${record.sourceUrl}#${encodeURIComponent(record.normalizedPerson)}`;
  let person = await db.execute({
    sql: `SELECT entity_id id FROM entity_identifiers WHERE identifier_type='website' AND value=?`,
    args: [identifier],
  });
  if (!person.rows.length) {
    person = await db.execute({
      sql: `INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('person',?,lower(?)) RETURNING id`,
      args: [record.person, record.person],
    });
    await db.execute({
      sql: `INSERT INTO entity_identifiers(entity_id,identifier_type,value,source_url,verified_at) VALUES (?,'website',?,?,datetime('now'))`,
      args: [Number(person.rows[0].id), identifier, record.sourceUrl],
    });
  }
  const personId = Number(person.rows[0].id);

  // Bepaal predicate
  const predicate = /toezicht|commissaris|rvt/i.test(record.role) ? 'TOEZICHTHOUDER' : 'BESTUURDER';

  // Maak relatie als die nog niet bestaat (match op predicate + role_title)
  const exists = await db.execute({
    sql: `SELECT id FROM kg_relations WHERE subject_id=? AND predicate=? AND object_id=? AND role_title=? AND source_url=? AND valid_until IS NULL`,
    args: [personId, predicate, orgId, record.role, record.sourceUrl],
  });
  if (!exists.rows.length) {
    await db.execute({
      sql: `INSERT INTO kg_relations(subject_id,predicate,object_id,role_title,source_url,evidence,confidence) VALUES (?,?,?,?,?,?,?)`,
      args: [personId, predicate, orgId, record.role, record.sourceUrl, record.evidence, record.confidence],
    });
  }

  // Alias
  await db.execute({
    sql: `INSERT OR IGNORE INTO kg_aliases(entity_id,alias,normalized_alias,source,score_weight) VALUES (?,?,lower(?),?,25)`,
    args: [personId, record.person, record.person, `anbi-board:${sourceId}`],
  });

  return personId;
}

// ─── Verlopen relaties ────────────────────────────────────────────────
// Bug 3 fix: sluit alleen de exacte combinatie van persoon + predicate + rol,
// niet alle relaties van die persoon op die pagina.
async function expireBoardRelations(db, sourceId, dryRun) {
  if (dryRun) return 0;
  const removed = await db.execute({
    sql: `SELECT sr.raw_object FROM source_records sr JOIN
      (SELECT source_key,MAX(id) id FROM source_records WHERE source_id=? GROUP BY source_key) latest ON latest.id=sr.id
      WHERE sr.change_type='removed'`,
    args: [sourceId],
  });
  let expired = 0;
  for (const row of removed.rows) {
    let record;
    try { record = JSON.parse(row.raw_object || '{}'); } catch { continue; }
    const identifier = `${record.sourceUrl}#${encodeURIComponent(record.normalizedPerson || '')}`;
    const person = await db.execute({
      sql: `SELECT entity_id FROM entity_identifiers WHERE identifier_type='website' AND value=?`,
      args: [identifier],
    });
    if (!person.rows.length) continue;
    // Bepaal predicate op dezelfde manier als ensureBoardRelation
    const predicate = /toezicht|commissaris|rvt/i.test(record.role || '') ? 'TOEZICHTHOUDER' : 'BESTUURDER';
    const result = await db.execute({
      sql: `UPDATE kg_relations SET valid_until=datetime('now')
            WHERE subject_id=? AND predicate=? AND role_title=? AND source_url=? AND valid_until IS NULL`,
      args: [Number(person.rows[0].entity_id), predicate, record.role || '', record.sourceUrl],
    });
    expired += Number(result.rowsAffected || 0);
  }
  return expired;
}

// ─── Bronspecifieke meta-opbouw ──────────────────────────────────────
function buildSourceMeta(config) {
  return {
    name: `${SOURCE_NAME} — ${config.organization}`,
    url: config.url,
    sourceClass: 'DECLARED_BY_ENTITY',
    version: ADAPTER_VERSION,
    frequency: 'weekly',
    category: 'registry',
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    termsCheckedAt: new Date().toISOString().slice(0, 10),
    ownerContact: null,
    manifest: {
      owner: config.organization,
      license: 'openbare organisatiepagina; alleen feiten en korte bewijsfragmenten bewaren',
      intended_frequency: 'wekelijks',
      identity: 'organisatie-URL + genormaliseerde persoonsnaam + rol',
      local_filter: 'vooraf geconfigureerde lokale ANBI met openbare bestuurspagina',
      semantic_fields: ['normalizedPerson', 'role', 'organization'],
      removal_confirmation_runs: 2,
      person_resolution: 'nooit op naam alleen mergen; brongebonden identiteit',
      pilot: true,
    },
  };
}

// ─── Event-functies ──────────────────────────────────────────────────
function buildEventForChange(changeType, record, previous, entityId) {
  if (changeType === 'removed') {
    return {
      type: 'BOARD_MEMBER_REMOVED',
      changeType,
      title: `${record.person || record.normalizedPerson}: niet langer ${record.role} bij ${record.organization}`,
      summary: 'Na twee opeenvolgende afwezigheden bevestigd verwijderd van openbare bestuurspagina.',
      evidence: [record.sourceUrl, record.evidence || ''],
      entityId,
      entityEvidence: record.sourceUrl,
      entityConfidence: record.confidence || 0.9,
      journalisticallyRelevant: false,
      uncertainty: 'Afwezigheid op openbare bestuurspagina; geen officiële bevestiging van aftreden.',
    };
  }
  return {
    type: 'BOARD_MEMBER_ADDED',
    changeType,
    title: `${record.person}: ${record.role} bij ${record.organization}`,
    summary: record.evidence,
    evidence: [record.sourceUrl, record.evidence],
    entityId,
    entityEvidence: record.sourceUrl,
    entityConfidence: record.confidence || 0.9,
    journalisticallyRelevant: false,
    uncertainty: 'Door de organisatie zelf verklaarde rol; cross-source persoonskoppeling vereist afzonderlijke corroboratie en review.',
  };
}

// ─── Adapter klasse ───────────────────────────────────────────────────
class AnbiBestuurdersAdapter {
  constructor(config = {}) {
    this.db = config.db || null; // Pilot: geen productie-db
    this.dryRun = config.dryRun ?? true; // Standaard dry-run in pilot
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    this.allowlist = config.allowlist || DEFAULT_ALLOWLIST;
    this.sourceIds = [];
    this.stats = null;
  }

  // Bug 1 fix: draai runVersionedDataset per bron, niet één keer voor alles samen.
  // Een mislukte of lege pagina beïnvloedt nooit de diff van andere bronnen.
  async run() {
    if (!this.allowlist.length) {
      return { error: 'Geen bronnen geconfigureerd in allowlist', total: 0, events: 0 };
    }

    const results = [];
    const errors = [];
    let totalFacts = 0;

    for (const config of this.allowlist) {
      try {
        const fetched = await fetchBuffer(config.url, {
          fetchImpl: this.fetchImpl,
          label: `ANBI-bestuur ${config.organization}`,
          accept: 'text/html',
          allowHtml: true,
        });
        const html = fetched.buffer.toString('utf8');
        const records = parseBoard(html, config);

        if (records.length === 0) {
          // Lege parseruitkomst: NOOIT als bestuurswijziging behandelen.
          // Skip deze bron volledig — geen diff, geen removals.
          console.warn(`[ANBI-bestuur] Geen bestuurders gevonden op ${config.url} — bron overgeslagen`);
          continue;
        }

        const meta = buildSourceMeta(config);

        const result = await runVersionedDataset({
          db: this.db,
          dryRun: this.dryRun,
          meta,
          records,
          fetched: {
            buffer: Buffer.from(JSON.stringify({ url: fetched.url, organization: config.organization })),
            url: config.url,
            contentType: 'application/json',
          },
          minimumRecords: 1,
          ensureEntity: async (record, sourceId) => {
            return ensureBoardRelation(this.db, record, sourceId, this.dryRun);
          },
          eventForChange: buildEventForChange,
        });

        // Bug 2 fix: materialiseer relaties voor ALLE records, ook bij baseline
        // en unchanged. runVersionedDataset roept ensureEntity alleen aan bij
        // niet-baseline added/changed. Wij willen altijd relaties in de KG.
        // ensureBoardRelation is idempotent (controleert bestaande relaties).
        if (!this.dryRun && this.db) {
          for (const record of records) {
            await ensureBoardRelation(this.db, record, result.sourceId, false);
          }
          // Expire verwijderde relaties (bug 3: nu per exacte combinatie)
          await expireBoardRelations(this.db, result.sourceId, false);
        }

        totalFacts += records.length;
        results.push(result);
      } catch (err) {
        // Fetchfout of runVersionedDataset-fout: log en ga door.
        // Een mislukte bron mag nooit de diff van andere bronnen beïnvloeden.
        console.error(`[ANBI-bestuur] Fout bij ${config.organization}: ${err.message}`);
        errors.push({ organization: config.organization, url: config.url, error: err.message });
      }
    }

    // Als ALLE bronnen faalden (en er zijn bronnen), gooi een fout
    if (results.length === 0 && errors.length > 0) {
      throw new Error('ANBI-bestuursmonitor: alle bronnen mislukt');
    }
    if (results.length === 0 && errors.length === 0) {
      return { error: 'Geen bruikbare records gevonden op enige bron', total: 0, events: 0 };
    }

    // Aggregeer resultaten van alle bronnen
    const aggregated = {
      sources: results.length,
      errors: errors.length,
      baseline: results.every(r => r.baseline),
      total: results.reduce((s, r) => s + r.total, 0),
      created: results.reduce((s, r) => s + r.created, 0),
      changed: results.reduce((s, r) => s + r.changed, 0),
      removed: results.reduce((s, r) => s + r.removed, 0),
      unchanged: results.reduce((s, r) => s + r.unchanged, 0),
      events: results.reduce((s, r) => s + r.events, 0),
      facts: totalFacts,
      pages: results.length,
    };

    this.sourceIds = results.map(r => r.sourceId);
    this.stats = { facts: totalFacts, pages: results.length };
    return aggregated;
  }

  async health() {
    return this.stats?.facts > 0
      ? { status: 'ok', message: `${this.stats.facts} openbare bestuursfeiten; brongebonden persoonsidentiteit` }
      : { status: 'error', message: 'ANBI-bestuursmonitor niet valide of niet uitgevoerd' };
  }
}

module.exports = {
  AnbiBestuurdersAdapter,
  // Geëxporteerd voor testen
  parseBoard,
  extractFromTable,
  extractFromHeadingsAndLists,
  matchRole,
  matchName,
  normalizePersonName,
  makeBoardRecord,
  ensureBoardRelation,
  expireBoardRelations,
  buildSourceMeta,
  buildEventForChange,
  ADAPTER_VERSION,
  SOURCE_NAME,
  ROLE_PATTERNS,
};
