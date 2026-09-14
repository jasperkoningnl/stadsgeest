// Detectieregels voor Stadsgeest 2.0 — fase 2 t/m 4
// R1-R16; R15/R16 zijn de sectorspecifieke jaar-op-jaarregels uit fase 4.
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
    // Geen plaatsnaam-fallback: R1 vereist een gekoppelde entity
    if (!context.entities || context.entities.length === 0) return false;
    return context.entities.some(e =>
      e.entity_type === 'organization' || e.entity_type === 'location'
    );
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
    'SEVESO_INSPECTION_PUBLISHED', 'SEVESO_VIOLATION_RECORDED',
    'DISCIPLINARY_RULING_PUBLISHED', 'DISCIPLINARY_MEASURE_IMPOSED',
  ],
  async condition(event, context) {
    // Geen plaatsnaam-fallback: R3 bewijst de graph alleen als er een entity
    // via entity_locations of source_person/org_id lokaal verankerd is.
    if (!context.entities || context.entities.length === 0) return false;
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
    return false;
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

/** R5: Robuuste anomalie in geregistreerde politiedata. */
const R5_CRIME_ANOMALY = {
  id: 'R5',
  name: 'Robuuste anomalie geregistreerde misdrijven',
  eventTypes: ['CRIME_ANOMALY_DETECTED'],
  async condition(event) {
    let p = {}; try { p = JSON.parse(event.provenance || '{}'); } catch { return false; }
    return Number(p.observed) >= 5 && Number(p.expected) > 0 && Number(p.robustZ) >= 3.5 &&
      Number(p.observed) >= Math.max(2 * Number(p.expected), Number(p.expected) + 5) && p.reason === 'trigger';
  },
  async createSignal(event) {
    const p = JSON.parse(event.provenance || '{}');
    return { title: event.title, summary: `${event.summary} Het gaat om geregistreerde misdrijven; registratie-effecten blijven mogelijk.`,
      category: 'veiligheid', tier: 2, noveltyScore: Math.min(90, 60 + Math.round(Number(p.robustZ))),
      evidence: [`${p.observed} geregistreerd`, `verwachting ${Number(p.expected).toFixed(1)}`, `robuuste z-score ${Number(p.robustZ).toFixed(1)}`,
        `gebiedsversie ${p.map_year}`, event.source_url],
      entityPath: `${p.area_name || p.area_code} → ${p.crime_name || p.crime_code} → ${p.period}`,
      provenance: { absolute_count: p.observed, expected_count: p.expected, area_version: p.map_year,
        methodology_warning: p.warning, municipal_trend_ratio: p.cityRatio }, entities: [] };
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
  // UTILITY_OUTAGE_RESOLVED bewust weggelaten: een opgelost incident mag geen nieuw signaal openen
  eventTypes: ['UTILITY_OUTAGE_STARTED', 'UTILITY_OUTAGE_UPDATED'],
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

/** R8: veelgevraagde lokale spreker/maker; zachte agenda-context. */
const R8_FREQUENT_LOCAL_SPEAKER = {
  id: 'R8',
  name: 'Veelgevraagde lokale spreker of maker',
  eventTypes: ['SPEAKER_APPEARANCE'],
  async condition(event, context) {
    const person = (context.entities || []).find(entity => entity.entity_type === 'person');
    if (!person) return false;
    const entityId = Number(person.entity_id || person.id);
    const result = await context.db.execute({
      sql: `SELECT e.id,e.occurred_at,e.source_identifier,e.provenance
            FROM kg_events e JOIN event_entities ee ON ee.event_id=e.id
            WHERE ee.entity_id=? AND e.event_type='SPEAKER_APPEARANCE'
              AND e.occurred_at BETWEEN datetime(?, '-90 days') AND datetime(?)`,
      args: [entityId, event.occurred_at || event.fetched_at, event.occurred_at || event.fetched_at],
    });
    const appearances = new Map(); const organizers = new Set();
    for (const row of result.rows) {
      let provenance = {}; try { provenance = JSON.parse(row.provenance || '{}'); } catch { continue; }
      const current = provenance.current || {};
      appearances.set(row.source_identifier, row);
      const organizer = current.organizer || current.venue;
      if (organizer) organizers.add(String(organizer).toLocaleLowerCase('nl-NL'));
    }
    if (appearances.size < 4 || organizers.size < 3) return false;
    context.r8 = { appearances: [...appearances.values()], organizers: [...organizers] };
    return Number(event.id) === Math.max(...[...appearances.values()].map(row => Number(row.id)));
  },
  async createSignal(event, context) {
    const person = context.entities.find(entity => entity.entity_type === 'person');
    return {
      title: `Vaak geprogrammeerd: ${person.canonical_name}`,
      summary: `${person.canonical_name} verschijnt bij ${context.r8.appearances.length} verschillende openbare evenementen van minimaal ${context.r8.organizers.length} organisatoren of locaties binnen 90 dagen. Dit is een ontdekkingstip, geen bewijs van bijzondere maatschappelijke betekenis.`,
      category: 'cultuur', tier: 3, noveltyScore: 45,
      evidence: context.r8.appearances.map(row => row.source_identifier),
      entityPath: `lokale persoonsrelatie → ${context.r8.appearances.length} agenda-optredens → ${context.r8.organizers.length} organisatoren/locaties`,
      dedupeKey: `R8:${Number(person.entity_id || person.id)}:${new Date(event.occurred_at || event.fetched_at).toISOString().slice(0, 7)}`,
      provenance: { soft_context_only: true, review_required: true, window_days: 90 },
      entities: [{ entityId: Number(person.entity_id || person.id), relevance: 'subject' }],
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
    'SCHOOL_OPENED', 'SCHOOL_CLOSED', 'SCHOOL_RENAMED',
    'SCHOOL_ADDRESS_CHANGED', 'SCHOOL_BOARD_CHANGED',
    'SCHOOL_DENOMINATION_CHANGED', 'SCHOOL_PROGRAMME_CHANGED',
    'AFM_REGISTRATION_ADDED', 'AFM_REGISTRATION_CHANGED', 'AFM_REGISTRATION_REMOVED',
    'DNB_REGISTRATION_ADDED', 'DNB_REGISTRATION_CHANGED', 'DNB_REGISTRATION_REMOVED',
    'RVO_PROJECT_ADDED', 'RVO_PROJECT_CHANGED', 'RVO_FUNDING_CHANGED',
  ],
  async condition(event, context) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { /* geen extra poort */ }
    if (provenance.journalistically_relevant === false) return false;
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
    if (event.event_type.startsWith('SCHOOL_')) category = 'onderwijs';
    if (event.event_type.startsWith('AFM_') || event.event_type.startsWith('DNB_')) category = 'economie-werk';
    if (event.event_type.startsWith('RVO_')) category = 'economie-werk';
    const typeLabels = {
      'CHILDCARE_OPENED': 'Nieuwe kinderopvang',
      'CHILDCARE_CLOSED': 'Kinderopvang gesloten',
      'CHILDCARE_HOLDER_CHANGED': 'Houderwissel kinderopvang',
      'CHILDCARE_CAPACITY_CHANGED': 'Capaciteitswijziging kinderopvang',
      'CHILDCARE_STATUS_CHANGED': 'Statuswijziging kinderopvang',
      'SCHOOL_OPENED': 'Nieuwe schoolvestiging',
      'SCHOOL_CLOSED': 'Schoolvestiging gesloten',
      'SCHOOL_RENAMED': 'Schoolvestiging hernoemd',
      'SCHOOL_ADDRESS_CHANGED': 'Schoolvestiging verhuisd',
      'SCHOOL_BOARD_CHANGED': 'Schoolbestuur gewijzigd',
      'SCHOOL_DENOMINATION_CHANGED': 'Denominatie school gewijzigd',
      'SCHOOL_PROGRAMME_CHANGED': 'Onderwijsaanbod gewijzigd',
      'AFM_REGISTRATION_ADDED': 'Nieuwe AFM-registratie',
      'AFM_REGISTRATION_CHANGED': 'AFM-registratie gewijzigd',
      'AFM_REGISTRATION_REMOVED': 'AFM-registratie verdwenen',
      'DNB_REGISTRATION_ADDED': 'Nieuwe DNB-registratie',
      'DNB_REGISTRATION_CHANGED': 'DNB-registratie gewijzigd',
      'DNB_REGISTRATION_REMOVED': 'DNB-registratie verdwenen',
      'RVO_PROJECT_ADDED': 'Nieuw lokaal RVO-project',
      'RVO_PROJECT_CHANGED': 'Lokaal RVO-project gewijzigd',
      'RVO_FUNDING_CHANGED': 'RVO-financiering gewijzigd',
    };
    return {
      title: `${typeLabels[event.event_type] || 'Registerwijziging'}: ${orgName || event.title}`,
      summary: event.summary || event.title,
      category,
      tier: ['CHILDCARE_CLOSED', 'SCHOOL_CLOSED', 'SCHOOL_OPENED'].includes(event.event_type) ? 2 : 3,
      noveltyScore: event.event_type === 'CHILDCARE_HOLDER_CHANGED' ? 60 : 45,
      evidence: [event.title, event.summary].filter(Boolean),
      entities: orgs.map(e => ({ entityId: e.entity_id || e.id, relevance: 'subject' })),
    };
  },
};

/** R10: versterking door onafhankelijke bronnen rond dezelfde entiteit. */
const R10_MULTI_SOURCE = {
  id: 'R10', name: 'Multi-source versterking', eventTypes: null,
  async condition(event, context) {
    const ids = (context.entities || []).map(entity => Number(entity.entity_id || entity.id)).filter(Boolean);
    if (!ids.length || !event.occurred_at) return false;
    const placeholders = ids.map(() => '?').join(',');
    const result = await context.db.execute({
      sql: `SELECT DISTINCT e.id,e.source_id,e.source_identifier,e.event_type,e.title,e.occurred_at,s.name source_name
            FROM kg_events e JOIN event_entities ee ON ee.event_id=e.id LEFT JOIN sources s ON s.id=e.source_id
            WHERE ee.entity_id IN (${placeholders}) AND e.occurred_at BETWEEN datetime(?, '-90 days') AND datetime(?, '+90 days')
            ORDER BY e.occurred_at,e.id`, args: [...ids, event.occurred_at, event.occurred_at],
    });
    const independent = new Map();
    for (const row of result.rows) {
      const officialId = String(row.source_identifier || '').replace(/:(changed|added|removed).*/i, '');
      const key = `${row.source_id}:${officialId}`;
      if (!independent.has(key)) independent.set(key, row);
    }
    const sources = new Set([...independent.values()].map(row => Number(row.source_id)).filter(Boolean));
    if (sources.size < 2) return false;
    const newest = Math.max(...[...independent.values()].map(row => Number(row.id)));
    context.multiSource = { events: [...independent.values()], sources: [...sources], entityIds: ids };
    return Number(event.id) === newest;
  },
  async createSignal(event, context) {
    const evidenceEvents = context.multiSource.events; const entity = context.entities[0];
    const names = [...new Set(evidenceEvents.map(item => item.source_name).filter(Boolean))];
    const dates = evidenceEvents.map(item => new Date(item.occurred_at).getTime()).filter(Number.isFinite);
    const spanDays = dates.length ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) : 90;
    const window = spanDays <= 30 ? 30 : spanDays <= 60 ? 60 : 90;
    const entityId = Number(entity.entity_id || entity.id);
    return { title: `Meerdere onafhankelijke bronnen rond ${entity.canonical_name}`,
      summary: `${names.length} onafhankelijke bronnen raken binnen ${window} dagen dezelfde lokale entiteit: ${names.join(', ')}.`,
      category: 'overig', tier: names.length >= 3 ? 1 : 2, noveltyScore: names.length >= 3 ? 85 : 70,
      evidence: evidenceEvents.map(item => `${item.source_name}: ${item.title}`),
      entityPath: `${names.join(' + ')} → ${entity.canonical_name}`,
      dedupeKey: `R10:${entityId}:${new Date(event.occurred_at).toISOString().slice(0, 7)}:${window}`,
      provenance: { independent_sources: names, supporting_event_ids: evidenceEvents.map(item => Number(item.id)), window_days: window },
      entities: [{ entityId, relevance: 'subject' }] };
  },
};

/**
 * R11: Uitzonderlijke groei of krimp van een lokale schoolvestiging.
 * De adapter past de empirisch gekozen absolute én relatieve drempels toe;
 * deze regel controleert de provenance nogmaals voordat een signaal ontstaat.
 */
const R11_SCHOOL_ENROLLMENT = {
  id: 'R11',
  name: 'Opvallende ontwikkeling leerlingaantal',
  eventTypes: ['SCHOOL_ENROLLMENT_GROWTH', 'SCHOOL_ENROLLMENT_DECLINE'],
  async condition(event) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { return false; }
    const absolute = Math.abs(Number(provenance.absolute_change));
    const relative = Math.abs(Number(provenance.relative_change));
    const previous = Number(provenance.previous?.aantalLeerlingen);
    if (provenance.journalistically_relevant !== true) return false;
    return absolute >= 100 ||
      (absolute >= 30 && relative >= 0.10) ||
      (previous > 0 && previous < 100 && absolute >= 20 && relative >= 0.25);
  },
  async createSignal(event, context) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { /* al gevalideerd */ }
    const orgs = (context.entities || []).filter(entity => entity.entity_type === 'organization');
    const school = orgs[0]?.canonical_name || provenance.current?.naam || event.title;
    const groei = event.event_type === 'SCHOOL_ENROLLMENT_GROWTH';
    const verschil = Number(provenance.absolute_change || 0);
    const percentage = Math.round(Number(provenance.relative_change || 0) * 1_000) / 10;
    const groot = Math.abs(verschil) >= 100 || Math.abs(percentage) >= 25;
    return {
      title: `${groei ? 'Opvallende leerlinggroei' : 'Opvallende leerlingkrimp'}: ${school}`,
      summary: event.summary || event.title,
      category: 'onderwijs',
      tier: groot ? 2 : 3,
      noveltyScore: groot ? 70 : 60,
      evidence: [
        event.title,
        `${provenance.previous?.aantalLeerlingen} → ${provenance.current?.aantalLeerlingen} leerlingen (${percentage}%)`,
        event.source_url,
      ].filter(Boolean),
      entityPath: orgs.length > 0 ? `${school} → DUO-leerlingtelling → ${provenance.current?.peiljaar || 'nieuw peiljaar'}` : null,
      entities: orgs.map(entity => ({ entityId: entity.entity_id || entity.id, relevance: 'subject' })),
    };
  },
};

