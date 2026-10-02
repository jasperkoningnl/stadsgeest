// Eenmalige inhaalslag (2 oktober 2026): detectiesignalen zonder document
// krijgen alsnog hun bewijsitem.
//
// Door een gedeelde hash werd per run alleen het eerste bewijsitem opgeslagen
// (zie docs/HANDOFFS/2026-10.md). Dit script loopt de open signalen (new en
// watching) zonder document na en legt het bewijsitem vast via dezelfde functie
// als de detectierun. Er komen geen nieuwe signalen bij: bewijsitems staan
// meteen op verwerkt.
//
// Gebruik: node backfill-bewijsitems-20261002.cjs            (droog, wijzigt niets)
//          node backfill-bewijsitems-20261002.cjs --apply
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { DetectionEngine, createDb } = require('./src/kg/detection-engine.cjs');

const APPLY = process.argv.includes('--apply');

(async () => {
  const db = createDb();
  const res = await db.execute(`
    SELECT s.id AS signal_id, s.detection_rule, s.status, e.*
    FROM signals s
    JOIN kg_events e ON e.id = json_extract(s.provenance, '$.event_id')
    WHERE s.detection_rule IS NOT NULL
      AND s.status IN ('new', 'watching')
      AND NOT EXISTS (SELECT 1 FROM signal_items si WHERE si.signal_id = s.id)
    ORDER BY s.id`);
  const perRegel = {};
  for (const r of res.rows) perRegel[r.detection_rule] = (perRegel[r.detection_rule] || 0) + 1;
  console.log(`${res.rows.length} open detectiesignalen zonder document:`, JSON.stringify(perRegel));
  if (!APPLY) { console.log('Droge run: niets gewijzigd. Gebruik --apply om te schrijven.'); return; }

  const engine = new DetectionEngine({ db, dryRun: false });
  let gekoppeld = 0, overgeslagen = 0;
  for (const r of res.rows) {
    try {
      const itemId = await engine.linkEvidenceForSignal(Number(r.signal_id), { ...r });
      if (itemId) gekoppeld++; else { overgeslagen++; console.log(`  signaal ${r.signal_id}: geen bron-URL of bron-id, overgeslagen`); }
    } catch (error) {
      overgeslagen++;
      console.log(`  signaal ${r.signal_id}: mislukt (${error.message})`);
    }
  }
  console.log(`Geschreven: ${gekoppeld} signalen hebben nu een document, ${overgeslagen} overgeslagen.`);
})().catch((error) => { console.error('Inhaalslag mislukt:', error.message); process.exit(1); });
