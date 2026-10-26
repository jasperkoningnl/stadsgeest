#!/usr/bin/env node
'use strict';

// Gedeeld onderzoeksgeheugen. Brede selectie uitsluitend op een lokale kopie;
// productiewrites zijn begrensd, gevalideerd, transactioneel en herhaalveilig.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');
const { validatePlan: validateWeger, preflight, writePlan } = require('./weger-apply.cjs');
const { validateScore } = require('./weger-score.cjs');

const ACTOR = 'codex-onderzoek';
const STATES = ['open', 'researching', 'waiting', 'closed', 'tipped'];
const TERMINAL = ['closed', 'tipped'];
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS research_cases (
    case_key TEXT PRIMARY KEY, version INTEGER NOT NULL,
    question TEXT NOT NULL, signal_ids TEXT NOT NULL, source_urls TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','researching','waiting','closed','tipped')),
    findings TEXT NOT NULL, next_action TEXT NOT NULL, review_after TEXT,
    tip_id INTEGER REFERENCES tips(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_research_due ON research_cases(status,review_after)',
  `CREATE TABLE IF NOT EXISTS research_runs (
    request_id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL, result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS research_case_events (
    id INTEGER PRIMARY KEY, case_key TEXT NOT NULL REFERENCES research_cases(case_key),
    version INTEGER NOT NULL, request_id TEXT NOT NULL REFERENCES research_runs(request_id),
    actor TEXT NOT NULL, payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(case_key,version)
  )`,
];
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const isUrl = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
const validId = value => Number.isInteger(value) && value > 0;
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const utcTime = value => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value || '') ? value : `${value}Z`);

