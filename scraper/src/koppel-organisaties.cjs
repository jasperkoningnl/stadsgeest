#!/usr/bin/env node
'use strict';

// Organisatiekoppeling over bronnen heen (docs/KOPPELING.md), dagelijks na de
// adreskoppeling. Node doet alle I/O; koppel/splink_worker.py rekent alleen.
//
// 1. Organisaties uit registers, toezicht- en geldbronnen laden (koppel/bronnen.cjs).
// 2. Normaliseren en per bron samenvoegen (koppel/normaliseer.cjs).
// 3. Splink geeft paren met een kans (vaste gewichten).
// 4. Clusteren: paren >= 0,6 plus harde sleutels KvK/RSIN/LEI; twee verschillende
//    KvK-nummers komen nooit in één cluster.
// 5. Wegschrijven naar org_link_records (alleen de laatste run) en org_clusters
//    (clusters met >= 2 bronnen, met first_seen_at voor "nieuw verband").
//
// Schrijft niets in entities, kg_* of signals. Dezelfde invoer levert dezelfde
// uitvoer; bij een ongewijzigde invoerhash slaat de run het rekenen over.
//
// Gebruik: node src/koppel-organisaties.cjs [--dry-run] [--force]

const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { LOADERS } = require('./koppel/bronnen.cjs');
const { maakRecord, voegSamen, clusteren } = require('./koppel/normaliseer.cjs');

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const DREMPEL_CLUSTER = 0.6;
const WORKER = path.join(__dirname, 'koppel', 'splink_worker.py');
// Eigen venv naast die van NER (scraper\.koppel-venv, genegeerd door git).
const PYTHON = process.env.KOPPEL_PYTHON || path.join(__dirname, '..', '.koppel-venv', 'Scripts', 'python.exe');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS org_link_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT,
     status TEXT NOT NULL DEFAULT 'bezig', records INTEGER, paren INTEGER, clusters INTEGER, kruisclusters INTEGER,
     geweigerd INTEGER, model_version TEXT, input_hash TEXT, per_bron TEXT)`,
  `CREATE TABLE IF NOT EXISTS org_link_records (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES org_link_runs(id),
     cluster_key TEXT NOT NULL, bron TEXT NOT NULL, rol TEXT NOT NULL, bron_ref TEXT, naam TEXT NOT NULL,
     naam_norm TEXT NOT NULL, kvk TEXT, rsin TEXT, lei TEXT, postcode TEXT, huisnr TEXT, plaats TEXT, extra TEXT,
     n_rijen INTEGER NOT NULL DEFAULT 1)`,
  'CREATE INDEX IF NOT EXISTS idx_org_link_records_naam ON org_link_records(naam_norm)',
  'CREATE INDEX IF NOT EXISTS idx_org_link_records_kvk ON org_link_records(kvk)',
  'CREATE INDEX IF NOT EXISTS idx_org_link_records_cluster ON org_link_records(cluster_key)',
  `CREATE TABLE IF NOT EXISTS org_clusters (
     cluster_key TEXT PRIMARY KEY, naam TEXT NOT NULL, bronnen TEXT NOT NULL, n_bronnen INTEGER NOT NULL,
     heeft_geld INTEGER NOT NULL DEFAULT 0, heeft_toezicht INTEGER NOT NULL DEFAULT 0, kvk TEXT,
     run_id INTEGER NOT NULL, first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')))`,
];

