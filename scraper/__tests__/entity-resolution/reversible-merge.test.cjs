const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { EntityResolver } = require('../../src/kg/entity-resolver.cjs');
const { migrate } = require('../../migrate-kg-merge-audit.cjs');

async function database() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stadsgeest-merge-'));
  const db = createClient({ url: `file:${path.join(directory, 'test.db')}` });
  db.testDirectory = directory;
  for (const sql of [
    `CREATE TABLE kg_entities(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT,canonical_name TEXT,normalized_name TEXT,source_person_id INTEGER,source_org_id INTEGER,merged_into_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE kg_aliases(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id INTEGER,alias TEXT,normalized_alias TEXT,match_mode TEXT DEFAULT 'ci',source TEXT,score_weight INTEGER DEFAULT 35,UNIQUE(entity_id,normalized_alias,match_mode))`,
    `CREATE TABLE entity_identifiers(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id INTEGER,identifier_type TEXT,value TEXT,source_url TEXT,verified_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(identifier_type,value))`,
    `CREATE TABLE locations(id INTEGER PRIMARY KEY AUTOINCREMENT,label TEXT,city TEXT,bag_id TEXT)`,
    `CREATE TABLE entity_locations(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id INTEGER,location_id INTEGER,relation_type TEXT,UNIQUE(entity_id,location_id,relation_type))`,
    `CREATE TABLE kg_relations(id INTEGER PRIMARY KEY AUTOINCREMENT,subject_id INTEGER,predicate TEXT,object_id INTEGER,role_title TEXT,source_url TEXT,evidence TEXT,confidence REAL)`,
    `CREATE TABLE event_entities(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER,entity_id INTEGER,role TEXT,UNIQUE(event_id,entity_id,role))`,
    `CREATE TABLE entity_merge_candidates(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_a_id INTEGER NOT NULL,entity_b_id INTEGER NOT NULL,score REAL,match_details TEXT,status TEXT DEFAULT 'pending',reviewed_by TEXT,reviewed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  ]) await db.execute(sql);
  await migrate(db);
  return db;
}

async function closeDatabase(db) {
  db.close();
}

test('merge is volledig geaudit en unmerge herstelt alle koppelingen', async () => {
  const db = await database();
  const keepId = Number((await db.execute("INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization','Hoofd BV','hoofd bv')")).lastInsertRowid);
  const mergeId = Number((await db.execute("INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization','Alias BV','alias bv')")).lastInsertRowid);
  const otherId = Number((await db.execute("INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization','Ander BV','ander bv')")).lastInsertRowid);
  const locationId = Number((await db.execute("INSERT INTO locations(label,city,bag_id) VALUES ('Test 1','Amersfoort','bag-1')")).lastInsertRowid);
  await db.execute({ sql: "INSERT INTO kg_aliases(entity_id,alias,normalized_alias) VALUES (?,?,?)", args: [mergeId, 'Alias', 'alias'] });
  await db.execute({ sql: "INSERT INTO entity_identifiers(entity_id,identifier_type,value) VALUES (?,'kvk','123')", args: [mergeId] });
  await db.execute({ sql: "INSERT INTO entity_locations(entity_id,location_id,relation_type) VALUES (?,?,'vestiging')", args: [mergeId, locationId] });
  await db.execute({ sql: "INSERT INTO kg_relations(subject_id,predicate,object_id) VALUES (?,'ONDERDEEL_VAN',?)", args: [mergeId, otherId] });
  await db.execute({ sql: "INSERT INTO event_entities(event_id,entity_id,role) VALUES (1,?,'subject')", args: [mergeId] });

  const resolver = new EntityResolver({ db });
  const auditId = await resolver.mergeEntities(keepId, mergeId, { actor: 'test', reason: 'sterke identifiermatch' });
  assert.ok(auditId > 0);
  assert.equal(Number((await db.execute({ sql: 'SELECT merged_into_id FROM kg_entities WHERE id=?', args: [mergeId] })).rows[0].merged_into_id), keepId);
  for (const [table, column] of [['kg_aliases','entity_id'],['entity_identifiers','entity_id'],['entity_locations','entity_id'],['event_entities','entity_id']]) {
    assert.equal(Number((await db.execute(`SELECT ${column} value FROM ${table} LIMIT 1`)).rows[0].value), keepId);
  }

  await resolver.unmerge(auditId, { actor: 'test', reason: 'controle terugdraaibaarheid' });
  assert.equal((await db.execute({ sql: 'SELECT merged_into_id FROM kg_entities WHERE id=?', args: [mergeId] })).rows[0].merged_into_id, null);
  for (const [table, column] of [['kg_aliases','entity_id'],['entity_identifiers','entity_id'],['entity_locations','entity_id'],['event_entities','entity_id']]) {
    assert.equal(Number((await db.execute(`SELECT ${column} value FROM ${table} LIMIT 1`)).rows[0].value), mergeId);
  }
  assert.equal(Number((await db.execute('SELECT subject_id FROM kg_relations')).rows[0].subject_id), mergeId);
  assert.equal((await db.execute({ sql: 'SELECT action FROM entity_merge_audits WHERE id=?', args: [auditId] })).rows[0].action, 'reversed');
  await closeDatabase(db);
});

test('review bewaart de kandidaat als afzonderlijke entity', async () => {
  const db = await database();
  const existingId = Number((await db.execute("INSERT INTO kg_entities(entity_type,canonical_name,normalized_name) VALUES ('organization','Voorbeeld BV','voorbeeld bv')")).lastInsertRowid);
  await db.execute({ sql: "INSERT INTO entity_identifiers(entity_id,identifier_type,value) VALUES (?,'website','voorbeeld.nl')", args: [existingId] });
  const resolver = new EntityResolver({ db });
  const result = await resolver.resolveOrCreate({ name: 'Voorbeeld BV', entityType: 'organization', website: 'voorbeeld.nl' });
  assert.equal(result.action, 'review');
  assert.notEqual(result.entityId, existingId);
  const candidate = (await db.execute('SELECT * FROM entity_merge_candidates')).rows[0];
  assert.equal(Number(candidate.entity_a_id), existingId);
  assert.equal(Number(candidate.entity_b_id), result.entityId);
  await closeDatabase(db);
});
