#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createClient} = require('@libsql/client');

const DOCUMENTHINT = /\b(onderzoek|analyse|advies|evaluatie|rapportage|terugvordering|verantwoording|onderbouwing)\b/i;

function selecteerVermoedens(facts, max=20) {
  const seen=new Set(), result=[];
  for (const f of facts) {
    const text=`${f.titel||''} ${f.details||''}`;
    if (!DOCUMENTHINT.test(text) || !/^https?:\/\//.test(f.primaire_bron_url||'')) continue;
    const key=`${f.dossier_id}:${f.primaire_bron_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({dossier_slug:f.slug,dossier_naam:f.naam,feit_id:Number(f.id),titel:f.titel,
      bron_url:f.primaire_bron_url,aanleiding:f.details,
      status:'vermoeden_te_onderzoeken',
      instructie:'Een documentverwijzing is nog geen informatieleemte. Stel een concrete onderzoeksvraag vast, lees de oorspronkelijke bron en voer beide controletakken uit.'});
    if(result.length>=max) break;
  }
  return result;
}

async function main(argv=process.argv.slice(2)) {
  const option=name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1];};
  const file=option('--kopie'), output=option('--uit'), slug=option('--dossier');
  if(!file||!output||/^[a-z]+:\/\//i.test(file)||!fs.existsSync(file)||!fs.statSync(file).isFile()) throw new Error('Gebruik --kopie <bestaande lokale db> --uit <json> [--dossier <slug>].');
  if(path.resolve(file)===path.resolve(output)) throw new Error('Uitvoer mag de kopie niet overschrijven.');
  const db=createClient({url:pathToFileURL(path.resolve(file)).href.replace(/^file:\/\//,'file:')});
  try {
    await db.execute('PRAGMA query_only=ON');
    const sql=`SELECT f.id,f.dossier_id,f.titel,f.details,f.primaire_bron_url,d.slug,d.naam
      FROM dossier_facts f JOIN dossiers d ON d.id=f.dossier_id ${slug?'WHERE d.slug=?':''}
      ORDER BY f.created_at DESC,f.id DESC`;
    const args=slug?[slug]:[];
    const plans=(await db.execute({sql:`EXPLAIN QUERY PLAN ${sql}`,args})).rows;
    const facts=(await db.execute({sql,args})).rows;
    const meta=(await db.execute('SELECT gemaakt_op FROM _kopie_meta')).rows[0];
    const vermoedens=selecteerVermoedens(facts);
    const urls=[...new Set(vermoedens.map(v=>v.bron_url))];
    const docs=urls.length?(await db.execute({sql:`SELECT id,external_url,title,
      length(full_text) volledige_tekens,length(content) korte_tekens,fulltext_fetched_at
      FROM raw_items WHERE external_url IN (${urls.map(()=>'?').join(',')})`,args:urls})).rows:[];
    const ids=docs.map(d=>Number(d.id));
    const attachments=ids.length?(await db.execute({sql:`SELECT raw_item_id,titel,url,status,tekens,tekstbron,ocr_fout
      FROM raw_item_attachments WHERE raw_item_id IN (${ids.map(()=>'?').join(',')})`,args:ids})).rows:[];
    const parts=ids.length?(await db.execute({sql:`SELECT parent_id,part_id,deel FROM raw_item_parts WHERE parent_id IN (${ids.map(()=>'?').join(',')})`,args:ids})).rows:[];
    const report={gemaakt_op:new Date().toISOString(),kopie_van:meta?.gemaakt_op,vermoedens,bronrecords:docs,bijlagen:attachments,delen:parts,queryplannen:plans,
      beperking:'Alleen voorbereiding op lokale kopie, maximaal twintig vermoedens. Exacte URL-matches kunnen documentvarianten missen. Geen negatieve conclusie uit een ontbrekende match. Online onderzoek en beoordeling ontbreken nog; niets is goedgekeurd of verzonden.'};
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({vermoedens:vermoedens.length,uit:output,productie_reads:0}));
  } finally {db.close();}
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={selecteerVermoedens,main};
