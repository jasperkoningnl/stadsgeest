// Detectieregels voor Stadsgeest 2.0 — Fase 2
// R1, R2, R3, R4, R6, R7, R9
// Worden geregistreerd bij de DetectionEngine.

const { DetectionEngine } = require('./detection-engine.cjs');

/**
 * R1: Bedrijf krijgt vergunning voor extra loods of activiteit
 * Koppelt vergunningevents aan BAG-adressen en lokale entiteiten.
 */
const R1_BUSINESS_EXPANSION = {
  id: 'R1',
  name: 'Bedrijfsuitbreiding via vergunning',
  eventTypes: ['PERMIT_GRANTED', 'PERMIT_APPLIED', 'OMGEVINGSVERGUNNING'],
  async condition(event, context) {
    const text = `${event.title || ''} ${event.summary || ''}`.toLowerCase();
    const expansionTerms = [
      'uitbreiding', 'loods', 'hal', 'productie', 'opslag',
      'extra activiteit', 'capaciteit', 'oppervlakte', 'aanbouw',
      'nieuwbouw', 'verbouw', 'bedrijfsgebouw', 'bedrijfspand',
      'magazijn', 'distributie', 'fabriek',
    ];
    const hasExpansionTerm = expansionTerms.some(t => text.includes(t));
    if (!hasExpansionTerm) return false;
    if (context.entities && context.entities.length > 0) {
      const hasLocalOrg = context.entities.some(e =>
        e.entity_type === 'organization' || e.entity_type === 'location'
      );
      return hasLocalOrg;
    }
    return text.includes('amersfoort') || text.includes('leusden');
  },
  async createSignal(event, context) {
    const orgs = (context.entities || []).filter(e => e.entity_type === 'organization');
    const locs = (context.entities || []).filter(e => e.entity_type === 'location');
    return {
      title: `Mogelijke bedrijfsuitbreiding: ${orgs.length > 0 ? orgs[0].canonical_name : 'onbekend bedrijf'}`,
      summary: `Vergunningaanvraag of -verlening met uitbreidingsindicatie. ${event.summary || event.title}`,
      category: 'economie-werk',
      tier: 2,
      noveltyScore: 60,
      evidence: [event.title, event.summary].filter(Boolean),
      entityPath: orgs.length > 0
        ? `${orgs[0].canonical_name} → vergunning → ${locs.length > 0 ? locs[0].canonical_name : 'adres'}`
        : null,
      entities: [
        ...orgs.map(e => ({ entityId: e.id || e.entity_id, relevance: 'subject' })),
        ...locs.map(e => ({ entityId: e.id || e.entity_id, relevance: 'location' })),
      ],
    };
  },
};

/**
 * R2: Bestuurder of RvT-lid duikt elders op
 */
const R2_GOVERNANCE_NETWORK = {
  id: 'R2',
  name: 'Bestuurdersnetwerk-verandering',
  eventTypes: ['RELATION_DISCOVERED', 'ROLE_CHANGED', 'BOARD_APPOINTMENT'],
  async condition(event, context) {
    const persons = (context.entities || []).filter(e => e.entity_type === 'person');
    if (persons.length === 0) return false;
    for (const person of persons) {
      const relations = await context.db.execute({
        sql: `SELECT kr.*, ke.canonical_name as object_name
              FROM kg_relations kr
              JOIN kg_entities ke ON ke.id = kr.object_id
              WHERE kr.subject_id = ?
              AND kr.predicate IN ('FUNCTIE', 'BESTUURDER', 'TOEZICHTHOUDER')
              AND (kr.valid_until IS NULL OR kr.valid_until > datetime('now'))`,
        args: [person.entity_id || person.id],
      });
      if (relations.rows.length >= 2) return true;
    }
    return false;
  },
  async createSignal(event, context) {
    const persons = (context.entities || []).filter(e => e.entity_type === 'person');
    const person = persons[0];
    const relations = await context.db.execute({
      sql: `SELECT kr.role_title, ke.canonical_name as org_name
            FROM kg_relations kr
            JOIN kg_entities ke ON ke.id = kr.object_id
            WHERE kr.subject_id = ?
            AND kr.predicate IN ('FUNCTIE', 'BESTUURDER', 'TOEZICHTHOUDER')`,
      args: [person.entity_id || person.id],
    });
    const orgList = relations.rows.map(r => `${r.role_title || 'functie'} bij ${r.org_name}`).join('; ');
    return {
      title: `Bestuurdersnetwerk: ${person.canonical_name} bij meerdere organisaties`,
      summary: `${person.canonical_name} heeft functies bij: ${orgList}`,
      category: 'bestuur',
      tier: 2,
      noveltyScore: 65,
      evidence: [event.title, orgList],
      entityPath: `${person.canonical_name} → ${orgList}`,
      entities: [{ entityId: person.entity_id || person.id, relevance: 'subject' }],
    };
  },
};

