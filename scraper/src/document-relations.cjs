'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createClient } = require('@libsql/client');
const { hash } = require('./jev-experiment-lib.cjs');
const lib = require('./jev-followup-lib.cjs');
const SOURCE_IDS = [115,116,117,118,121,122,124,129,163,164,168,162];
const ARCHIVE = path.join(__dirname, '..', 'data', 'archive-research', 'archive.sqlite');
function eligible(d) {
  return SOURCE_IDS.includes(Number(d.source_id)) && d.doc_key === `item:${d.raw_item_id}`
    && typeof d.title === 'string' && d.title.trim().length > 0
    && /^https:\/\//.test(d.url || '') && String(d.body || '').length >= 200
    && !/inspreek|zienswijze|bezwaarschrift|persoonsgegevens|geheim|besloten|burgerbrief/i.test(d.title || '');
}
function words(d) {
  const title = (d.title || '').split(' — ').at(-1).toLowerCase()
    .replace(/partij voor de dieren|keihart voor amersfoort|amersfoort voor vrijheid|amersfoort2014|beter amersfoort|forum voor democratie|lokaal belangrijk|leusdenvooruit|christenunie|groenlinks|\b(?:pvda|d66|vvd|bpa|sp|pro|cda|denk|cu-sgp)\b/g,' ');
  const stop = new Set('gemeente gemeenteraad raad amersfoort leusden utrecht provincie raadsvoorstel raadsbesluit motie amendement schriftelijke vragen beantwoording antwoorden bijlage vastgesteld vaststelling aangenomen verworpen voor over inzake besluit informatie informatiebrief vergadering besluitenlijst commissie burgemeester wethouders college houdende regels omtrent subsidieregeling subsidie vaststellen kaderstellende subsidieplafond openstellen mogelijkheid indienen aanvraag inwoners politieke partijen'.split(' '));
  return [...new Set((title.match(/[\p{L}\d-]{4,}/gu) || []).filter(w => !stop.has(w) && !/^\d/.test(w)))];
}
function pairOf(a, b, stratum = 'overlap') {
  const id = hash([a.doc_key,b.doc_key].sort()).slice(0,16);
  return { id, a, b, stratum, baseline: lib.structuralBaseline(a,b) };
}
function candidatePairs(documents, anchors = documents, maxPerAnchor = 3) {
  const docs = documents.filter(eligible), meta = new Map(docs.map(d => [d.doc_key, lib.metadata(d)]));
  const tokens = new Map(docs.map(d => [d.doc_key, words(d)]));
  const index = new Map(), add = (key, d) => { if (!key) return; if (!index.has(key)) index.set(key, []); index.get(key).push(d); };
  for (const d of docs) {
    const m = meta.get(d.doc_key);
    add(m.agenda_key && 'agenda:' + m.agenda_key, d);
    add(m.authority && m.case_id && 'case:' + m.authority + ':' + m.case_id, d);
    for (const w of tokens.get(d.doc_key)) add('word:' + w, d);
  }
  const pairs = new Map();
  for (const a of anchors.filter(eligible)) {
    if (!meta.has(a.doc_key)) continue;
    const m = meta.get(a.doc_key), keys = [m.agenda_key && 'agenda:' + m.agenda_key,
      m.authority && m.case_id && 'case:' + m.authority + ':' + m.case_id, ...tokens.get(a.doc_key).map(w => 'word:' + w)];
    const possible = new Map();
    for (const key of keys.filter(Boolean)) for (const b of index.get(key) || []) if (b.doc_key !== a.doc_key) possible.set(b.doc_key,b);
    const ranked = [];
    for (const b of possible.values()) {
      const other = meta.get(b.doc_key);
      const shared = tokens.get(a.doc_key).filter(w => tokens.get(b.doc_key).includes(w));
      const strong = (m.authority && m.authority === other.authority && m.case_id && m.case_id === other.case_id)
        || (m.agenda_key && m.agenda_key === other.agenda_key);
      if (!strong && shared.length < 2) continue;
      const id = hash([a.doc_key,b.doc_key].sort()).slice(0,16);
      ranked.push({ a, b, id, stratum: strong ? 'structure' : 'overlap', score: (strong ? 100 : 0) + shared.length });
    }
    ranked.sort((x,y) => y.score-x.score || x.id.localeCompare(y.id));
    for (const entry of ranked.slice(0,maxPerAnchor)) {
      if (!pairs.has(entry.id)) pairs.set(entry.id,pairOf(entry.a,entry.b,entry.stratum));
    }
  }
  return [...pairs.values()].sort((a,b) => a.id.localeCompare(b.id));
}
async function readPool(file = ARCHIVE) {
  if (!fs.existsSync(file)) return [];
  const db = createClient({ url: 'file:' + path.resolve(file).replace(/\\/g,'/') });
  try {
    await db.execute('PRAGMA query_only=ON');
    return (await db.execute({ sql: `SELECT doc_key,raw_item_id,source_id,source_name,title,url,published_at,body,content_hash
      FROM archive_documents WHERE kind='raw_item' AND source_id IN (${SOURCE_IDS.map(() => '?')})
      ORDER BY remote_id DESC LIMIT 3500`, args: SOURCE_IDS })).rows.filter(eligible);
  } finally { db.close(); }
}
function preparation(pair) {
  const request = lib.requestFor(pair);
  return { pair_id: pair.id, relation: pair.baseline.relation, document_identity: pair.baseline.document,
    state: 'unreviewed', basis: pair.baseline.reason, confirmed: false, merge_allowed: false,
    review_required: true, review_policy: 'codex_content_review', review: null,
    documents: [pair.a,pair.b].map((d,i) => ({ raw_item_id: Number(d.raw_item_id), source_id: Number(d.source_id),
      title: lib.redact(d.title), url: d.url, published_at: d.published_at, source_hash: d.content_hash,
      metadata: request.state[i ? 'document_b' : 'document_a'].metadata,
      passages: request.state[i ? 'document_b' : 'document_a'].passages })),
    warning: 'Onbeoordeeld documentverband. Lees beide bronnen; gedeelde woorden of agendacontext bewijzen geen zaak of nieuwsfeit.' };
}
async function prepareWorkset(db, candidates, poolReader = readPool) {
  const bySignal = new Map();
  if (!candidates.length) return { bySignal, summary: { status: 'no_selected_signals', prepared: 0 } };
  const signalIds = candidates.map(c => c.signal.id);
  const links = (await db.execute({ sql: `SELECT si.signal_id,si.raw_item_id,COALESCE(p.parent_id,si.raw_item_id) AS anchor_id
    FROM signal_items si LEFT JOIN raw_item_parts p ON p.part_id=si.raw_item_id
    WHERE si.signal_id IN (${signalIds.map(() => '?')})`, args: signalIds })).rows;
  const archivedPool = await poolReader();
  const anchorIds = new Set(links.map(r => Number(r.anchor_id)));
  const limitedIds = [...anchorIds].sort((a,b)=>b-a).slice(0,150);
  if (!limitedIds.length) return { bySignal, summary:{ status:'no_anchor_items',prepared:0 } };
  // Nieuwe signaalstukken kunnen nog ontbreken in de wekelijkse archiefsync.
  const current = (await db.execute({ sql:`SELECT r.id AS raw_item_id,r.title,r.source_id,s.name AS source_name,
    r.external_url AS url,r.published_at,COALESCE(r.full_text,r.content,r.summary,'') AS body
    FROM raw_items r JOIN sources s ON s.id=r.source_id WHERE r.id IN (${limitedIds.map(()=>'?')})`,args:limitedIds })).rows;
  const { sourceHash } = require('./weger-jev.cjs');
  const anchors = current.map(d=>({...d,doc_key:`item:${d.raw_item_id}`,content_hash:sourceHash(d.title,d.body)})).filter(eligible);
  const replaced = new Set(anchors.map(d=>d.doc_key));
  const pool = [...anchors,...archivedPool.filter(d=>!replaced.has(d.doc_key))];
  const pairs = candidatePairs(pool,anchors,3).slice(0,150);
  // Hergebruik de alleen-lezende actualiteitscontrole en exacte signaalkoppeling.
  const { loadJevContext } = require('./weger-jev.cjs');
  const checked = await loadJevContext(db,{ status:'prepared', proposals:pairs.map(preparation) });
  for (const c of candidates) bySignal.set(c.signal.id, checked.bySignal.get(c.signal.id) || []);
  return { bySignal, summary: { status:'prepared', prepared:pairs.length,
    selected_anchor_items:anchorIds.size, eligible_current_anchor_items:anchors.length,
    anchor_items_omitted:Math.max(0,anchorIds.size-limitedIds.length),archive_documents:archivedPool.length,
    fresh:checked.summary.fresh_candidates, stale:checked.summary.stale_candidates,
    offered:candidates.reduce((n,c) => n+(bySignal.get(c.signal.id)?.length || 0),0), paid_api_calls:0 } };
}
module.exports = { SOURCE_IDS, eligible, words, pairOf, candidatePairs, readPool, preparation, prepareWorkset };
