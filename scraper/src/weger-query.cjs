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

async function main(argv = process.argv.slice(2)) {
  if (!argv[0] || argv[0] === '--help') {
    console.log('Gebruik: node scraper/src/weger-query.cjs "<SELECT ...>" [breedte]');
    return;
  }
  const invoer = fs.existsSync(argv[0]) ? fs.readFileSync(argv[0], 'utf8') : argv[0];
  const breedte = Number(argv[1] || 160);
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
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