function validate(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['Plan moet een object zijn.'];
  for (const key of Object.keys(plan)) if (!['request_id','cases','weger','tip_updates','discoveries'].includes(key)) errors.push(`Onbekend planveld ${key}.`);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(plan.request_id || '')) errors.push('request_id moet een unieke stabiele sleutel zijn (8–120 tekens).');
  if (!Array.isArray(plan.cases) || !plan.cases.length || plan.cases.length > 10) errors.push('cases vereist 1–10 vragen.');
  const keys = new Set();
  for (const c of plan.cases || []) {
    if (!c || typeof c !== 'object') { errors.push('Ongeldige case.'); continue; }
    for (const key of Object.keys(c)) if (!['case_key','expected_version','question','signal_ids','source_urls','status','findings','next_action','review_after','tip_id','new_tip_index'].includes(key)) errors.push(`Onbekend caseveld ${key}.`);
    if (!/^[a-z0-9][a-z0-9-]{5,119}$/.test(c.case_key || '') || keys.has(c.case_key)) errors.push('case_key moet uniek en stabiel zijn (6–120 tekens).');
    keys.add(c.case_key);
    if (!Number.isInteger(c.expected_version) || c.expected_version < 0) errors.push('expected_version ontbreekt of is ongeldig.');
    if (!STATES.includes(c.status)) errors.push('Ongeldige onderzoeksstatus.');
    if (!nonempty(c.question) || !nonempty(c.findings) || !nonempty(c.next_action)) errors.push('Vraag, bevindingen en concrete vervolgstap/afsluitreden zijn verplicht.');
    if (!Array.isArray(c.signal_ids) || c.signal_ids.some(id => !validId(id)) || new Set(c.signal_ids).size !== c.signal_ids.length) errors.push('signal_ids moet unieke geldige IDs bevatten (leeg mag bij verkenning).');
    if (!Array.isArray(c.source_urls) || !c.source_urls.length || c.source_urls.some(url => !isUrl(url))) errors.push('Controleerbare bron-URLs zijn verplicht.');
    if (!TERMINAL.includes(c.status) && !isDate(c.review_after)) errors.push('Open onderzoek vereist review_after als UTC-datum.');
    if (c.review_after != null && !isDate(c.review_after)) errors.push('Ongeldige review_after.');
    if (c.tip_id != null && !validId(c.tip_id)) errors.push('Ongeldig tip_id.');
    if (c.new_tip_index != null && (!Number.isInteger(c.new_tip_index) || !plan.weger?.tips?.[c.new_tip_index])) errors.push('Ongeldige new_tip_index.');
    if (c.new_tip_index != null && c.status !== 'tipped') errors.push('Een nieuwe tip vereist status tipped.');
    if (c.new_tip_index != null && plan.weger?.tips?.[c.new_tip_index]?.signals?.some(link=>!c.signal_ids?.includes(link.id))) errors.push('Tipsignalen moeten bij de gekoppelde onderzoekscase horen.');
    if (c.tip_id != null && c.new_tip_index != null) errors.push('Gebruik tip_id of new_tip_index, niet beide.');
    if (c.status === 'tipped' && c.tip_id == null && c.new_tip_index == null) errors.push('tipped vereist een bestaande of in dit plan gemaakte tip.');
  }
  const w = plan.weger || {};
  if (w && (typeof w !== 'object' || Array.isArray(w))) errors.push('weger moet een object zijn.');
  errors.push(...validateWeger(w));
  if (w.run || w.tips?.some(t => t.supertip)) errors.push('Onderzoek mag geen supertip maken.');
  for (const t of w.tips || []) if (!plan.cases?.some(c => c.new_tip_index === w.tips.indexOf(t))) errors.push('Iedere nieuwe tip vereist een gekoppelde onderzoekscase.');
  if (plan.tip_updates !== undefined && !Array.isArray(plan.tip_updates)) errors.push('tip_updates moet een array zijn.');
  if ((plan.tip_updates?.length||0)>3) errors.push('Hoogstens drie tipaanvullingen per plan.');
  const updatedIds = new Set();
  for (const u of plan.tip_updates || []) {
    if (!u || typeof u !== 'object') { errors.push('Ongeldige tipaanvulling.'); continue; }
    for (const key of Object.keys(u)) if (!['tip_id','expected_hash','reason','score','weging','additions','sources'].includes(key)) errors.push(`Onbekend aanvullingsveld ${key}.`);
    if (!validId(u.tip_id) || updatedIds.has(u.tip_id)) errors.push('Tipaanvulling vereist een uniek tip_id.');
    updatedIds.add(u.tip_id);
    if (!/^[a-f0-9]{64}$/.test(u.expected_hash || '')) errors.push('Tipaanvulling vereist expected_hash uit de actuele tip.');
    if (!nonempty(u.reason)) errors.push('Tipaanvulling vereist een concrete nieuwe bijdrage.');
    if (!u.weging || typeof u.weging !== 'object' || Array.isArray(u.weging) || !Number.isInteger(u.score)) errors.push('Aanvulling vereist een volledige nieuwe weging en score.');
    errors.push(...validateScore(u, 'tip_updates'));
    const allowed = ['WAT WE WETEN','HOE DIT IS GEVONDEN','WAT WE NIET WETEN','WAT HIER NIET IN MAG','ELDERS GEBRACHT'];
    if (!u.additions || typeof u.additions !== 'object' || Array.isArray(u.additions) || !Object.keys(u.additions).length) errors.push('Aanvulling vereist briefingblokken.');
    for (const [heading, body] of Object.entries(u.additions || {})) {
      if (!allowed.includes(heading) || !nonempty(body)) errors.push('Ongeldig aanvullingsblok.');
      if (/^(?:WAT WE |ELDERS |HOE DIT |BETROKKEN |CONTEXT EN )/m.test(body)) errors.push('Aanvullingsinhoud mag geen nieuwe briefingkop invoegen.');
    }
    if (!Array.isArray(u.sources) || !u.sources.length || u.sources.some(s => !nonempty(s.naam) || !isUrl(s.url) || !nonempty(s.datum) || !nonempty(s.bijdrage))) errors.push('Aanvulling vereist gedateerde bronnen met bijdrage.');
    if (!u.sources?.some(s => [1,2].includes(s.tier) && s.spiegel !== true)) errors.push('Aanvulling mist een dragende bron.');
    if (!plan.cases?.some(c => c.tip_id === u.tip_id)) errors.push('Aanvulling vereist een gekoppelde onderzoekscase.');
  }
  if (plan.discoveries !== undefined && (!Array.isArray(plan.discoveries) || plan.discoveries.length>1)) errors.push('Hoogstens één zelfstandige ontdekking per plan.');
  for (const discovery of plan.discoveries || []) {
    if (!plan.cases?.some(c=>c.case_key===discovery.case_key && c.status==='researching' && c.signal_ids?.length===0)) errors.push('Ontdekking vereist een onderzoekscase zonder bestaand signaal.');
    if (!nonempty(discovery.title)||!nonempty(discovery.summary)||!Array.isArray(discovery.raw_item_ids)||!discovery.raw_item_ids.length||discovery.raw_item_ids.length>20||discovery.raw_item_ids.some(id=>!validId(id))||new Set(discovery.raw_item_ids).size!==discovery.raw_item_ids.length) errors.push('Ontdekking vereist titel, afgebakende bevinding en 1–20 unieke bestaande bronitems.');
    if ((w.tips?.length||0)>0) errors.push('Leg een nieuw onderzoekssignaal eerst vast; maak daarna met de echte ID de tip in dezelfde run.');
  }
  return errors;
}