/**
 * R12: Materiële DUO-prognosetrend, herziening of afwijking van realisatie.
 * Dezelfde conservatieve absolute/relatieve band als bij R11 voorkomt dat
 * normale modelruis of afronding een redactiesignaal wordt.
 */
const R12_SCHOOL_FORECAST = {
  id: 'R12',
  name: 'Opvallende ontwikkeling schoolprognose',
  eventTypes: [
    'SCHOOL_FORECAST_GROWTH', 'SCHOOL_FORECAST_DECLINE',
    'SCHOOL_FORECAST_REVISED_UP', 'SCHOOL_FORECAST_REVISED_DOWN',
    'SCHOOL_FORECAST_OVERSHOOT', 'SCHOOL_FORECAST_UNDERSHOOT',
  ],
  async condition(event) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { return false; }
    if (provenance.journalistically_relevant !== true) return false;
    const absolute = Math.abs(Number(provenance.absolute_change));
    const relative = Math.abs(Number(provenance.relative_change));
    const from = Number(provenance.change_kind === 'realization'
      ? provenance.previous?.forecasts?.find(item => item.year === provenance.target_year)?.pupils
      : provenance.change_kind === 'trend'
        ? provenance.current?.forecasts?.find(item => item.year === provenance.from_year)?.pupils
        : provenance.previous?.forecasts?.find(item => item.year === provenance.target_year)?.pupils);
    return absolute >= 50 ||
      (absolute >= 30 && relative >= 0.10) ||
      (from > 0 && from < 100 && absolute >= 20 && relative >= 0.25);
  },
  async createSignal(event, context) {
    let provenance = {};
    try { provenance = JSON.parse(event.provenance || '{}'); } catch { /* al gevalideerd */ }
    const orgs = (context.entities || []).filter(entity => entity.entity_type === 'organization');
    const school = orgs[0]?.canonical_name || provenance.current?.naam || event.title;
    const labels = {
      SCHOOL_FORECAST_GROWTH: 'Opvallende verwachte leerlinggroei',
      SCHOOL_FORECAST_DECLINE: 'Opvallende verwachte leerlingkrimp',
      SCHOOL_FORECAST_REVISED_UP: 'Leerlingenprognose fors omhoog bijgesteld',
      SCHOOL_FORECAST_REVISED_DOWN: 'Leerlingenprognose fors omlaag bijgesteld',
      SCHOOL_FORECAST_OVERSHOOT: 'Leerlingaantal boven eerdere prognose',
      SCHOOL_FORECAST_UNDERSHOOT: 'Leerlingaantal onder eerdere prognose',
    };
    const absolute = Math.abs(Number(provenance.absolute_change || 0));
    const percentage = Math.abs(Math.round(Number(provenance.relative_change || 0) * 1_000) / 10);
    const groot = absolute >= 50 || percentage >= 25;
    return {
      title: `${labels[event.event_type] || 'Opvallende schoolprognose'}: ${school}`,
      summary: event.summary || event.title,
      category: 'onderwijs',
      tier: groot ? 2 : 3,
      noveltyScore: groot ? 70 : 60,
      evidence: [event.title, event.summary, event.source_url, provenance.actual?.sourceUrl].filter(Boolean),
      entityPath: orgs.length > 0
        ? `${school} → DUO-prognose → ${provenance.target_year || 'doeljaar'}`
        : null,
      entities: orgs.map(entity => ({ entityId: entity.entity_id || entity.id, relevance: 'subject' })),
    };
  },
};