function runWorker(records) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, [WORKER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = ''; let err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', (e) => reject(new Error(`Python niet te starten (${PYTHON}): ${e.message}. Zie docs/KOPPELING.md voor de venv.`)));
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(`splink_worker.py stopte met code ${code}: ${err.slice(-1500)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error(`Onleesbaar antwoord van de worker: ${out.slice(0, 300)}`)); }
    });
    py.stdin.end(JSON.stringify({ records: records.map(({ uid, naam_norm, postcode, huisnr, plaats }) => ({ uid, naam_norm, postcode, huisnr, plaats })) }));
  });
}

// Stabiele sleutel: de leden (bron + genormaliseerde naam). Komt er een bron bij,
// dan is het een nieuwe sleutel en dus een nieuw verband.
function clusterKey(leden) {
  const s = leden.map((r) => `${r.bron}|${r.naam_norm}`).sort().join('\n');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
}

function samenvatCluster(leden) {
  const bronnen = [...new Set(leden.filter((r) => r.bron !== 'kg').map((r) => r.bron))].sort();
  const naamBron = leden.find((r) => ['gleif', 'openkvk', 'anbi', 'zorg'].includes(r.bron)) || leden[0];
  return {
    naam: naamBron.naam,
    bronnen,
    heeft_geld: leden.some((r) => r.rol === 'geld') ? 1 : 0,
    heeft_toezicht: leden.some((r) => r.rol === 'toezicht') ? 1 : 0,
    kvk: (leden.find((r) => r.kvk) || {}).kvk || null,
  };
}

async function batchUitvoeren(db, statements, grootte = 400) {
  for (let i = 0; i < statements.length; i += grootte) await db.batch(statements.slice(i, i + grootte), 'write');
}

async function main() {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const perBron = {};
    const ruw = [];
    for (const [naam, load] of Object.entries(LOADERS)) {
      const r = await load(db);
      perBron[naam] = r.length;
      ruw.push(...r);
    }
    const records = voegSamen(ruw.map(maakRecord).filter(Boolean));
    const inputHash = crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
    console.log(`Records: ${ruw.length} ruw, ${records.length} na samenvoegen per bron.`);

    if (!DRY) {
      await batchUitvoeren(db, SCHEMA);
      const [vorige] = (await db.execute("SELECT id, input_hash FROM org_link_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1")).rows;
      if (vorige && vorige.input_hash === inputHash && !FORCE) {
        console.log(`Invoer ongewijzigd sinds run ${vorige.id}; niets te doen.`);
        await db.execute({ sql: "UPDATE org_clusters SET last_seen_at = datetime('now') WHERE run_id = ?", args: [vorige.id] });
        return;
      }
    }

    const t0 = Date.now();
    const antwoord = await runWorker(records);
    const { clusterVan, geweigerd } = clusteren(records, antwoord.paren, DREMPEL_CLUSTER);
    const groepen = new Map();
    records.forEach((r, i) => {
      const c = clusterVan[i];
      if (!groepen.has(c)) groepen.set(c, []);
      groepen.get(c).push(r);
    });
    const keyVan = new Map();
    const kruis = [];
    for (const [c, leden] of groepen) {
      const key = clusterKey(leden);
      keyVan.set(c, key);
      const s = samenvatCluster(leden);
      if (s.bronnen.length >= 2) kruis.push({ key, ...s, leden });
    }
    const stats = {
      records: records.length, paren: antwoord.paren.length, clusters: groepen.size, kruisclusters: kruis.length,
      geweigerd, geld_en_toezicht: kruis.filter((k) => k.heeft_geld && k.heeft_toezicht).length,
      rekentijd_s: Math.round((Date.now() - t0) / 100) / 10, model: antwoord.model.versie,
    };
    console.log(JSON.stringify({ per_bron: perBron, ...stats }, null, 2));
    if (DRY) {
      for (const k of kruis.filter((x) => x.heeft_geld && x.heeft_toezicht).slice(0, 15)) {
        console.log(`- ${k.naam} [${k.bronnen.join(', ')}]`);
      }
      return;
    }

    const run = await db.execute({
      sql: `INSERT INTO org_link_runs (records, paren, clusters, kruisclusters, geweigerd, model_version, input_hash, per_bron)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [stats.records, stats.paren, stats.clusters, stats.kruisclusters, geweigerd, stats.model, inputHash, JSON.stringify(perBron)],
    });
    const runId = Number(run.lastInsertRowid);
    await batchUitvoeren(db, records.map((r, i) => ({
      sql: `INSERT INTO org_link_records (run_id, cluster_key, bron, rol, bron_ref, naam, naam_norm, kvk, rsin, lei, postcode, huisnr, plaats, extra, n_rijen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [runId, keyVan.get(clusterVan[i]), r.bron, r.rol, r.bron_ref, r.naam, r.naam_norm, r.kvk, r.rsin, r.lei, r.postcode, r.huisnr, r.plaats, r.extra, r.n_rijen],
    })));
    await batchUitvoeren(db, kruis.map((k) => ({
      sql: `INSERT INTO org_clusters (cluster_key, naam, bronnen, n_bronnen, heeft_geld, heeft_toezicht, kvk, run_id)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(cluster_key) DO UPDATE SET naam = excluded.naam, heeft_geld = excluded.heeft_geld,
              heeft_toezicht = excluded.heeft_toezicht, kvk = excluded.kvk, run_id = excluded.run_id, last_seen_at = datetime('now')`,
      args: [k.key, k.naam, JSON.stringify(k.bronnen), k.bronnen.length, k.heeft_geld, k.heeft_toezicht, k.kvk, runId],
    })));
    // Alleen de laatste run bewaren; de runtabel zelf blijft als logboek.
    await db.execute({ sql: 'DELETE FROM org_link_records WHERE run_id <> ?', args: [runId] });
    await db.execute({ sql: "UPDATE org_link_runs SET status = 'ok', finished_at = datetime('now') WHERE id = ?", args: [runId] });
    const [telling] = (await db.execute({ sql: 'SELECT COUNT(*) n FROM org_link_records WHERE run_id = ?', args: [runId] })).rows;
    const [nieuw] = (await db.execute({ sql: 'SELECT COUNT(*) n FROM org_clusters WHERE run_id = ? AND first_seen_at >= (SELECT started_at FROM org_link_runs WHERE id = ?)', args: [runId, runId] })).rows;
    console.log(`Run ${runId}: ${telling.n} records weggeschreven, ${nieuw.n} nieuwe kruisclusters.`);
    if (Number(telling.n) !== records.length) throw new Error(`Telling klopt niet: ${telling.n} van ${records.length}`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`Koppeling mislukt: ${e.message}`); process.exitCode = 1; });
}

module.exports = { clusterKey, samenvatCluster, runWorker };