async function init(db) {
  for (const sql of SCHEMA) await db.execute(sql);
}

function tipHash(tip) {
  return hash([tip.briefing, tip.herkomst, tip.updated_at, tip.status]);
}

function appendBlocks(briefing, additions) {
  let result = briefing;
  for (const [heading, body] of Object.entries(additions)) {
    const pattern = new RegExp(`(^${heading}[ \\t]*\\r?\\n)([\\s\\S]*?)(?=\\n(?:WAT WE WETEN|CONTEXT EN ACHTERGROND|BETROKKEN PERSONEN EN ORGANISATIES|HOE DIT IS GEVONDEN|WAT WE NIET WETEN|WAT HIER NIET IN MAG|ELDERS GEBRACHT)[ \\t]*(?:\\r?\\n|$)|(?![\\s\\S]))`, 'm');
    if (!pattern.test(result)) throw new Error(`Bestaande briefing mist ${heading}; handmatige correctie vereist.`);
    // Callback voorkomt interpretatie van $-tekens in bronpassages.
    result = result.replace(pattern, (_all, start, current) => `${start}${current.trimEnd()}\n\n${body.trim()}\n`);
  }
  return result;
}

async function rowsByIds(db, table, ids, columns = 'id') {
  if (!ids.length) return [];
  return (await db.execute({sql:`SELECT ${columns} FROM ${table} WHERE id IN (${ids.map(()=>'?').join(',')})`,args:ids})).rows;
}

async function check(db, plan) {
  const errors = validate(plan);
  if (errors.length) throw new Error(errors.join('\n'));
  const prior = (await db.execute({sql:'SELECT plan_hash,result FROM research_runs WHERE request_id=?',args:[plan.request_id]})).rows[0];
  if (prior) {
    if (prior.plan_hash !== hash(plan)) throw new Error('request_id is eerder gebruikt voor een ander plan.');
    return {replayed:JSON.parse(prior.result)};
  }
  for (const c of plan.cases) {
    const current = (await db.execute({sql:'SELECT version FROM research_cases WHERE case_key=?',args:[c.case_key]})).rows[0];
    if (Number(current?.version || 0) !== c.expected_version) throw new Error(`Versieconflict ${c.case_key}; lees de actuele case.`);
    const found = await rowsByIds(db,'signals',c.signal_ids);
    if (found.length !== c.signal_ids.length) throw new Error(`Onbekend signaal bij ${c.case_key}.`);
    if (c.tip_id != null && !(await rowsByIds(db,'tips',[c.tip_id])).length) throw new Error('Onbekende bestaande tip.');
  }
  const checked = await preflight(db, plan.weger || {});
  if (checked.errors.length) throw new Error(checked.errors.join('\n'));
  const updates = [];
  for (const u of plan.tip_updates || []) {
    const tip = (await rowsByIds(db,'tips',[u.tip_id],'*'))[0];
    if (!tip || !['wachtrij','goedgekeurd','in_behandeling'].includes(tip.status)) throw new Error('Alleen een actieve tip mag worden aangevuld; redactieoordelen blijven behouden.');
    if (tipHash(tip) !== u.expected_hash) throw new Error('Tip is inmiddels gewijzigd; lees de actuele tip.');
    const briefing = appendBlocks(tip.briefing,u.additions);
    const existingSources = JSON.parse(tip.herkomst || '[]');
    const urls = new Set(existingSources.map(s=>s.url));
    const herkomst = JSON.stringify([...existingSources,...u.sources.filter(s=>!urls.has(s.url))]);
    updates.push({u,tip,briefing,herkomst});
  }
  for (const discovery of plan.discoveries || []) {
    const found=await rowsByIds(db,'raw_items',discovery.raw_item_ids,'id,source_id');
    if(found.length!==discovery.raw_item_ids.length) throw new Error('Ontdekking verwijst naar ontbrekend bronitem.');
    const sources=await rowsByIds(db,'sources',[...new Set(found.map(r=>Number(r.source_id)))],'id,tier,bronrol');
    if(!sources.some(s=>[1,2].includes(Number(s.tier))&&s.bronrol!=='spiegel')) throw new Error('Een onderzoekssignaal vereist een oorspronkelijke bron.');
    const linked=(await db.execute({sql:`SELECT signal_id FROM signal_items WHERE raw_item_id IN (${discovery.raw_item_ids.map(()=>'?').join(',')}) LIMIT 1`,args:discovery.raw_item_ids})).rows;
    if(linked.length) throw new Error(`Bronitem heeft al signaal ${linked[0].signal_id}; controleer dat signaal eerst en gebruik de passende bestaande identiteit.`);
  }
  return {checked,updates};
}