const R13_SCHOOL_INSPECTION = {
  id: 'R13', name: 'Betekenisvolle wijziging Onderwijsinspectie',
  eventTypes: ['SCHOOL_INSPECTION_JUDGMENT_CHANGED', 'SCHOOL_INSPECTION_REPORT_PUBLISHED'],
  async condition(event) {
    let p = {}; try { p = JSON.parse(event.provenance || '{}'); } catch { return false; }
    const current = String(p.current?.judgment || '').toLowerCase();
    const previous = String(p.previous?.judgment || '').toLowerCase();
    if (!current) return false;
    return ['onvoldoende', 'zeer zwak'].includes(current) || (previous && current !== previous);
  },
  async createSignal(event, context) {
    const p = JSON.parse(event.provenance || '{}'); const org = context.entities?.[0];
    return { title: event.title, summary: event.summary, category: 'onderwijs', tier: /zeer zwak/i.test(event.title) ? 1 : 2, noveltyScore: 75,
      evidence: [...(p.evidence || []), event.source_url].filter(Boolean),
      entityPath: org ? `${org.canonical_name} → BRIN ${p.current?.brinBranch} → Onderwijsinspectie` : null,
      entities: org ? [{ entityId: Number(org.entity_id || org.id), relevance: 'subject' }] : [] };
  },
};

