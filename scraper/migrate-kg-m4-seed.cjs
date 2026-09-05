// Migratie M4 — Data-seed: bestaande data overnemen naar kg_* tabellen
// Idempotent: controleert of kg_entities al gevuld is
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function main() {
  // Check of seed al is gedraaid
  const existing = (await db.execute('SELECT COUNT(*) as n FROM kg_entities')).rows[0].n;
  if (existing > 0) {
    console.log(`kg_entities bevat al ${existing} rijen — seed overslaan.`);
    console.log('Verwijder eerst alle kg_entities als je de seed opnieuw wilt draaien.');
    return;
  }

  // Eerst tabelstructuren controleren
  const personAliasesCols = (await db.execute('PRAGMA table_info(person_aliases)')).rows.map(r => r.name);
  console.log('person_aliases kolommen:', personAliasesCols.join(', '));
  const orgAliasesCols = (await db.execute('PRAGMA table_info(org_aliases)')).rows.map(r => r.name);
  console.log('org_aliases kolommen:', orgAliasesCols.join(', '));
  const rolesCols = (await db.execute('PRAGMA table_info(roles)')).rows.map(r => r.name);
  console.log('roles kolommen:', rolesCols.join(', '));

  // === Stap 1: Personen → kg_entities ===
  console.log('\n=== Stap 1: Personen → kg_entities ===');
  const personsResult = await db.execute(`
    INSERT INTO kg_entities (entity_type, canonical_name, normalized_name, source_person_id)
    SELECT 'person', name,
      lower(replace(replace(name, '.', ''), '  ', ' ')),
      id
    FROM persons
  `);
  console.log(`  ${personsResult.rowsAffected} personen geïmporteerd`);

  // === Stap 2: Organisaties → kg_entities ===
  console.log('\n=== Stap 2: Organisaties → kg_entities ===');
  const orgsResult = await db.execute(`
    INSERT INTO kg_entities (entity_type, canonical_name, normalized_name, source_org_id)
    SELECT 'organization', name,
      lower(replace(replace(name, '.', ''), '  ', ' ')),
      id
    FROM organizations
  `);
  console.log(`  ${orgsResult.rowsAffected} organisaties geïmporteerd`);

  // === Stap 3: person_aliases → kg_aliases ===
  console.log('\n=== Stap 3: person_aliases → kg_aliases ===');
  const hasMatchMode = personAliasesCols.includes('match_mode');
  const hasNormalizedAlias = personAliasesCols.includes('normalized_alias');

  let paQuery;
  if (hasNormalizedAlias && hasMatchMode) {
    paQuery = `
      INSERT INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
      SELECT ke.id, pa.alias, pa.normalized_alias, pa.match_mode, 'migratie'
      FROM person_aliases pa
      JOIN kg_entities ke ON ke.source_person_id = pa.person_id
    `;
  } else if (hasNormalizedAlias) {
    paQuery = `
      INSERT INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
      SELECT ke.id, pa.alias, pa.normalized_alias, 'ci', 'migratie'
      FROM person_aliases pa
      JOIN kg_entities ke ON ke.source_person_id = pa.person_id
    `;
  } else {
    paQuery = `
      INSERT INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
      SELECT ke.id, pa.alias, lower(replace(replace(pa.alias, '.', ''), '  ', ' ')), 'ci', 'migratie'
      FROM person_aliases pa
      JOIN kg_entities ke ON ke.source_person_id = pa.person_id
    `;
  }
  const paResult = await db.execute(paQuery);
  console.log(`  ${paResult.rowsAffected} persoons-aliassen geïmporteerd`);

  // === Stap 4: org_aliases → kg_aliases ===
  console.log('\n=== Stap 4: org_aliases → kg_aliases ===');
  const oaHasNormalized = orgAliasesCols.includes('normalized_alias');
  let oaQuery;
  if (oaHasNormalized) {
    oaQuery = `
      INSERT INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
      SELECT ke.id, oa.alias, oa.normalized_alias, 'ci', 'migratie'
      FROM org_aliases oa
      JOIN kg_entities ke ON ke.source_org_id = oa.organization_id
    `;
  } else {
    oaQuery = `
      INSERT INTO kg_aliases (entity_id, alias, normalized_alias, match_mode, source)
      SELECT ke.id, oa.alias, lower(replace(replace(oa.alias, '.', ''), '  ', ' ')), 'ci', 'migratie'
      FROM org_aliases oa
      JOIN kg_entities ke ON ke.source_org_id = oa.organization_id
    `;
  }
  const oaResult = await db.execute(oaQuery);
  console.log(`  ${oaResult.rowsAffected} organisatie-aliassen geïmporteerd`);

  // === Stap 5: roles → kg_relations ===
  console.log('\n=== Stap 5: roles → kg_relations ===');
  const hasIsCurrent = rolesCols.includes('is_current');
  const whereClause = hasIsCurrent ? 'WHERE r.is_current = 1' : '';
  const relResult = await db.execute(`
    INSERT INTO kg_relations (subject_id, predicate, object_id, role_title, source_url)
    SELECT
      ke_person.id, 'FUNCTIE', ke_org.id, r.title, NULL
    FROM roles r
    JOIN kg_entities ke_person ON ke_person.source_person_id = r.person_id
    JOIN kg_entities ke_org ON ke_org.source_org_id = r.organization_id
    ${whereClause}
  `);
  console.log(`  ${relResult.rowsAffected} rollen/relaties geïmporteerd`);

  // === Stap 6: KvK-nummers → entity_identifiers ===
  console.log('\n=== Stap 6: KvK-nummers → entity_identifiers ===');
  const kvkResult = await db.execute(`
    INSERT OR IGNORE INTO entity_identifiers (entity_id, identifier_type, value, source_url)
    SELECT ke.id, 'kvk', e.name, NULL
    FROM entities e
    JOIN kg_entities ke ON ke.source_org_id = e.organization_id
    WHERE e.entity_type = 'kvk_number' AND e.organization_id IS NOT NULL
  `);
  console.log(`  ${kvkResult.rowsAffected} KvK-nummers geïmporteerd`);

  // === Verificatie ===
  console.log('\n=== VERIFICATIE ===');
  const counts = [
    ['kg_entities', 'SELECT COUNT(*) as n FROM kg_entities'],
    ['  - personen', "SELECT COUNT(*) as n FROM kg_entities WHERE entity_type='person'"],
    ['  - organisaties', "SELECT COUNT(*) as n FROM kg_entities WHERE entity_type='organization'"],
    ['kg_aliases', 'SELECT COUNT(*) as n FROM kg_aliases'],
    ['kg_relations', 'SELECT COUNT(*) as n FROM kg_relations'],
    ['entity_identifiers', 'SELECT COUNT(*) as n FROM entity_identifiers'],
  ];
  for (const [label, q] of counts) {
    const r = await db.execute(q);
    console.log(`  ${label}: ${r.rows[0].n}`);
  }

  console.log('\nM4 data-seed voltooid.');
}

main().catch(e => { console.error('FOUT:', e.message); process.exit(1); });