async function save(db, plan, apply = false) {
  // Ook de dry-run gebruikt een alleen-lezen transactie: consistente voorcontrole.
  const tx = await db.transaction(apply ? 'write' : 'read');
  try {
    const checked = await check(tx,plan);
    if (checked.replayed) { await tx.rollback(); return {...checked.replayed,mode:'already_applied'}; }
    const result = {mode:apply?'applied':'dry-run',valid:true,cases:plan.cases.length,tips:plan.weger?.tips?.length||0,tip_updates:checked.updates.length,dossier_facts:plan.weger?.dossier_facts?.length||0};
    if (!apply) { await tx.rollback(); return result; }
    const tipIds = await writePlan(tx,plan.weger || {},checked.checked.statusBySignal,{actor:ACTOR});
    result.tip_ids = tipIds;
    const discovered = new Map();
    for (const discovery of plan.discoveries || []) {
      const inserted=await tx.execute({sql:"INSERT INTO signals (title,summary,status,confirmations,threshold,provenance) VALUES (?,?,'watching',1,1,?)",args:[discovery.title,discovery.summary,JSON.stringify({actor:ACTOR,request_id:plan.request_id,case_key:discovery.case_key,raw_item_ids:discovery.raw_item_ids})]});
      const id=Number(inserted.lastInsertRowid);
      discovered.set(discovery.case_key,id);
      for(const rawId of discovery.raw_item_ids) await tx.execute({sql:'INSERT INTO signal_items (signal_id,raw_item_id) VALUES (?,?)',args:[id,rawId]});
      await tx.execute({sql:"INSERT INTO signal_events (signal_id,actor,event_type,status_to,reason,payload) VALUES (?,?,'research_discovery','watching',?,?)",args:[id,ACTOR,discovery.summary,JSON.stringify({request_id:plan.request_id,case_key:discovery.case_key})]});
    }
    result.created_signal_ids = Object.fromEntries(discovered);
    await tx.execute({sql:'INSERT INTO research_runs (request_id,plan_hash,result) VALUES (?,?,?)',args:[plan.request_id,hash(plan),JSON.stringify(result)]});
    for (const {u,tip,briefing,herkomst} of checked.updates) {
      await tx.execute({sql:"UPDATE tips SET briefing=?,herkomst=?,updated_at=datetime('now') WHERE id=?",args:[briefing,herkomst,u.tip_id]});
      await tx.execute({sql:`INSERT INTO tip_events (tip_id,actor,event_type,status_from,status_to,reason,payload) VALUES (?,?,'research_addition',?,?,?,?)`,args:[u.tip_id,ACTOR,tip.status,tip.status,u.reason,JSON.stringify({request_id:plan.request_id,previous_briefing:tip.briefing,previous_herkomst:tip.herkomst,additions:u.additions,sources:u.sources,weging:u.weging,score:u.score})]});
    }
    for (const c of plan.cases) {
      const tipId = c.new_tip_index != null ? tipIds[c.new_tip_index] : c.tip_id ?? null;
      const signalIds=discovered.has(c.case_key)?[discovered.get(c.case_key)]:c.signal_ids;
      const args = [c.case_key,c.expected_version+1,c.question,JSON.stringify(signalIds),JSON.stringify(c.source_urls),c.status,c.findings,c.next_action,c.review_after??null,tipId];
      await tx.execute({sql:`INSERT INTO research_cases (case_key,version,question,signal_ids,source_urls,status,findings,next_action,review_after,tip_id) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(case_key) DO UPDATE SET version=excluded.version,question=excluded.question,signal_ids=excluded.signal_ids,source_urls=excluded.source_urls,status=excluded.status,findings=excluded.findings,next_action=excluded.next_action,review_after=excluded.review_after,tip_id=excluded.tip_id,updated_at=datetime('now')`,args});
      await tx.execute({sql:'INSERT INTO research_case_events (case_key,version,request_id,actor,payload) VALUES (?,?,?,?,?)',args:[c.case_key,c.expected_version+1,plan.request_id,ACTOR,JSON.stringify({...c,signal_ids:signalIds,tip_id:tipId})]});
    }
    await tx.commit();
    return result;
  } catch (error) { await tx.rollback().catch(()=>{}); throw error; }
}

function parseCase(row) {
  return {...row,signal_ids:JSON.parse(row.signal_ids),source_urls:JSON.parse(row.source_urls)};
}