const R14_NDW_IMPACT = {
  id: 'R14', name: 'Grote lokale verkeersmaatregel',
  eventTypes: ['ROADWORK_PLANNED', 'ROAD_CLOSURE_CHANGED', 'EVENT_TRAFFIC_MEASURE'],
  async condition(event) { let p = {}; try { p = JSON.parse(event.provenance || '{}'); } catch { return false; }
    return p.journalistically_relevant === true; },
  async createSignal(event) { const p = JSON.parse(event.provenance || '{}');
    return { title: event.title, summary: event.summary, category: 'verkeer-infra', tier: p.current?.closure ? 2 : 3, noveltyScore: 65,
      evidence: [...(p.evidence || []), event.source_url].filter(Boolean),
      entityPath: `NDW-geometrie → ${p.current?.municipality || 'doelgebied'}`, entities: [] }; },
};

/** R15: materiële jaar-op-jaarverandering in openbare zorgverantwoording. */
const R15_CARE_YEAR_OVER_YEAR = {
  id: 'R15', name: 'Materiële jaar-op-jaarverandering zorg', eventTypes: ['CARE_FINANCIAL_ANOMALY'],
  async condition(event) { let p = {}; try { p = JSON.parse(event.provenance || '{}'); } catch { return false; }
    return p.journalistically_relevant === true && Math.abs(Number(p.absolute_change)) >= 250000 && Math.abs(Number(p.relative_change)) >= 0.15; },
  async createSignal(event, context) { const p = JSON.parse(event.provenance || '{}'); const org = context.entities?.[0];
    return { title: event.title, summary: `${event.summary} De cijfers zijn door de aanbieder aangeleverd en niet inhoudelijk door CIBG gecontroleerd.`,
      category: 'zorg-welzijn', tier: Math.abs(Number(p.absolute_change)) >= 1000000 ? 2 : 3, noveltyScore: 65,
      evidence: [...(p.evidence || []), event.source_url].filter(Boolean), entityPath: org ? `${org.canonical_name} → openbare jaarverantwoording → jaar-op-jaarvergelijking` : null,
      provenance: { uncertainty: p.uncertainty, review_required: true }, entities: org ? [{ entityId: Number(org.entity_id || org.id), relevance: 'subject' }] : [] }; },
};

