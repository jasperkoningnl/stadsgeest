#!/usr/bin/env node
'use strict';

// Alleen-lezende zoekvraag voor de weger (verbandencheck, WEGER.md sectie 3a).
// Gebruik: node scraper/src/weger-query.cjs "<SELECT ...>" [breedte]
//          node scraper/src/weger-query.cjs pad\naar\vragen.sql [breedte]
// Meerdere statements scheiden met ';' plus een nieuwe regel.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const SCHRIJVEND = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i;

function isAlleenLezend(sql) {
  const s = sql.trim();
  if (!/^(select|with)\b/i.test(s)) return false;
  return !SCHRIJVEND.test(s.replace(/'[^']*'/g, "''"));
}

function splitStatements(text) {
  return text.split(/;\s*\r?\n/).map((s) => s.trim().replace(/;$/, '')).filter(Boolean);
}

// --lokaal: zoek in de kopie van lokale-kopie.cjs in plaats van in Turso.
// Dat kost geen reads; gebruik het voor sweeps en veel zoekopdrachten.
const KOPIE = process.env.STADSGEEST_KOPIE || path.join(__dirname, '..', 'tmp', 'kopie', 'stadsgeest.db');

async function main(argv = process.argv.slice(2)) {
  const lokaal = argv.includes('--lokaal');
  argv = argv.filter((a) => a !== '--lokaal');
  if (!argv[0] || argv[0] === '--help') {
    console.log('Gebruik: node scraper/src/weger-query.cjs [--lokaal] "<SELECT ...>" [breedte]');
    return;
  }
  const invoer = fs.existsSync(argv[0]) ? fs.readFileSync(argv[0], 'utf8') : argv[0];
  const breedte = Number(argv[1] || 160);
  if (lokaal && !fs.existsSync(KOPIE)) throw new Error(`geen lokale kopie op ${KOPIE}; maak die met scraper/src/lokale-kopie.cjs`);
  const db = lokaal
    ? createClient({ url: `file:${KOPIE.replace(/\\/g, '/')}` })
    : createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  if (lokaal) {
    const meta = await db.execute('SELECT gemaakt_op FROM _kopie_meta').catch(() => null);
    console.log(`(lokale kopie${meta?.rows[0] ? ` van ${meta.rows[0].gemaakt_op}` : ''})`);
  }
  try {
    for (const sql of splitStatements(invoer)) {
      if (!isAlleenLezend(sql)) {
        console.log(`GEWEIGERD (alleen SELECT/WITH zonder schrijfopdracht): ${sql.slice(0, 80)}`);
        continue;
      }
      try {
        const r = await db.execute(sql);
        console.log(`### ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
        for (const row of r.rows) {
          const velden = r.columns.map((c) => {
            let v = row[c];
            if (typeof v === 'string') {
              v = v.replace(/\s+/g, ' ');
              if (v.length > breedte) v = `${v.slice(0, breedte)}…`;
            }
            return `${c}=${v}`;
          });
          console.log(` ${velden.join(' | ')}`);
        }
        console.log(` (${r.rows.length} rijen)`);
      } catch (error) {
        console.log(`FOUT: ${error.message}`);
      }
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Zoekvraag mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { isAlleenLezend, splitStatements };