/**
 * R3: Landelijke sanctie tegen lokaal bedrijf
 */
const R3_NATIONAL_SANCTION = {
  id: 'R3',
  name: 'Landelijke sanctie lokaal bedrijf',
  eventTypes: [
    'ACM_SANCTION_PUBLISHED', 'ACM_DECISION_PUBLISHED',
    'AP_SANCTION_PUBLISHED', 'AP_ORDER_PUBLISHED',
    'INSPECTION_VIOLATION', 'ASBESTOS_VIOLATION_PUBLISHED', 'ASBESTOS_WORK_STOPPED',
  ],
  async condition(event, context) {
    if (context.entities && context.entities.length > 0) {
      for (const entity of context.entities) {
        const entityId = entity.entity_id || entity.id;
        const locResult = await context.db.execute({
          sql: `SELECT l.city FROM entity_locations el
                JOIN locations l ON l.id = el.location_id
                WHERE el.entity_id = ? AND l.city IN ('Amersfoort', 'Leusden')`,
          args: [entityId],
        });
        if (locResult.rows.length > 0) return true;
        const kgResult = await context.db.execute({
          sql: `SELECT id FROM kg_entities WHERE id = ?
                AND (source_person_id IS NOT NULL OR source_org_id IS NOT NULL)`,
          args: [entityId],
        });
        if (kgResult.rows.length > 0) return true;
      }
    }
    const text = `${event.title || ''} ${event.summary || ''}`.toLowerCase();
    return text.includes('amersfoort') || text.includes('leusden');
  },
  async createSignal(event, context) {
    const orgs = (context.entities || []).filter(e => e.entity_type === 'organization');
    // Fallback: haal bedrijfsnaam uit event-titel (bijv. "Inspectie Bedrijf X")
    let orgName = orgs.length > 0 ? orgs[0].canonical_name : null;
    if (!orgName) {
      const titleMatch = (event.title || '').match(/^Inspectie\s+(.+)/i);
      orgName = titleMatch ? titleMatch[1] : (event.title || 'onbekend bedrijf');
    }
    let entityPath = orgName;
    if (orgs.length > 0) {
      const entityId = orgs[0].entity_id || orgs[0].id;
      const locResult = await context.db.execute({
        sql: `SELECT l.label, l.city FROM entity_locations el
              JOIN locations l ON l.id = el.location_id
              WHERE el.entity_id = ?`,
        args: [entityId],
      });
      if (locResult.rows.length > 0) {
        entityPath = `${event.source_name || 'sanctie'} → ${orgName} → vestiging ${locResult.rows[0].city}`;
      }
    }
    return {
      title: `Sanctie/overtreding: ${orgName}`,
      summary: event.summary || event.title,
      category: 'juridisch',
      tier: 1,
      noveltyScore: 75,
      evidence: [event.title, event.summary, event.source_url].filter(Boolean),
      entityPath,
      entities: orgs.map(e => ({ entityId: e.entity_id || e.id, relevance: 'subject' })),
    };
  },
};

/**
 * R4: Lokale publieke persoon in een onverwachte bron
 */
const R4_LOCAL_PERSON_EXTERNAL = {
  id: 'R4',
  name: 'Lokale persoon in externe bron',
  eventTypes: null,
  async condition(event, context) {
    const persons = (context.entities || []).filter(e => e.entity_type === 'person');
    if (persons.length === 0) return false;
    const sourceName = (event.source_name || '').toLowerCase();
    const isLocalSource = sourceName.includes('amersfoort') || sourceName.includes('nieuwsplein') ||
      sourceName.includes('de stad') || sourceName.includes('rtv utrecht');
    if (isLocalSource) return false;
    for (const person of persons) {
      const entityId = person.entity_id || person.id;
      const relResult = await context.db.execute({
        sql: `SELECT kr.role_title, ke.canonical_name as org_name
              FROM kg_relations kr
              JOIN kg_entities ke ON ke.id = kr.object_id
              WHERE kr.subject_id = ?
              AND (kr.valid_until IS NULL OR kr.valid_until > datetime('now'))
              LIMIT 1`,
        args: [entityId],
      });
      if (relResult.rows.length > 0) return true;
      const locResult = await context.db.execute({
        sql: `SELECT id FROM entity_locations el
              JOIN locations l ON l.id = el.location_id
              WHERE el.entity_id = ? AND l.city IN ('Amersfoort', 'Leusden')
              LIMIT 1`,
        args: [entityId],
      });
      if (locResult.rows.length > 0) return true;
    }
    return false;
  },
  async createSignal(event, context) {
    const persons = (context.entities || []).filter(e => e.entity_type === 'person');
    const person = persons[0];
    return {
      title: `${person.canonical_name} in ${event.source_name || 'externe bron'}`,
      summary: `Lokale persoon ${person.canonical_name} wordt genoemd in ${event.source_name}: ${event.title}`,
      category: 'overig',
      tier: 2,
      noveltyScore: 55,
      evidence: [event.title, event.source_url].filter(Boolean),
      entityPath: `${person.canonical_name} → genoemd in → ${event.source_name}`,
      entities: [{ entityId: person.entity_id || person.id, relevance: 'subject' }],
    };
  },
};

