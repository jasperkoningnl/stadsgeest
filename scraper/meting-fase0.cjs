const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  // Kolommen raw_items
  const riCols = (await db.execute("PRAGMA table_info(raw_items)")).rows;
  console.log('=== RAW_ITEMS KOLOMMEN ===');
  console.log(riCols.map(r => r.name).join(', '));

  // Kolommen signals
  const sigCols = (await db.execute("PRAGMA table_info(signals)")).rows;
  console.log('\n=== SIGNALS KOLOMMEN ===');
  console.log(sigCols.map(r => r.name).join(', '));

  // Kolommen sources
  const srcCols = (await db.execute("PRAGMA table_info(sources)")).rows;
  console.log('\n=== SOURCES KOLOMMEN ===');
  console.log(srcCols.map(r => r.name).join(', '));

  // Kolommen entities
  const entCols = (await db.execute("PRAGMA table_info(entities)")).rows;
  console.log('\n=== ENTITIES KOLOMMEN ===');
  console.log(entCols.map(r => r.name).join(', '));

  console.log('\n=== RAW_ITEMS ===');
  const ri = await db.execute('SELECT COUNT(*) total, COUNT(full_text) ft, COUNT(entities_scanned_at) es FROM raw_items');
  console.log('Totaal:', ri.rows[0].total, '| Met fulltext:', ri.rows[0].ft, '| Entity-gescand:', ri.rows[0].es);
  const riDate = await db.execute('SELECT MIN(scraped_at) mn, MAX(scraped_at) mx FROM raw_items');
  console.log('Bereik:', riDate.rows[0].mn, 'tot', riDate.rows[0].mx);

  console.log('\n=== SOURCES ===');
  const src = await db.execute('SELECT COUNT(*) c FROM sources');
  console.log('Bronnen:', src.rows[0].c);
  const srcHealth = await db.execute("SELECT health, COUNT(*) c FROM sources GROUP BY health ORDER BY c DESC");
  for (const r of srcHealth.rows) console.log('  ' + (r.health||'NULL') + ': ' + r.c);

  console.log('\n=== SIGNALS ===');
  const sig = await db.execute('SELECT COUNT(*) c FROM signals');
  console.log('Signalen:', sig.rows[0].c);
  const sigDate = await db.execute('SELECT MIN(created_at) mn, MAX(created_at) mx FROM signals');
  console.log('Bereik:', sigDate.rows[0].mn, 'tot', sigDate.rows[0].mx);

  console.log('\n=== ENTITIES ===');
  const ent = await db.execute('SELECT COUNT(*) c FROM entities');
  console.log('Entities:', ent.rows[0].c);
  const entType = await db.execute('SELECT entity_type, COUNT(*) c FROM entities GROUP BY entity_type ORDER BY c DESC');
  for (const r of entType.rows) console.log('  ' + r.entity_type + ': ' + r.c);

  console.log('\n=== PERSONS / ORGANIZATIONS ===');
  const per = await db.execute('SELECT COUNT(*) c FROM persons');
  const org = await db.execute('SELECT COUNT(*) c FROM organizations');
  const pa = await db.execute('SELECT COUNT(*) c FROM person_aliases');
  const oa = await db.execute('SELECT COUNT(*) c FROM org_aliases');
  const roles = await db.execute('SELECT COUNT(*) c FROM roles');
  console.log('Personen:', per.rows[0].c, '| Aliassen:', pa.rows[0].c);
  console.log('Organisaties:', org.rows[0].c, '| Aliassen:', oa.rows[0].c);
  console.log('Rollen:', roles.rows[0].c);

  console.log('\n=== TIPS ===');
  const tips = await db.execute('SELECT COUNT(*) c FROM tips');
  console.log('Tips:', tips.rows[0].c);

  console.log('\n=== INTAKE ===');
  const id2 = await db.execute('SELECT COUNT(*) c FROM intake_decisions');
  console.log('Intake decisions:', id2.rows[0].c);
  const idAct = await db.execute("SELECT decision, COUNT(*) c FROM intake_decisions GROUP BY decision ORDER BY c DESC LIMIT 10");
  for (const r of idAct.rows) console.log('  ' + r.decision + ': ' + r.c);

  // Duplicaten
  // Definitie: een "duplicate URL-groep" is een external_url die bij meer dan één raw_item voorkomt.
  // De noemer is het aantal unieke external_urls (niet het totaal raw_items).
  console.log('\n=== DUPLICATEN ===');
  const riWithUrl = await db.execute("SELECT COUNT(*) c FROM raw_items WHERE external_url IS NOT NULL");
  const uniqueUrls = await db.execute("SELECT COUNT(DISTINCT external_url) c FROM raw_items WHERE external_url IS NOT NULL");
  const dupes = await db.execute("SELECT COUNT(*) c FROM (SELECT external_url, COUNT(*) n FROM raw_items WHERE external_url IS NOT NULL GROUP BY external_url HAVING n > 1)");
  const dupePct = uniqueUrls.rows[0].c > 0
    ? (100.0 * dupes.rows[0].c / uniqueUrls.rows[0].c).toFixed(2)
    : '0.00';
  console.log('Raw items met URL:', riWithUrl.rows[0].c, '| Unieke URLs:', uniqueUrls.rows[0].c);
  console.log('Duplicate URL-groepen:', dupes.rows[0].c, '/', uniqueUrls.rows[0].c, 'unieke URLs (' + dupePct + '%)');

  // Signaalvolume laatste 30 dagen
  console.log('\n=== SIGNAALVOLUME (laatste 30 dagen) ===');
  const vol = await db.execute("SELECT date(created_at) d, COUNT(*) c FROM signals WHERE created_at >= datetime('now','-30 days') GROUP BY d ORDER BY d");
  for (const r of vol.rows) console.log('  ' + r.d + ': ' + r.c);

  // Entity mentions & signals
  console.log('\n=== ENTITY_MENTIONS ===');
  const em = await db.execute('SELECT COUNT(*) c FROM entity_mentions');
  console.log('Entity mentions:', em.rows[0].c);
  const es = await db.execute('SELECT COUNT(*) c FROM entity_signals');
  console.log('Entity signals:', es.rows[0].c);

  // Fulltext coverage per source
  console.log('\n=== FULLTEXT DEKKING (top 15 bronnen) ===');
  const ftCov = await db.execute("SELECT s.name, COUNT(*) total, COUNT(r.full_text) ft, ROUND(100.0*COUNT(r.full_text)/COUNT(*),1) pct FROM raw_items r JOIN sources s ON s.id=r.source_id GROUP BY s.name ORDER BY total DESC LIMIT 15");
  for (const r of ftCov.rows) console.log('  ' + r.name + ': ' + r.total + ' items, ' + r.pct + '% fulltext');

  // === BAG-MATCHRATE ===
  console.log('\n=== BAG-MATCHRATE ===');
  const locTotal = await db.execute('SELECT COUNT(*) c FROM locations');
  const locBag = await db.execute("SELECT COUNT(*) c FROM locations WHERE bag_id IS NOT NULL AND bag_id != ''");
  const bagPct = locTotal.rows[0].c > 0
    ? (100.0 * locBag.rows[0].c / locTotal.rows[0].c).toFixed(1)
    : '0.0';
  console.log('Locaties totaal:', locTotal.rows[0].c, '| Met bag_id:', locBag.rows[0].c, '| BAG-matchrate:', bagPct + '%');

  // BAG-dekking specifiek voor vergunningrecords.
  // Betrouwbaar relatiepad: kg_events met source_id van een vergunningbron →
  // event_entities → kg_entities → entity_locations → locations.
  // Als dat pad geen resultaten oplevert is de koppeling nog niet gebouwd.
  console.log('\nBAG-dekking vergunningrecords:');
  const vergSr = await db.execute(`
    SELECT COUNT(DISTINCT l.id) total,
      COUNT(DISTINCT CASE WHEN l.bag_id IS NOT NULL AND l.bag_id != '' THEN l.id END) met_bag
    FROM kg_events ev
    JOIN sources s ON s.id = ev.source_id
    JOIN event_entities ee ON ee.event_id = ev.id
    JOIN entity_locations el ON el.entity_id = ee.entity_id
    JOIN locations l ON l.id = el.location_id
    WHERE LOWER(s.name) LIKE '%vergunning%'
  `);
  if (vergSr.rows[0].total > 0) {
    const vergBagPct = (100.0 * vergSr.rows[0].met_bag / vergSr.rows[0].total).toFixed(1);
    console.log('  Vergunning-locaties:', vergSr.rows[0].total, '| Met bag_id:', vergSr.rows[0].met_bag, '| BAG-matchrate:', vergBagPct + '%');
  } else {
    console.log('  Niet meetbaar: vergunningbronnen zijn nog niet via kg_events → entity_locations aan locaties gekoppeld.');
    console.log('  (Geen fallback op ongerelateerde KG-locaties — dat is geen geldige vergunningmeting.)');
  }

  const eiTypes = await db.execute("SELECT identifier_type, COUNT(*) c FROM entity_identifiers GROUP BY identifier_type ORDER BY c DESC");
  console.log('\nEntity-identifiers per type:');
  for (const r of eiTypes.rows) console.log('  ' + r.identifier_type + ': ' + r.c);

  // === PARSER-FAILURE-RATE ===
  console.log('\n=== PARSER-FAILURE-RATE ===');
  const frTotal = await db.execute('SELECT COUNT(*) c FROM fetch_runs');
  const frStatus = await db.execute("SELECT status, COUNT(*) c FROM fetch_runs GROUP BY status ORDER BY c DESC");
  console.log('Fetch-runs totaal:', frTotal.rows[0].c);
  for (const r of frStatus.rows) console.log('  ' + r.status + ': ' + r.c);

  const frFail = await db.execute("SELECT COUNT(*) c FROM fetch_runs WHERE status IN ('error','timeout','suspect')");
  const failPct = frTotal.rows[0].c > 0
    ? (100.0 * frFail.rows[0].c / frTotal.rows[0].c).toFixed(1)
    : '0.0';
  console.log('Parser-failure-rate:', failPct + '%');

  const frPerSource = await db.execute(`
    SELECT s.name, COUNT(*) total,
      SUM(CASE WHEN fr.status IN ('error','timeout','suspect') THEN 1 ELSE 0 END) fails,
      ROUND(100.0 * SUM(CASE WHEN fr.status IN ('error','timeout','suspect') THEN 1 ELSE 0 END) / COUNT(*), 1) fail_pct
    FROM fetch_runs fr JOIN sources s ON s.id = fr.source_id
    GROUP BY s.name ORDER BY total DESC LIMIT 15
  `);
  console.log('Failure-rate per bron (top 15):');
  for (const r of frPerSource.rows) console.log('  ' + r.name + ': ' + r.total + ' runs, ' + r.fail_pct + '% fout');

  // === KG-TABELLEN ===
  console.log('\n=== KG-TABELLEN ===');
  const kgTables = ['kg_entities','entity_identifiers','kg_aliases','locations','entity_locations',
    'kg_relations','kg_events','event_entities','source_records','fetch_runs','entity_merge_candidates'];
  for (const t of kgTables) {
    try {
      const cnt = (await db.execute('SELECT COUNT(*) c FROM "' + t + '"')).rows[0].c;
      console.log('  ' + t + ': ' + cnt + ' rijen');
    } catch { console.log('  ' + t + ': NIET GEVONDEN'); }
  }

  // === SOURCE_RECORDS PER ADAPTER ===
  console.log('\n=== SOURCE_RECORDS PER ADAPTER ===');
  const srPerSource = await db.execute(`
    SELECT s.name, COUNT(*) total,
      SUM(CASE WHEN sr.change_type = 'added' THEN 1 ELSE 0 END) added,
      SUM(CASE WHEN sr.change_type = 'changed' THEN 1 ELSE 0 END) changed,
      SUM(CASE WHEN sr.change_type = 'removed' THEN 1 ELSE 0 END) removed
    FROM source_records sr JOIN sources s ON s.id = sr.source_id
    GROUP BY s.name ORDER BY total DESC
  `);
  for (const r of srPerSource.rows) {
    console.log('  ' + r.name + ': ' + r.total + ' records (added=' + r.added + ', changed=' + r.changed + ', removed=' + r.removed + ')');
  }

  // === BASELINE TIMESTAMP ===
  console.log('\n=== BASELINE ===');
  console.log('Baseline-meting uitgevoerd op:', new Date().toISOString());
  console.log('Script: meting-fase0.cjs v2 (met BAG-matchrate en parser-failure-rate)');

  console.log('\nDONE');
}
main().catch(e => { console.error(e); process.exit(1); });
