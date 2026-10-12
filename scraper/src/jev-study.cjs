#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const v1 = require('./jev-experiment-lib.cjs'), lib = require('./jev-followup-lib.cjs');
const prep = require('./document-relations.cjs'), budget = require('./jev-budget.cjs');
const OUT = path.join(budget.BASE,'large');
function read(name, fallback) { const f=path.join(OUT,name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f,'utf8')) : fallback; }
function write(name, value) {
  const f=path.join(OUT,name), pending=f+'.writing';
  fs.writeFileSync(pending,JSON.stringify(value,null,2)+'\n');
  for(let n=0;;n++) { try { fs.renameSync(pending,f); return; } catch(e) {
    if(!['EPERM','EBUSY','EACCES'].includes(e.code) || n>=9) throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  } }
}
function contentFingerprint(d) {
  const raw=String(d.body||''),m=/(?:Soort document:[^\n]*|Vergadering:\s*https?:[^\n]*)\n\s*\n/.exec(raw);
  const text=lib.norm(m?raw.slice(m.index+m[0].length):raw);
  return text.length>=300 ? v1.hash(text) : null;
}
// Groepeer gedeelde documenten, agendatitels, zaakkenmerken en identieke bron-ID's
// vóór de splitsing. Geen testdocument wordt gebruikt voor ontwikkeling.
function splitPool(pool) {
  const parent=new Map(pool.map(d=>[d.doc_key,d.doc_key]));
  function root(k) { const p=parent.get(k); if(p!==k)parent.set(k,root(p));return parent.get(k); }
  const keys=new Map();
  for(const d of pool) {
    const m=lib.metadata(d);
    const fp=contentFingerprint(d);
    const group=[m.document_key,fp&&'body:'+fp,m.authority&&m.case_id&&m.authority+':case:'+m.case_id,
      m.authority&&m.agenda_title&&!/actualiteiten|mededelingen|termijnagenda|ingekomen|vaststellen/i.test(m.agenda_title)&&m.authority+':agenda:'+m.agenda_title];
    for(const k of group.filter(Boolean)) { if(keys.has(k))parent.set(root(d.doc_key),root(keys.get(k)));else keys.set(k,d.doc_key); }
  }
  const groups=new Map();for(const d of pool) { const r=root(d.doc_key);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(d); }
  const development=[],holdout=[];
  for(const docs of groups.values()) {
    const h=v1.hash(docs.map(d=>d.doc_key).sort());
    (parseInt(h.slice(0,8),16)%4===0 ? holdout : development).push(...docs);
  }
  return {development,holdout};
}
function sample(pool, counts, excluded=new Set()) {
  const all=prep.candidatePairs(pool,pool,8).filter(p=>!excluded.has(p.id));
  const chosen=[], seen=new Set(), usage=new Map(), agendas=new Map();
  function add(p) {
    if(seen.has(p.id)||[p.a,p.b].some(d=>(usage.get(d.doc_key)||0)>=4))return false;
    const m=lib.metadata(p.a),key=m.agenda_key;
    if(p.stratum==='structure'&&key&&(agendas.get(key)||0)>=3)return false;
    chosen.push(p);seen.add(p.id);for(const d of[p.a,p.b])usage.set(d.doc_key,(usage.get(d.doc_key)||0)+1);
    if(key)agendas.set(key,(agendas.get(key)||0)+1);return true;
  }
  for(const stratum of ['structure','overlap']) {
    let n=0;for(const p of all.filter(p=>p.stratum===stratum))if(add(p)&&++n===counts[stratum])break;
    if(n!==counts[stratum])throw Error('Onvoldoende '+stratum+'-paren: '+n);
  }
  const controls=[],tokens=new Map(pool.map(d=>[d.doc_key,prep.words(d)])),meta=new Map(pool.map(d=>[d.doc_key,lib.metadata(d)]));
  for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++) {
    const a=pool[i],b=pool[j];if(tokens.get(a.doc_key).some(w=>tokens.get(b.doc_key).includes(w)))continue;
    const x=meta.get(a.doc_key),y=meta.get(b.doc_key);
    if((x.agenda_key&&x.agenda_key===y.agenda_key)||(x.authority&&x.authority===y.authority&&x.case_id&&x.case_id===y.case_id))continue;
    const id=v1.hash([a.doc_key,b.doc_key].sort()).slice(0,16);if(excluded.has(id))continue;controls.push({id,a,b,stratum:'control'});
  }
  controls.sort((a,b)=>a.id.localeCompare(b.id));let n=0;
  for(const p of controls)if(add(p)&&++n===counts.control)break;
  if(n!==counts.control)throw Error('Onvoldoende controleparen.');
  return chosen.map(p=>p.baseline?p:prep.pairOf(p.a,p.b,p.stratum)).sort((a,b)=>a.id.localeCompare(b.id));
}
async function prepare() {
  if(read('dataset.json',null))throw Error('Dataset is al bevroren.');
  const old=[JSON.parse(fs.readFileSync(path.join(budget.BASE,'dataset.json'),'utf8')),
    JSON.parse(fs.readFileSync(path.join(budget.BASE,'followup','dataset.json'),'utf8'))];
  const excluded=new Set(old.flatMap(d=>d.pairs.map(p=>p.id)));
  const pool=await prep.readPool(), split=splitPool(pool);
  const pairs=[...sample(split.development,{structure:60,overlap:90,control:50},excluded).map(p=>({...p,split:'development'})),
    ...sample(split.holdout,{structure:12,overlap:33,control:15},excluded).map(p=>({...p,split:'holdout'}))];
  write('dataset.json',{version:lib.VERSION,created_at:new Date().toISOString(),pairs,dataset_hash:v1.hash(pairs),
    scope:'200 ontwikkelparen plus 60 vooraf afgezonderde controleparen. Document-, zaak- en agendagroepen gescheiden; themaoverlap blijft mogelijk. Eerdere paren uitgesloten; bronnen kunnen eerder gebruikt zijn.',
    pool_count:pool.length,split_document_counts:{development:split.development.length,holdout:split.holdout.length}});
  console.log(JSON.stringify({prepared:pairs.length,split_document_counts:{development:split.development.length,holdout:split.holdout.length}}));
}
function frozen() {
  const d=read('dataset.json',null),r=read('references.json',null);
  if(!d||v1.hash(d.pairs)!==d.dataset_hash||!r||r.dataset_hash!==d.dataset_hash||v1.hash(r.reviews)!==r.reference_hash
    ||r.reviews.length!==d.pairs.length||new Set(r.reviews.map(x=>x.pair_id)).size!==d.pairs.length
    ||r.reviewer_type!=='ai'||r.frozen_before_api!==true||r.user_accepted_reference_basis!==true
    ||!r.reviews.every(x=>d.pairs.some(p=>p.id===x.pair_id)&&x.reviewer==='Codex'&&x.reviewer_type==='ai'
      &&Object.hasOwn(lib.RELATIONS,x.label)&&Object.hasOwn(lib.DOCUMENTS,x.document)&&x.note&&Number.isFinite(Date.parse(x.reviewed_at))))throw Error('Complete bevroren AI-referentie vereist.');
  return {d,r};
}
async function run(mode, split='development') {
  if(!['selected','short','reverse'].includes(mode)||!['development','holdout'].includes(split))throw Error('Ongeldige modus/split.');
  require('dotenv').config({path:path.join(__dirname,'..','.env'),quiet:true});if(!process.env.TYPESAFE_API_KEY)throw Error('Jev-sleutel ontbreekt.');
  const {d,r}=frozen(),ledger=read('ledger.json',{entries:[]});
  if(ledger.entries.some(e=>e.dataset_hash!==d.dataset_hash||e.reference_hash!==r.reference_hash))throw Error('Referentie gewijzigd.');
  const pairs=d.pairs.filter(p=>p.split===split).filter((p,i)=>mode!=='reverse'||i%5===0);
  let done=0;
  for(const p of pairs) {
    const request=lib.requestFor(p,mode==='short'?'short':'selected',mode==='reverse'),requestHash=v1.hash(request);
    const existing=ledger.entries.find(e=>e.request_hash===requestHash&&e.status!=='not_sent');
    if(existing) {if(existing.status!=='ok')throw Error('Onzeker betaald verzoek; geen automatische herhaling.');continue;}
    const reference=r.reviews.find(x=>x.pair_id===p.id);
    if(Date.parse(reference.reviewed_at)>=Date.now())throw Error('Reviewdatum ongeldig.');
    if(!budget.mayReserve(5))throw Error('Gedeeld budget van 5 USD bereikt.');
    const body=JSON.stringify(request);if(Buffer.byteLength(body)>28000)throw Error('Invoer te groot.');
    const e={pair_id:p.id,split,mode,request,request_hash:requestHash,dataset_hash:d.dataset_hash,reference_hash:r.reference_hash,
      status:'reserved',reserved_usd:v1.RESERVATION,started_at:new Date().toISOString()};
    ledger.entries.push(e);write('ledger.json',ledger);
    try {
      const response=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:'Bearer '+process.env.TYPESAFE_API_KEY,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Jev HTTP '+response.status);
      e.result=lib.validate(await response.json());e.status='ok';e.finished_at=new Date().toISOString();
    } catch(error) {e.status=error.cause?.code==='EACCES'?'not_sent':'unresolved';write('ledger.json',ledger);throw Error(error.message.startsWith('Jev HTTP')?error.message:'Verzoek onbevestigd; geen automatische retry.');}
    write('ledger.json',ledger);done++;
    if(done%20===0)console.log(JSON.stringify({split,mode,completed:done,total_usd:budget.total()}));
  }
  console.log(JSON.stringify({split,mode,completed:done,total_usd:budget.total()}));
}
function metrics(pairs, predictions, refs) {
  const linking=x=>['same_case','same_dossier','related_dossiers'].includes(x);
  let exact=0,tp=0,fp=0,fn=0,tn=0,abstain=0,unknown=0,proposedUnknown=0,falseKnown=0;const disagreements=[];
  for(const p of pairs) {
    const ref=refs.find(x=>x.pair_id===p.id),pred=predictions.get(p.id);if(!pred)throw Error('Antwoord ontbreekt.');
    exact+=Number(pred===ref.label);abstain+=Number(pred==='insufficient');
    unknown+=Number(ref.label==='insufficient');
    proposedUnknown+=Number(ref.label==='insufficient'&&linking(pred));
    falseKnown+=Number(ref.label==='no_link'&&linking(pred));
    if(linking(pred)&&linking(ref.label))tp++;else if(linking(pred))fp++;else if(linking(ref.label))fn++;else tn++;
    if(pred!==ref.label)disagreements.push({pair_id:p.id,reference:ref.label,prediction:pred});
  }
  return {pairs:pairs.length,exact_agreement:exact,tp,fp,fn,tn,abstain,reference_insufficient:unknown,
    proposed_on_insufficient:proposedUnknown,false_links_on_no_link:falseKnown,disagreements,
    precision_on_determinate_ai_references:tp+falseKnown?tp/(tp+falseKnown):null,
    precision_vs_ai_reference:tp+fp?tp/(tp+fp):null,recall_vs_ai_reference:tp+fn?tp/(tp+fn):null};
}
function report() {
  const {d,r}=frozen(),ledger=read('ledger.json',{entries:[]}),output={reference_type:'ai',human_reviews:0,splits:{},total_accounted_usd:budget.total(),production_writes:0};
  for(const e of ledger.entries) {
    const pair=d.pairs.find(p=>p.id===e.pair_id),ref=r.reviews.find(x=>x.pair_id===e.pair_id);
    if(!pair||e.dataset_hash!==d.dataset_hash||e.reference_hash!==r.reference_hash
      ||v1.hash(e.request)!==e.request_hash
      ||v1.hash(lib.requestFor(pair,e.mode==='short'?'short':'selected',e.mode==='reverse'))!==e.request_hash
      ||Date.parse(ref.reviewed_at)>=Date.parse(e.started_at))throw Error('Antwoordprovenance ongeldig.');
    if(e.status==='ok')lib.validate({model:e.result.model,answers:e.result.answers,usage:{input_tokens:e.result.input_tokens}});
  }
  for(const split of ['development','holdout']) {
    const pairs=d.pairs.filter(p=>p.split===split),modes={};
    modes.structure=metrics(pairs,new Map(pairs.map(p=>[p.id,p.baseline.relation])),r.reviews);
    for(const mode of ['short','selected']) {
      const entries=ledger.entries.filter(e=>e.status==='ok'&&e.split===split&&e.mode===mode);
      if(entries.length===pairs.length) {
        modes[mode]=metrics(pairs,new Map(entries.map(e=>[e.pair_id,e.result.answers.relation.choice])),r.reviews);
        modes[mode].document_agreement=entries.filter(e=>e.result.answers.document.choice===r.reviews.find(x=>x.pair_id===e.pair_id).document).length;
        modes[mode].by_stratum=Object.fromEntries(['structure','overlap','control'].map(stratum=>[stratum,
          metrics(pairs.filter(p=>p.stratum===stratum),new Map(entries.map(e=>[e.pair_id,e.result.answers.relation.choice])),r.reviews)]));
        modes[mode].additional_supported_links_vs_structure=entries.filter(e=>!['same_case','same_dossier','related_dossiers'].includes(pairs.find(p=>p.id===e.pair_id).baseline.relation)
          &&['same_case','same_dossier','related_dossiers'].includes(e.result.answers.relation.choice)
          &&['same_case','same_dossier','related_dossiers'].includes(r.reviews.find(x=>x.pair_id===e.pair_id).label)).map(e=>e.pair_id);
        if(mode==='selected')modes.hybrid=metrics(pairs,new Map(entries.map(e=>[e.pair_id,lib.propose(pairs.find(p=>p.id===e.pair_id),e.result).relation])),r.reviews);
      }
    }
    const reverse=ledger.entries.filter(e=>e.status==='ok'&&e.split===split&&e.mode==='reverse');
    modes.reverse={pairs:reverse.length,changes:reverse.filter(e=>ledger.entries.find(s=>s.pair_id===e.pair_id&&s.mode==='selected')?.result.answers.relation.choice!==e.result.answers.relation.choice).map(e=>e.pair_id)};
    output.splits[split]=modes;
  }
  const devBodies=new Set(d.pairs.filter(p=>p.split==='development').flatMap(p=>[contentFingerprint(p.a),contentFingerprint(p.b)]).filter(Boolean));
  const held=d.pairs.filter(p=>p.split==='holdout');
  const clean=held.filter(p=>![p.a,p.b].some(doc=>devBodies.has(contentFingerprint(doc))));
  output.leak_free_holdout={pairs:clean.length,excluded_pairs:held.filter(p=>!clean.includes(p)).map(p=>p.id),
    note:'Aanvullende controle op identieke volledige tekst zonder vergaderkop. Originele dataset/referenties niet aangepast.'};
  for(const mode of ['structure','short','selected']) {
    const predictions=mode==='structure'?new Map(clean.map(p=>[p.id,p.baseline.relation])):
      new Map(ledger.entries.filter(e=>e.status==='ok'&&e.split==='holdout'&&e.mode===mode).map(e=>[e.pair_id,e.result.answers.relation.choice]));
    if(clean.every(p=>predictions.has(p.id)))output.leak_free_holdout[mode]=metrics(clean,predictions,r.reviews);
  }
  output.limitation='Overeenstemming met vooraf vastgelegde Codex-beoordeling, geen onafhankelijk menselijk kwaliteitsbewijs of meting van betere tips. Controleparen zijn geselecteerd, niet representatief.';
  write('report.json',output);console.log(JSON.stringify(output,null,2));
}
async function main(argv=process.argv.slice(2)) {
  fs.mkdirSync(OUT,{recursive:true});const lock=path.join(budget.BASE,'experiment.lock');let fd;
  try{fd=fs.openSync(lock,'wx');}catch{throw Error('Andere Jev-proef actief/vergrendeld.');}
  try {
    // Geen gok of een eerder gereserveerd verzoek is verstuurd.
    if(fs.existsSync(path.join(OUT,'ledger.json.writing')))throw Error('Onvoltooide ledgerwrite vereist controle vóór nieuwe API-calls.');
    if(argv[0]==='prepare')await prepare();else if(argv[0]==='run')await run(argv[1],argv[2]);else if(argv[0]==='report')report();else throw Error('Gebruik: jev-study.cjs prepare | run selected/short/reverse development/holdout | report');
  } finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={splitPool,sample,metrics,frozen,contentFingerprint,main};
