'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {init,save,validate,workset,tipHash,appendBlocks}=require('../../src/onderzoek.cjs');

async function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stadsgeest-onderzoek-'));
  const file=path.join(dir,'fixture.db');
  const sqlite=new DatabaseSync(file);
  const execute=async stmt=>{
    const sql=typeof stmt==='string'?stmt:stmt.sql,args=typeof stmt==='string'?[]:stmt.args||[];
    const prepared=sqlite.prepare(sql);
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)||/\bRETURNING\b/i.test(sql)) return {rows:prepared.all(...args)};
    const r=prepared.run(...args);return {rows:[],rowsAffected:r.changes,lastInsertRowid:r.lastInsertRowid};
  };
  const db={execute,executeMultiple:async sql=>sqlite.exec(sql),close:()=>sqlite.close(),transaction:async mode=>{
    sqlite.exec(mode==='write'?'BEGIN IMMEDIATE':'BEGIN');
    return {execute,commit:async()=>sqlite.exec('COMMIT'),rollback:async()=>sqlite.exec('ROLLBACK')};
  }};
  t.after(()=>{db.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});fs.rmdirSync(dir);});
  await db.executeMultiple(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE sources(id INTEGER PRIMARY KEY,name TEXT,tier INTEGER,bronrol TEXT);
    CREATE TABLE raw_items(id INTEGER PRIMARY KEY,source_id INTEGER,title TEXT,external_url TEXT,published_at TEXT,scraped_at TEXT,full_text TEXT,content TEXT,summary TEXT);
    CREATE TABLE signals(id INTEGER PRIMARY KEY,title TEXT,summary TEXT,status TEXT,confirmations INTEGER,threshold INTEGER,provenance TEXT,last_seen_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE signal_items(signal_id INTEGER,raw_item_id INTEGER,PRIMARY KEY(signal_id,raw_item_id));
    CREATE TABLE signal_events(id INTEGER PRIMARY KEY,signal_id INTEGER,actor TEXT,event_type TEXT,status_from TEXT,status_to TEXT,reason TEXT,payload TEXT,created_at TEXT DEFAULT(datetime('now')));
    CREATE TABLE dossiers(id INTEGER PRIMARY KEY);
    CREATE TABLE dossier_facts(id INTEGER PRIMARY KEY,dossier_id INTEGER,fact_type TEXT,datum TEXT,locatie TEXT,titel TEXT,details TEXT,classificatie TEXT,zekerheid TEXT,primaire_bron_url TEXT,secundaire_bronnen TEXT,signal_id INTEGER,tegenstrijdigheid TEXT,actor TEXT);
    CREATE TABLE tips(id INTEGER PRIMARY KEY,titel TEXT,kern TEXT,briefing TEXT,vervolgvragen TEXT,soort TEXT,gemeente TEXT,categorie TEXT,score INTEGER,score_motivatie TEXT,weging TEXT,herkomst TEXT,elders_gebracht TEXT,toegevoegde_waarde TEXT,dossier_id INTEGER,actor TEXT,trefwoorden TEXT,supertip INTEGER,status TEXT DEFAULT 'wachtrij',updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE tip_signals(tip_id INTEGER,signal_id INTEGER,rol TEXT,PRIMARY KEY(tip_id,signal_id));
    CREATE TABLE tip_events(id INTEGER PRIMARY KEY,tip_id INTEGER,actor TEXT,event_type TEXT,status_from TEXT,status_to TEXT,reason TEXT,payload TEXT);
    INSERT INTO sources VALUES(1,'Officiële bron',1,NULL),(2,'Spiegel',1,'spiegel');
    INSERT INTO raw_items(id,source_id,title,external_url,content) VALUES(10,1,'Vergelijkingsstuk','https://example.org/bron','Volledige bron'),(11,1,'Oud niet geselecteerd stuk','https://example.org/ander','Oorspronkelijk feit'),(12,2,'Artikel','https://example.org/spiegel','Afgeleid');
    INSERT INTO signals(id,title,summary,status,last_seen_at) VALUES(42,'Te onderzoeken verandering','Geregistreerde verandering','watching','2026-10-20T05:00:00.000Z'),(43,'Een ander signaal','Context','watching','2026-10-20 05:00:00');
    INSERT INTO signal_items VALUES(42,10);
    INSERT INTO signal_events(signal_id,actor,event_type,status_to,reason,created_at) VALUES(42,'weger','reviewed','watching','Onderzoek reden en gevolgen','2026-10-20 08:00:00'),(43,'weger','reviewed','watching','Vergelijk oude en nieuwe regeling','2026-10-20 08:00:00');
    INSERT INTO dossiers VALUES(4);
  `);
  await init(db);
  return db;
}
function plan() {
  return {request_id:'test-onderzoek-001',cases:[{case_key:'geregistreerde-verandering',expected_version:0,question:'Wat verklaart de geregistreerde verandering?',signal_ids:[42],source_urls:['https://example.org/bron'],status:'researching',findings:'Het register toont een verschil; de oorzaak staat niet vast.',next_action:'Vergelijk de volledige bronversies.',review_after:'2026-10-27T10:00:00Z'}]};
}
function withTip() {
  const p=plan();
  p.weger=JSON.parse(fs.readFileSync(path.join(__dirname,'../../../operations/weger-plan.example.json'),'utf8'));
  p.cases[0].status='tipped';
  p.cases[0].new_tip_index=0;
  return p;
}

test('schema is idempotent en een dry-run bewaart geen voortgang',async t=>{
  const db=await setup(t);await init(db);
  assert.equal((await save(db,plan())).mode,'dry-run');
  assert.equal((await db.execute('SELECT * FROM research_cases')).rows.length,0);
});
test('voortgang wordt eenmalig opgeslagen; dezelfde request met andere inhoud faalt',async t=>{
  const db=await setup(t);const p=plan();
  await save(db,p,true);assert.equal((await save(db,p,true)).mode,'already_applied');
  assert.equal((await db.execute('SELECT * FROM research_case_events')).rows.length,1);
  p.cases[0].findings='Andere inhoud';await assert.rejects(save(db,p,true),/ander plan/);
});
test('versieconflicten blokkeren het hele plan',async t=>{
  const db=await setup(t);await save(db,plan(),true);
  const p=withTip();p.request_id='test-onderzoek-stale';
  await assert.rejects(save(db,p,true),/Versieconflict/);
  assert.equal((await db.execute('SELECT * FROM tips')).rows.length,0);
});
test('werkset herkent eerder beoordeelde kandidaten zonder nieuwe scrape en bewaart wachttermijnen',async t=>{
  const db=await setup(t);
  let w=await workset(db,{now:'2026-10-26T10:00:00Z'});
  assert.deepEqual(w.candidates.map(s=>s.id),[43,42]);
  await save(db,plan(),true);
  w=await workset(db,{now:'2026-10-26T10:00:00Z'});
  assert.deepEqual(w.candidates.map(s=>s.id),[43]);assert.equal(w.due_cases.length,0);
  w=await workset(db,{now:'2026-10-28T10:00:00Z'});assert.equal(w.due_cases.length,1);
});
test('onderzoek schrijft zelf een gevalideerde tip en bewaart de juiste herkomst',async t=>{
  const db=await setup(t);const p=withTip();assert.deepEqual(validate(p),[]);
  const r=await save(db,p,true);assert.equal(r.tip_ids.length,1);
  assert.equal((await db.execute('SELECT actor FROM tips')).rows[0].actor,'codex-onderzoek');
  assert.equal((await db.execute('SELECT tip_id FROM research_cases')).rows[0].tip_id,r.tip_ids[0]);
  assert.equal((await db.execute("SELECT actor FROM signal_events WHERE event_type='tip_created'")).rows[0].actor,'codex-onderzoek');
  const duplicate=withTip();duplicate.request_id='test-tip-duplicaat';duplicate.cases[0].expected_version=1;
  await assert.rejects(save(db,duplicate,true),/al aan een tip gekoppeld/);
});
test('nieuw materiaal bij een oudere tip blijft beschikbaar voor onderzoeksopvolging',async t=>{
  const db=await setup(t);await save(db,withTip(),true);
  await db.execute("UPDATE signal_events SET created_at='2026-08-01 08:00:00' WHERE actor='weger'");
  await db.execute("UPDATE research_cases SET updated_at='2026-08-01 09:00:00'");
  await db.execute("UPDATE signals SET last_seen_at='2026-10-26T09:00:00.000Z' WHERE id=42");
  const w=await workset(db,{now:'2026-10-26T10:00:00Z'});
  assert.ok(w.candidates.some(s=>s.id===42&&s.tip_ids.length===1));
});
test('een fout aan het einde rolt ook tip en dossierfeiten terug',async t=>{
  const db=await setup(t);
  await db.execute("CREATE TRIGGER reject_event BEFORE INSERT ON research_case_events BEGIN SELECT RAISE(ABORT,'injected_failure'); END");
  await assert.rejects(save(db,withTip(),true),/injected_failure/);
  assert.equal((await db.execute('SELECT * FROM tips')).rows.length,0);
  assert.equal((await db.execute('SELECT * FROM dossier_facts')).rows.length,0);
  assert.equal((await db.execute('SELECT * FROM research_runs')).rows.length,0);
});
test('aanvullen bewaart alle oorspronkelijke feiten, blokken en letterlijke dollartekens',()=>{
  const before='WAT WE WETEN\n1. Oud feit.\n2. Tweede feit.\n\nWAT WE NIET WETEN\n- Oorzaak.\n\nELDERS GEBRACHT\nOud artikel.';
  const after=appendBlocks(before,{'WAT WE WETEN':'3. Nieuwe bron noemt $50.','ELDERS GEBRACHT':'Nieuw artikel.'});
  assert.ok(after.includes('1. Oud feit.\n2. Tweede feit.\n\n3. Nieuwe bron noemt $50.'));
  assert.ok(after.endsWith('Oud artikel.\n\nNieuw artikel.\n'));
  assert.equal((after.match(/WAT WE NIET WETEN/g)||[]).length,1);
});
test('tipaanvulling bewaart redactionele status en historische score en detecteert gewijzigde tip',async t=>{
  const db=await setup(t);const first=withTip();const r=await save(db,first,true);
  const tip=(await db.execute('SELECT * FROM tips')).rows[0];
  const p=plan();p.request_id='test-aanvulling-001';p.cases[0].expected_version=1;p.cases[0].tip_id=r.tip_ids[0];
  p.tip_updates=[{tip_id:r.tip_ids[0],expected_hash:tipHash(tip),reason:'Nieuwe gecontroleerde planning gevonden.',score:8,weging:first.weger.tips[0].weging,additions:{'WAT WE WETEN':'2. Aanvulling: uitvoering gepland in 2028 — https://example.org/nieuw, 26 oktober 2026'},sources:[{naam:'Gemeente',url:'https://example.org/nieuw',datum:'2026-10-26',tier:1,bijdrage:'Nieuwe planning'}]}];
  await save(db,p,true);
  const changed=(await db.execute('SELECT * FROM tips')).rows[0];
  assert.equal(changed.status,tip.status);assert.equal(changed.score,tip.score);
  assert.ok(changed.briefing.includes('uitvoering gepland in 2028'));
  const event=(await db.execute("SELECT payload FROM tip_events WHERE event_type='research_addition'")).rows[0];
  assert.equal(JSON.parse(event.payload).previous_briefing,tip.briefing);
  p.request_id='test-aanvulling-stale';p.cases[0].expected_version=2;
  await assert.rejects(save(db,p,true),/Tip is inmiddels gewijzigd/);
  p.tip_updates[0].expected_hash=tipHash(changed);await db.execute("UPDATE tips SET status='afgekeurd'");
  await assert.rejects(save(db,p,true),/Alleen een actieve tip/);
});
test('zelfstandige vondst krijgt een signaal uit oorspronkelijke ongekoppelde stukken',async t=>{
  const db=await setup(t);const p=plan();p.cases[0].signal_ids=[];
  p.discoveries=[{case_key:p.cases[0].case_key,title:'Vergelijking vindt een verandering',summary:'Officiële versies verschillen.',raw_item_ids:[11]}];
  const r=await save(db,p,true);const id=r.created_signal_ids[p.cases[0].case_key];assert.ok(id);
  assert.equal((await db.execute({sql:'SELECT raw_item_id FROM signal_items WHERE signal_id=?',args:[id]})).rows[0].raw_item_id,11);
  assert.deepEqual(JSON.parse((await db.execute('SELECT signal_ids FROM research_cases')).rows[0].signal_ids),[id]);
});
test('spiegelvondst, dubbele bronidentiteit, ontbrekende datum en lage score worden geweigerd',async t=>{
  const db=await setup(t);const p=plan();p.cases[0].signal_ids=[];
  p.discoveries=[{case_key:p.cases[0].case_key,title:'Vondst',summary:'Vergelijking',raw_item_ids:[12]}];
  await assert.rejects(save(db,p,true),/oorspronkelijke bron/);
  p.discoveries[0].raw_item_ids=[10];await assert.rejects(save(db,p,true),/heeft al signaal/);
  delete p.discoveries;p.cases[0].review_after=null;assert.match(validate(p).join('\n'),/review_after/);
  const weak=withTip();weak.weger.tips[0].score=6;assert.match(validate(weak).join('\n'),/minimaal 7/);
  const supertip=withTip();supertip.weger.run='supertip';supertip.weger.tips[0].supertip=true;
  assert.match(validate(supertip).join('\n'),/geen supertip/);
});