/** R16: materiële jaar-op-jaarverschuiving in lokale dPi-plannen. */
const R16_HOUSING_YEAR_OVER_YEAR = {
  id: 'R16', name: 'Materiële jaar-op-jaarverandering woningcorporatieplan', eventTypes: ['HOUSING_INVESTMENT_ANOMALY'],
  async condition(event) { let p = {}; try { p = JSON.parse(event.provenance || '{}'); } catch { return false; }
    const absolute = Math.abs(Number(p.absolute_change)); const relative = Math.abs(Number(p.relative_change));
    return p.journalistically_relevant === true && (absolute >= 25 || (absolute >= 10 && relative >= 0.20)); },
  async createSignal(event, context) { const p = JSON.parse(event.provenance || '{}'); const org = context.entities?.[0];
    return { title: event.title, summary: `${event.summary} dPi beschrijft prognoses, geen gerealiseerde woningen of investeringen.`, category: 'wonen', tier: 2, noveltyScore: 70,
      evidence: [...(p.evidence || []), event.source_url].filter(Boolean), entityPath: org ? `${org.canonical_name} → dPi → gemeente Amersfoort/Leusden` : null,
      provenance: { uncertainty: p.uncertainty, review_required: true }, entities: org ? [{ entityId: Number(org.entity_id || org.id), relevance: 'subject' }] : [] }; },
};

