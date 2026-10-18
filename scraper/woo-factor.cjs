#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createClient} = require('@libsql/client');
const {migrate} = require('./src/woo-factor-schema.cjs');
const {importAnalyses} = require('./src/woo-factor-store.cjs');

async function main(argv=process.argv.slice(2)) {
  const option = name => {const i=argv.indexOf(name);return i<0?null:argv[i+1];};
  const action=argv[0], local=option('--db'), file=option('--analyses');
  if (!['migreren','importeren'].includes(action) || (!local && !argv.includes('--productie'))) throw new Error('Gebruik migreren|importeren --db <lokaal bestand> of --productie; bij import --analyses <json>.');
  if (local && argv.includes('--productie')) throw new Error('Kies lokaal of productie.');
  if (local && (/^[a-z]+:\/\//i.test(local) || !fs.existsSync(local) || !fs.statSync(local).isFile())) throw new Error('Gebruik een bestaand lokaal databasebestand.');
  const {valideerWooAnalyse} = await import(pathToFileURL(path.resolve(__dirname,'../src/lib/dashboard/wooFactor.ts')).href);
  const analyses=action==='importeren'?JSON.parse(fs.readFileSync(file||'', 'utf8')):null;
  if (analyses && (!Array.isArray(analyses) || !analyses.length || analyses.length>50)) throw new Error('Importeer 1 tot 50 analyses.');
  if (analyses) analyses.forEach(valideerWooAnalyse);
  if (!local) require('dotenv').config({path:path.join(__dirname,'.env'),quiet:true});
  const db=createClient(local?{url:pathToFileURL(path.resolve(local)).href.replace(/^file:\/\//,'file:')}:{url:process.env.TURSO_URL,authToken:process.env.TURSO_AUTH_TOKEN});
  try {
    if (action==='migreren') { await migrate(db); console.log(JSON.stringify({migrated:true})); }
    else console.log(JSON.stringify(await importAnalyses(db,analyses,valideerWooAnalyse)));
  } finally {db.close();}
}
if (require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
