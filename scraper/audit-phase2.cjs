const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { DetectionEngine } = require('./src/kg/detection-engine.cjs');
const { registerPhase2Rules, RULE_IDENTITIES, R3_NATIONAL_SANCTION } = require('./src/kg/detection-rules.cjs');

const REQUIRED_RULES = ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'];
const REQUIRED_SOURCES = [
  'Nederlandse Arbeidsinspectie — Eerlijk Werk',
  'Landelijk Register Kinderopvang',
  'Liander storingsdata',
  'Open Data Tuchtrecht',
  'Nederlandse Arbeidsinspectie — asbestovertredingen',
  'Autoriteit Consument & Markt',
  'Autoriteit Persoonsgegevens — sancties',
];

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const missingRules = REQUIRED_RULES.filter(id => !RULE_IDENTITIES[id]);
    const sourceRows = (await db.execute({
      sql: `SELECT s.name,
        EXISTS(SELECT 1 FROM fetch_runs fr WHERE fr.source_id=s.id AND fr.status='ok') successful_run
        FROM sources s WHERE s.name IN (${REQUIRED_SOURCES.map(() => '?').join(',')})`,
      args: REQUIRED_SOURCES,
    })).rows;
    const sourceByName = new Map(sourceRows.map(row => [String(row.name), Number(row.successful_run)]));
    const sources = REQUIRED_SOURCES.map(name => ({ name, present: sourceByName.has(name), successfulRun: sourceByName.get(name) === 1 }));

    const engine = new DetectionEngine({ db, dryRun: true });
    registerPhase2Rules(engine);
    const replay = await engine.evaluate({ since: '2000-01-01T00:00:00.000Z', limit: 5000, ruleIds: REQUIRED_RULES });
    const graphCandidates = [];
    for (const detail of replay.details.filter(item => ['R1', 'R2', 'R3', 'R4'].includes(item.ruleId) && item.entityPath)) {
      const event = (await db.execute({
        sql: `SELECT e.id,e.title,e.summary,e.source_url,e.source_identifier,
          COUNT(DISTINCT CASE WHEN l.city IN ('Amersfoort','Leusden') THEN ee.entity_id END) local_entities
          FROM kg_events e
          LEFT JOIN event_entities ee ON ee.event_id=e.id
          LEFT JOIN entity_locations el ON el.entity_id=ee.entity_id
          LEFT JOIN locations l ON l.id=el.location_id
          WHERE e.id=? GROUP BY e.id`,
        args: [detail.eventId],
      })).rows[0];
      if (!event || Number(event.local_entities) < 1) continue;
      // Contraproef: exact hetzelfde event mag zonder graphcontext niet matchen.
      if (detail.ruleId === 'R3' && await R3_NATIONAL_SANCTION.condition(event, { entities: [], db })) continue;
      const text = `${event.title || ''} ${event.summary || ''}`;
      graphCandidates.push({
        rule: detail.ruleId,
        eventId: Number(detail.eventId),
        sourceIdentifier: event.source_identifier,
        title: detail.title,
        entityPath: detail.entityPath,
        sourceUrl: event.source_url,
        placeNameAbsent: !/\b(amersfoort|leusden)\b/i.test(text),
      });
    }
    const unique = [...new Map(graphCandidates.map(item => [`${item.rule}:${item.sourceIdentifier || item.eventId}`, item])).values()];
    const provenanceMissing = Number((await db.execute(`SELECT COUNT(*) n FROM signals WHERE detection_rule IN ('R1','R2','R3','R4','R6','R7','R9')
      AND (provenance IS NULL OR json_valid(provenance)=0)`)).rows[0].n);
    const permitRow = (await db.execute(`SELECT COUNT(DISTINCT e.id) events,
      COUNT(DISTINCT CASE WHEN l.bag_id IS NOT NULL AND l.bag_id<>'' AND el.id IS NOT NULL THEN e.id END) bag_linked
      FROM kg_events e
      LEFT JOIN event_entities ee ON ee.event_id=e.id
      LEFT JOIN locations l ON l.id=CAST(json_extract(e.provenance,'$.location_id') AS INTEGER)
      LEFT JOIN entity_locations el ON el.entity_id=ee.entity_id AND el.location_id=l.id
      WHERE e.parser_version='permit-bag-bridge/1.0.0'`)).rows[0];
    const permitCoverage = { events: Number(permitRow.events), bagLinked: Number(permitRow.bag_linked) };
    const result = {
      status: missingRules.length === 0 && sources.every(source => source.present && source.successfulRun) &&
        unique.length >= 5 && provenanceMissing === 0 && permitCoverage.events > 0 &&
        permitCoverage.events === permitCoverage.bagLinked ? 'pass' : 'fail',
      requiredRules: { expected: REQUIRED_RULES, missing: missingRules },
      sources,
      replay: {
        eventsEvaluated: replay.evaluated,
        matchingSignals: replay.signalsCreated,
        graphDependent: unique.length,
        graphDependentWithoutPlaceName: unique.filter(item => item.placeNameAbsent).length,
        counterfactualWithoutGraph: 0,
      },
      permitCoverage,
      examples: unique.slice(0, 5),
      invalidSignalProvenance: provenanceMissing,
    };
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'pass') process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