/**
 * Registreer de productie-detectieregels bij een DetectionEngine.
 */
function registerPhase2Rules(engine) {
  engine.register(R1_BUSINESS_EXPANSION);
  engine.register(R2_GOVERNANCE_NETWORK);
  engine.register(R3_NATIONAL_SANCTION);
  engine.register(R4_LOCAL_PERSON_EXTERNAL);
  engine.register(R5_CRIME_ANOMALY);
  engine.register(R6_CHILDCARE_INSPECTION);
  engine.register(R7_UTILITY_OUTAGE);
  engine.register(R8_FREQUENT_LOCAL_SPEAKER);
  engine.register(R9_REGISTER_CHANGE);
  engine.register(R10_MULTI_SOURCE);
  engine.register(R11_SCHOOL_ENROLLMENT);
  engine.register(R12_SCHOOL_FORECAST);
  engine.register(R13_SCHOOL_INSPECTION);
  engine.register(R14_NDW_IMPACT);
  engine.register(R15_CARE_YEAR_OVER_YEAR);
  engine.register(R16_HOUSING_YEAR_OVER_YEAR);
  console.log(`[DetectionRules] ${engine.rules.size} regels geregistreerd: ${[...engine.rules.keys()].join(', ')}`);
}

// Publiek regressiecontract voor evaluaties en audits. De ids blijven stabiel:
// redactionele uitkomsten per regel zijn anders niet over de tijd vergelijkbaar.
const RULE_IDENTITIES = Object.freeze(Object.fromEntries([
  R1_BUSINESS_EXPANSION, R2_GOVERNANCE_NETWORK, R3_NATIONAL_SANCTION,
  R4_LOCAL_PERSON_EXTERNAL, R5_CRIME_ANOMALY, R6_CHILDCARE_INSPECTION,
  R7_UTILITY_OUTAGE, R8_FREQUENT_LOCAL_SPEAKER, R9_REGISTER_CHANGE,
  R10_MULTI_SOURCE, R11_SCHOOL_ENROLLMENT, R12_SCHOOL_FORECAST,
  R13_SCHOOL_INSPECTION, R14_NDW_IMPACT, R15_CARE_YEAR_OVER_YEAR,
  R16_HOUSING_YEAR_OVER_YEAR,
].map(rule => [rule.id, rule.name])));

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
  R5_CRIME_ANOMALY,
  R6_CHILDCARE_INSPECTION,
  R7_UTILITY_OUTAGE,
  R8_FREQUENT_LOCAL_SPEAKER,
  R9_REGISTER_CHANGE,
  R10_MULTI_SOURCE,
  R11_SCHOOL_ENROLLMENT,
  R12_SCHOOL_FORECAST,
  R13_SCHOOL_INSPECTION,
  R14_NDW_IMPACT,
  R15_CARE_YEAR_OVER_YEAR,
  R16_HOUSING_YEAR_OVER_YEAR,
  RULE_IDENTITIES,
  registerPhase2Rules,
};
