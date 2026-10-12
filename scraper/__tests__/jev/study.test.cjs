'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createClient}=require('@libsql/client');
const prep=require('../../src/document-relations.cjs'),study=require('../../src/jev-study.cjs');
const budget=require('../../src/jev-budget.cjs'),v1=require('../../src/jev-experiment-lib.cjs');
const {sourceHash}=require('../../src/weger-jev.cjs');
function doc(id,title='Wind op Isselt',agenda='Wind op Isselt') {
  const body=`Gemeenteraad Amersfoort\nVergaderdatum: 2026-10-07\nAgendapunt: 3. ${agenda}\nSoort document: Document\n\nAanleiding: ${title} wordt inhoudelijk onderzocht. `+'Toelichting. '.repeat(20);
  return {raw_item_id:id,doc_key:`item:${id}`,source_id:168,source_name:'Raad Amersfoort',title,
    url:`https://api.notubiz.nl/document/${id}/1`,published_at:'2026-10-07',body,content_hash:sourceHash(title,body)};
}
test('algemene bronvoorbereiding vindt structuur of specifieke woorden, geen gedeelde fractie',()=>{
  const a=doc(1,'Akoestisch onderzoek Wind op Isselt'),b=doc(2,'Slagschaduw Wind op Isselt');
  assert.equal(prep.candidatePairs([a,b],[a]).length,1);
  const x=doc(3,'Motie Partij voor de Dieren: Onderzoek ratten','Ratten'),y=doc(4,'Motie Partij voor de Dieren: Zwembad Hoogland','Zwembad');
  assert.equal(prep.candidatePairs([x,y],[x]).length,0);
});
test('burgerbrieven, andere bronnen en niet-webdocumenten blijven buiten de betaalde/algemene voorbereiding',()=>{
  assert.equal(prep.eligible(doc(1,'Bezwaarschrift burger')),false);
  assert.equal(prep.eligible({...doc(1),source_id:17}),false);
  assert.equal(prep.eligible({...doc(1),url:'file:///geheim'}),false);
});
test('voorbereiding bewaart passageposities, datum en beoordeling zonder API-afhankelijkheid',()=>{
  const p=prep.preparation(prep.pairOf(doc(1),doc(2)));
  assert.equal(p.state,'unreviewed');assert.equal(p.review,null);assert.equal(p.confirmed,false);assert.equal(p.merge_allowed,false);
  assert.equal(p.documents[0].published_at,'2026-10-07');assert.equal(p.documents[0].passages[0].coordinate_space,'normalized_source');
});
test('lege werkset doet geen extra archief- of databaselezing',async()=>{
  const fail=()=>{throw Error('Mag niet lezen');};const r=await prep.prepareWorkset({execute:fail},[],fail);
  assert.equal(r.summary.status,'no_selected_signals');
});
test('beide splits houden dezelfde agendagroep en identieke bronidentiteit bij elkaar',()=>{
  const a=doc(1),b=doc(2),c=doc(3,'Iets anders','Andere agenda');
  const r=study.splitPool([a,b,c]);const bin=r.development.some(d=>d.doc_key===a.doc_key)?r.development:r.holdout;
  assert.ok(bin.some(d=>d.doc_key===b.doc_key));
  assert.equal(new Set([...r.development,...r.holdout].map(d=>d.doc_key)).size,3);
});
test('identieke tekst onder andere URL en vergaderkop lekt niet over splits heen',()=>{
  const a=doc(1),b=doc(2,'Ander titel','Andere agenda');b.body=a.body.replace('3. Wind op Isselt','4. Andere agenda');
  assert.equal(study.contentFingerprint(a),study.contentFingerprint(b));
  const bins=study.splitPool([a,b]);assert.ok(bins.development.length===2||bins.holdout.length===2);
});
test('rapport onderscheidt extra onjuiste koppeling, gemist verband en onthouding',()=>{
  const r=study.metrics([{id:'a'},{id:'b'},{id:'c'}],new Map([['a','same_case'],['b','insufficient'],['c','same_dossier']]),
    [{pair_id:'a',label:'no_link'},{pair_id:'b',label:'same_dossier'},{pair_id:'c',label:'same_case'}]);
  assert.equal(r.fp,1);assert.equal(r.fn,1);assert.equal(r.tp,1);assert.equal(r.abstain,1);assert.equal(r.exact_agreement,0);
});
test('5-dollargrens telt alle eerdere proeven en onzekere reserveringen mee; vervalste kosten worden geweigerd',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'stadsgeest-budget-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  fs.mkdirSync(path.join(base,'followup'));fs.mkdirSync(path.join(base,'large'));
  const entry={status:'ok',result:{input_tokens:64000,cost_usd:64000*v1.PRICE}};
  fs.writeFileSync(path.join(base,'ledger.json'),JSON.stringify({entries:[entry]}));
  fs.writeFileSync(path.join(base,'large','ledger.json'),JSON.stringify({entries:[{status:'unresolved'}]}));
  assert.equal(budget.total(base),2*v1.RESERVATION);assert.equal(budget.mayReserve(2*v1.RESERVATION,base),false);
  assert.throws(()=>budget.mayReserve(5.01,base),/5 USD/);
  fs.writeFileSync(path.join(base,'large','ledger.json.writing'),JSON.stringify({entries:[{status:'reserved'},{status:'unresolved'}]}));
  assert.equal(budget.total(base),3*v1.RESERVATION);
  entry.result.cost_usd=0;fs.writeFileSync(path.join(base,'ledger.json'),JSON.stringify({entries:[entry]}));assert.throws(()=>budget.total(base),/ongeldig/);
});
test('actuele bronnen en deelitemankers worden gericht aangeboden zonder signaalstatus te veranderen',async t=>{
  const db=createClient({url:':memory:'});t.after(()=>db.close());const a=doc(1),b=doc(2);
  await db.executeMultiple(`CREATE TABLE raw_items(id INTEGER PRIMARY KEY,title,source_id,external_url,published_at,full_text,content,summary);
    CREATE TABLE sources(id INTEGER PRIMARY KEY,name);INSERT INTO sources VALUES(168,'Raad Amersfoort');
    CREATE TABLE raw_item_parts(part_id INTEGER PRIMARY KEY,parent_id,UNIQUE(parent_id,part_id));
    CREATE TABLE signal_items(signal_id,raw_item_id);CREATE INDEX si_signal ON signal_items(signal_id);CREATE INDEX si_item ON signal_items(raw_item_id);`);
  for(const d of[a,b])await db.execute({sql:'INSERT INTO raw_items VALUES(?,?,?,?,?,?,NULL,NULL)',args:[d.raw_item_id,d.title,d.source_id,d.url,d.published_at,d.body]});
  await db.executeMultiple('INSERT INTO raw_item_parts VALUES(11,1);INSERT INTO signal_items VALUES(7,11);');
  const candidates=[{signal:{id:7,status:'new'},items:[]}];const r=await prep.prepareWorkset(db,candidates,async()=>[b]);
  assert.equal(r.bySignal.get(7).length,1);assert.equal(r.summary.paid_api_calls,0);assert.equal(candidates[0].signal.status,'new');
  await db.execute("UPDATE raw_items SET title='Nieuwere versie' WHERE id=2");
  assert.equal((await prep.prepareWorkset(db,candidates,async()=>[a,b])).bySignal.get(7).length,0);
});