async function workset(db, {limit=100,now=new Date().toISOString()} = {}) {
  const allCases = (await db.execute('SELECT * FROM research_cases ORDER BY updated_at DESC')).rows.map(parseCase);
  const due = allCases.filter(c=>!TERMINAL.includes(c.status) && (!c.review_after || Date.parse(c.review_after)<=Date.parse(now)));
  // Lokaal: ook eerder gelezen watching-signalen; geen last_seen > reviewed-poort.
  const signals = (await db.execute({sql:`SELECT s.id,s.title,s.summary,s.last_seen_at,e.reason,e.created_at AS reviewed_at
    FROM signals s JOIN signal_events e ON e.id=(SELECT max(e2.id) FROM signal_events e2 WHERE e2.signal_id=s.id AND e2.actor='weger' AND e2.event_type='reviewed')
    WHERE s.status='watching' AND (e.created_at>=datetime(?,'-30 days') OR datetime(s.last_seen_at)>=datetime(?,'-30 days'))
    ORDER BY e.created_at DESC,s.id DESC`,args:[now,now]})).rows;
  const candidates = signals.filter(s=>!allCases.some(c=>c.signal_ids.includes(Number(s.id)) && utcTime(s.last_seen_at)<=utcTime(c.updated_at)));
  const selected = candidates.slice(0,limit);
  const ids = [...new Set([...selected.map(s=>Number(s.id)),...due.flatMap(c=>c.signal_ids)])];
  let items = [];
  if (ids.length) items = (await db.execute({sql:`SELECT si.signal_id,r.id,r.title,r.external_url,r.published_at,r.scraped_at,s.name AS source_name,s.tier,s.bronrol,
    substr(CASE WHEN length(coalesce(r.full_text,''))>length(coalesce(r.content,'')) THEN r.full_text ELSE coalesce(r.content,r.summary,'') END,1,4000) AS excerpt
    FROM signal_items si JOIN raw_items r ON r.id=si.raw_item_id JOIN sources s ON s.id=r.source_id
    WHERE si.signal_id IN (${ids.map(()=>'?').join(',')}) ORDER BY si.signal_id,r.id DESC`,args:ids})).rows;
  const tips = (await db.execute('SELECT id,titel,kern,status,briefing,herkomst,updated_at FROM tips ORDER BY id DESC')).rows;
  const tipLinks=(await db.execute('SELECT tip_id,signal_id FROM tip_signals')).rows;
  return {generated_at:now,cases:allCases,due_cases:due,candidates:selected.map(s=>({...s,tip_ids:tipLinks.filter(l=>Number(l.signal_id)===Number(s.id)).map(l=>Number(l.tip_id))})),candidate_total:candidates.length,candidates_omitted:Math.max(0,candidates.length-selected.length),items,
    existing_tips:tips.map(t=>({id:t.id,titel:t.titel,kern:t.kern,status:t.status,expected_hash:tipHash(t)})),
    warning:'Kandidaten zijn leesaanwijzingen. Onderzoek en prioriteer inhoudelijk; nul tips is geldig. Lees volledige dragende stukken en zoek daarnaast één zelfstandig spoor.'};
}

async function main(argv=process.argv.slice(2)) {
  const [command,file] = argv;
  if (!['init','save','workset'].includes(command)) { console.log('Gebruik: onderzoek.cjs init [--apply] | save plan.json [--apply] [--db kopie.db] | workset kopie.db [--limit 100]'); return; }
  const value = name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1];};
  const local = command==='workset'?file:value('--db');
  if (local && !fs.existsSync(local)) throw new Error('Lokale database ontbreekt.');
  require('dotenv').config({path:path.join(__dirname,'..','.env')});
  const db=createClient(local?{url:'file:'+path.resolve(local).replace(/\\/g,'/')}:{url:process.env.TURSO_URL,authToken:process.env.TURSO_AUTH_TOKEN});
  try {
    if (command==='init') {
      if (argv.includes('--apply')) await init(db);
      console.log(JSON.stringify({mode:argv.includes('--apply')?'applied':'dry-run',schema:SCHEMA}));
    } else if (command==='save') {
      console.log(JSON.stringify(await save(db,JSON.parse(fs.readFileSync(file,'utf8')),argv.includes('--apply')),null,2));
    } else {
      const limit=Number(value('--limit')||100);
      if (!Number.isInteger(limit)||limit<1||limit>500) throw new Error('limit moet 1–500 zijn.');
      console.log(JSON.stringify(await workset(db,{limit}),null,2));
    }
  } finally { db.close(); }
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={SCHEMA,hash,tipHash,validate,init,appendBlocks,check,save,workset};
