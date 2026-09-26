#!/usr/bin/env node
'use strict';

// Maakt een lokale SQLite-kopie van de Turso-database, voor analyse en
// verkenning zonder leesquotum. Eén kopie kost ongeveer één read per rij in de
// database; daarna is elke query op de kopie gratis. Zie docs/DATABASE-LEZEN.md.
//
// Gebruik:
//   node scraper/src/lokale-kopie.cjs [--uit pad.db] [--alleen t1,t2] [--zonder t1,t2]
// Standaard: scraper/tmp/kopie/stadsgeest.db (valt onder .gitignore).
// Zoeken op de kopie: node scraper/src/weger-query.cjs --lokaal "<SELECT ...>"

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const STANDAARD = path.join(__dirname, '..', 'tmp', 'kopie', 'stadsgeest.db');
const PAGINA = 1000;

function optie(argv, naam) {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : undefined;
}

function lijst(waarde) {
  return waarde ? new Set(waarde.split(',').map((s) => s.trim()).filter(Boolean)) : null;
}

function waarde(v) {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : v;
}

async function kopieerTabel(bron, doel, naam, zonderRowid) {
  const q = `"${naam.replace(/"/g, '""')}"`;
  let rijen = 0;
  let laatste = null;
  for (;;) {
    // Pagineren op rowid gebruikt de primaire sleutel (SEARCH), geen OFFSET-scan.
    const r = zonderRowid
      ? await bron.execute(`SELECT * FROM ${q}`)
      : await bron.execute({
        sql: `SELECT rowid AS __rid, * FROM ${q} ${laatste === null ? '' : 'WHERE rowid > ?'} ORDER BY rowid LIMIT ${PAGINA}`,
        args: laatste === null ? [] : [laatste],
      });
    if (r.rows.length === 0) break;
    const kolommen = r.columns.filter((c) => c !== '__rid');
    const insert = `INSERT INTO ${q} (${kolommen.map((c) => `"${c}"`).join(', ')}) VALUES (${kolommen.map(() => '?').join(', ')})`;
    await doel.batch(r.rows.map((row) => ({ sql: insert, args: kolommen.map((c) => waarde(row[c])) })), 'write');
    rijen += r.rows.length;
    if (zonderRowid || r.rows.length < PAGINA) break;
    laatste = r.rows[r.rows.length - 1].__rid;
  }
  return rijen;
}

async function main(argv = process.argv.slice(2)) {
  const uit = path.resolve(optie(argv, '--uit') || STANDAARD);
  const alleen = lijst(optie(argv, '--alleen'));
  const zonder = lijst(optie(argv, '--zonder'));
  fs.mkdirSync(path.dirname(uit), { recursive: true });
  const tijdelijk = `${uit}.bezig`;
  for (const f of [tijdelijk, `${tijdelijk}-wal`, `${tijdelijk}-shm`]) fs.rmSync(f, { force: true });

  const bron = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const doel = createClient({ url: `file:${tijdelijk.replace(/\\/g, '/')}` });
  const begin = Date.now();
  let totaal = 0;
  try {
    // Tabellen komen op alfabet binnen; verwijzingen naar nog lege tabellen mogen.
    await doel.execute('PRAGMA foreign_keys = OFF');
    // sqlite_master kost geen reads.
    const schema = (await bron.execute(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name",
    )).rows;
    const tabellen = schema.filter((s) => s.type === 'table' && !/^CREATE VIRTUAL/i.test(s.sql)
      && (!alleen || alleen.has(s.name)) && !(zonder && zonder.has(s.name)));
    for (const t of tabellen) {
      await doel.execute(t.sql);
      const n = await kopieerTabel(bron, doel, t.name, /WITHOUT\s+ROWID/i.test(t.sql));
      totaal += n;
      console.log(`${t.name}: ${n}`);
    }
    const namen = new Set(tabellen.map((t) => t.name));
    for (const s of schema.filter((x) => x.type === 'index' && namen.has(x.tbl_name))) await doel.execute(s.sql);
    await doel.execute('CREATE TABLE _kopie_meta (gemaakt_op TEXT, rijen INTEGER)');
    await doel.execute({ sql: 'INSERT INTO _kopie_meta VALUES (?, ?)', args: [new Date().toISOString(), totaal] });
  } finally {
    bron.close();
    doel.close();
  }
  for (const f of [uit, `${uit}-wal`, `${uit}-shm`]) fs.rmSync(f, { force: true });
  // Windows houdt het bestand na close() soms nog even vast.
  for (let poging = 1; ; poging++) {
    try { fs.renameSync(tijdelijk, uit); break; } catch (e) {
      if (!['EBUSY', 'EPERM'].includes(e.code) || poging >= 20) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(`Klaar: ${totaal.toLocaleString('nl-NL')} rijen in ${Math.round((Date.now() - begin) / 1000)} s naar ${uit}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Kopie mislukt: ${e.message}`); process.exitCode = 1; });
}