/**
 * R6: Kinderopvang met nieuwe tekortkomingen
 */
const R6_CHILDCARE_INSPECTION = {
  id: 'R6',
  name: 'Kinderopvang inspectie-tekortkoming',
  eventTypes: ['GGD_DEFICIENCY_FOUND', 'GGD_REPORT_PUBLISHED'],
  async condition(event, context) {
    const text = `${event.title || ''} ${event.summary || ''}`.toLowerCase();
    const severityTerms = [
      'tekortkoming', 'overtreding', 'handhaving', 'last onder',
      'bestuurlijke maatregel', 'boete', 'sluiting', 'exploitatieverbod',
      'aanwijzing', 'bevel', 'verscherpt toezicht',
    ];
    return severityTerms.some(t => text.includes(t));
  },
  async createSignal(event, context) {
    const orgs = (context.entities || []).filter(e => e.entity_type === 'organization');
    const locatie = orgs.length > 0 ? orgs[0].canonical_name : 'onbekende locatie';
    return {
      title: `GGD-tekortkoming kinderopvang: ${locatie}`,
      summary: event.summary || event.title,
      category: 'zorg-welzijn',
      tier: 2,
      noveltyScore: 65,
      evidence: [event.title, event.summary, event.source_url].filter(Boolean),
      entities: orgs.map(e => ({ entityId: e.entity_id || e.id, relevance: 'subject' })),
    };
  },
};

/**
 * R7: Grote of terugkerende Liander-storing
 */
const R7_UTILITY_OUTAGE = {
  id: 'R7',
  name: 'Grote of terugkerende netwerkstoring',
  eventTypes: ['UTILITY_OUTAGE_STARTED', 'UTILITY_OUTAGE_UPDATED', 'UTILITY_OUTAGE_RESOLVED'],
  async condition(event, context) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { /* negeer */ }
    const klanten = parseInt(provenance.getroffen_klanten || '0', 10);
    if (klanten >= 250) return true;
    if (event.occurred_at) {
      const start = new Date(event.occurred_at);
      const now = new Date();
      const duurMinuten = (now - start) / 60000;
      if (duurMinuten > 60) return true;
    }
    const postcodes = provenance.getroffen_postcodes || '';
    if (postcodes) {
      const recentStoringen = await context.db.execute({
        sql: `SELECT COUNT(*) as cnt FROM kg_events
              WHERE event_type IN ('UTILITY_OUTAGE_STARTED', 'UTILITY_OUTAGE_UPDATED')
              AND source_id = ?
              AND created_at > datetime('now', '-30 days')
              AND provenance LIKE ?`,
        args: [event.source_id, `%${postcodes.split(',')[0].trim()}%`],
      });
      if (recentStoringen.rows[0]?.cnt >= 3) return true;
    }
    return false;
  },
  async createSignal(event, context) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { /* negeer */ }
    const klanten = provenance.getroffen_klanten || 'onbekend';
    const plaatsen = provenance.getroffen_plaatsen || '';
    return {
      title: `Grote Liander-storing: ${plaatsen || 'Amersfoort'}`,
      summary: `Storing ${provenance.storing_nummer || ''}: ${klanten} klanten getroffen. ${provenance.oorzaak || ''}`,
      category: 'verkeer-infra',
      tier: 1,
      noveltyScore: 70,
      evidence: [event.title, `${klanten} klanten`, provenance.oorzaak].filter(Boolean),
      entities: [],
    };
  },
};

/**
 * R9: Organisatieverandering uit registerdiff
 */
const R9_REGISTER_CHANGE = {
  id: 'R9',
  name: 'Organisatieverandering uit registerdiff',
  eventTypes: [
    'CHILDCARE_OPENED', 'CHILDCARE_CLOSED', 'CHILDCARE_HOLDER_CHANGED',
    'CHILDCARE_CAPACITY_CHANGED', 'CHILDCARE_STATUS_CHANGED',
  ],
  async condition(event, context) {
    if (event.event_type === 'CHILDCARE_CLOSED') {
      const sourceId = event.source_identifier || '';
      if (sourceId) {
        const prev = await context.db.execute({
          sql: `SELECT id FROM kg_events
                WHERE event_type = 'CHILDCARE_CLOSED'
                AND source_identifier = ?
                AND id != ?
                AND created_at > datetime('now', '-14 days')`,
          args: [sourceId, event.id],
        });
        if (prev.rows.length > 0) return true;
        const text = `${event.title || ''} ${event.summary || ''}`.toLowerCase();
        return text.includes('uitgeschreven');
      }
    }
    return true;
  },
  async createSignal(event, context) {
    const orgs = (context.entities || []).filter(e => e.entity_type === 'organization');
    const orgName = orgs.length > 0 ? orgs[0].canonical_name : '';
    let category = 'overig';
    if (event.event_type.startsWith('CHILDCARE_')) category = 'zorg-welzijn';
    const typeLabels = {
      'CHILDCARE_OPENED': 'Nieuwe kinderopvang',
      'CHILDCARE_CLOSED': 'Kinderopvang gesloten',
      'CHILDCARE_HOLDER_CHANGED': 'Houderwissel kinderopvang',
      'CHILDCARE_CAPACITY_CHANGED': 'Capaciteitswijziging kinderopvang',
      'CHILDCARE_STATUS_CHANGED': 'Statuswijziging kinderopvang',
    };
    return {
      title: `${typeLabels[event.event_type] || 'Registerwijziging'}: ${orgName || event.title}`,
      summary: event.summary || event.title,
      category,
      tier: event.event_type === 'CHILDCARE_CLOSED' ? 2 : 3,
      noveltyScore: event.event_type === 'CHILDCARE_HOLDER_CHANGED' ? 60 : 45,
      evidence: [event.title, event.summary].filter(Boolean),
      entities: orgs.map(e => ({ entityId: e.entity_id || e.id, relevance: 'subject' })),
    };
  },
};

/**
 * Registreer alle fase-2 detectieregels bij een DetectionEngine.
 */
function registerPhase2Rules(engine) {
  engine.register(R1_BUSINESS_EXPANSION);
  engine.register(R2_GOVERNANCE_NETWORK);
  engine.register(R3_NATIONAL_SANCTION);
  engine.register(R4_LOCAL_PERSON_EXTERNAL);
  engine.register(R6_CHILDCARE_INSPECTION);
  engine.register(R7_UTILITY_OUTAGE);
  engine.register(R9_REGISTER_CHANGE);
  console.log(`[DetectionRules] ${engine.rules.size} regels geregistreerd: ${[...engine.rules.keys()].join(', ')}`);
}

// --- CLI: evalueer regels tegen recente events ---
if (require.main === module) {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const { createClient } = require('@libsql/client');

  const dryRun = process.argv.includes('--dry-run');
  const days = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '7', 10);
  const ruleIds = process.argv.find(a => a.startsWith('--rules='))?.split('=')[1]?.split(',');

  const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const engine = new DetectionEngine({ db, dryRun });
  registerPhase2Rules(engine);

  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  console.log(`[DetectionRules] Evalueer events sinds ${since}${dryRun ? ' (DRY RUN)' : ''}...`);

  engine.evaluate({ since, ruleIds })
    .then(result => {
      console.log(`[DetectionRules] Klaar: ${result.evaluated} events, ${result.signalsCreated} signalen`);
      if (result.details.length > 0) {
        console.log('[DetectionRules] Details:');
        for (const d of result.details) {
          console.log(`  ${d.action}: ${d.ruleId} — ${d.title || d.error || ''}`);
        }
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('[DetectionRules] Fatale fout:', err);
      process.exit(1);
    });
}

module.exports = {
  R1_BUSINESS_EXPANSION,
  R2_GOVERNANCE_NETWORK,
  R3_NATIONAL_SANCTION,
  R4_LOCAL_PERSON_EXTERNAL,
  R6_CHILDCARE_INSPECTION,
  R7_UTILITY_OUTAGE,
  R9_REGISTER_CHANGE,
  registerPhase2Rules,
};
