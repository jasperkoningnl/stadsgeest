#!/usr/bin/env node
'use strict';

// Schrijft vóór de Codex-weger een lokaal scanbestand met alle exacte BAG-
// adressen uit de actuele werkset en hun voorberekende verbanden. PDOK wordt
// hier niet aangeroepen: extract-addresses.cjs heeft de BAG-cache eerder in
// dezelfde detectietaak gevuld.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const { loadAddressLinks } = require('./weger-workset.cjs');
const { afstandMeter } = require('./weger-adres.cjs');

const MONUMENTBRON = 154;
const MAX_MONUMENT_METER = 10;

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const i = argv.indexOf('--output');
  if (i === -1 || !argv[i + 1]) throw new Error('--output is verplicht.');
  return { output: path.resolve(argv[i + 1]) };
}

function pointFromRecord(record) {
  try {
    const object = JSON.parse(record);
    const coordinates = object?.data?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    return {
      nummer: object.data.monumentnummer,
      url: object.data.citation,
      point: [Number(coordinates[0]), Number(coordinates[1])],
    };
  } catch {
    return null;
  }
}

function nearbyMonuments(address, monuments) {
  if (!Number.isFinite(Number(address.lon)) || !Number.isFinite(Number(address.lat))) return [];
  const point = [Number(address.lon), Number(address.lat)];
  return monuments
    .map((monument) => ({
      monumentnummer: monument.nummer,
      url: monument.url,
      meter: Math.round(afstandMeter(point, monument.point)),
    }))
    .filter((monument) => monument.meter <= MAX_MONUMENT_METER)
    .sort((a, b) => a.meter - b.meter);
}

async function pendingSignals(db) {
  const result = await db.execute(`
    SELECT s.id, s.title, s.last_seen_at
    FROM signals s
    WHERE s.status IN ('new','watching')
      AND NOT EXISTS (SELECT 1 FROM tip_signals ts WHERE ts.signal_id = s.id)
      AND (
        NOT EXISTS (SELECT 1 FROM signal_events e WHERE e.signal_id = s.id AND e.actor = 'weger')
        OR datetime(s.last_seen_at) > datetime((
          SELECT MAX(e.created_at) FROM signal_events e
          WHERE e.signal_id = s.id AND e.actor = 'weger'
        ))
      )
    ORDER BY datetime(s.last_seen_at) DESC, s.id DESC
    LIMIT 500
  `);
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

async function addressesForSignal(db, signalId) {
  const result = await db.execute({
    sql: `SELECT da.nummeraanduiding_id AS bag_id,
                 MIN(COALESCE(c.weergavenaam, da.address_text)) AS adres,
                 MIN(da.buurtcode) AS buurtcode,
                 MIN(da.verblijfsobject_id) AS verblijfsobject_id,
                 MIN(c.lat) AS lat, MIN(c.lon) AS lon
          FROM signal_items si
          JOIN document_addresses da ON da.raw_item_id = si.raw_item_id
          LEFT JOIN bag_lookup_cache c ON c.query_key = da.query_key
          WHERE si.signal_id = ? AND da.match_status = 'exact'
          GROUP BY da.nummeraanduiding_id
          ORDER BY adres
          LIMIT 25`,
    args: [signalId],
  });
  return result.rows;
}

async function unresolvedForSignal(db, signalId) {
  const result = await db.execute({
    sql: `SELECT da.address_text AS adres, da.match_status AS status, da.method,
                 COUNT(*) AS vermeldingen
          FROM signal_items si
          JOIN document_addresses da ON da.raw_item_id = si.raw_item_id
          WHERE si.signal_id = ? AND da.match_status <> 'exact'
          GROUP BY da.query_key, da.match_status, da.method
          ORDER BY da.address_text
          LIMIT 25`,
    args: [signalId],
  });
  return result.rows.map((row) => ({ ...row, vermeldingen: Number(row.vermeldingen) }));
}

async function loadMonuments(db) {
  const result = await db.execute({
    sql: 'SELECT raw_object FROM source_records WHERE source_id = ?',
    args: [MONUMENTBRON],
  });
  return result.rows.map((row) => pointFromRecord(row.raw_object)).filter(Boolean);
}

async function buildScan(db, generatedAt = new Date().toISOString()) {
  const [signals, monuments] = await Promise.all([pendingSignals(db), loadMonuments(db)]);
  const outputSignals = [];
  for (const signal of signals) {
    const [addresses, unresolved] = await Promise.all([
      addressesForSignal(db, signal.id),
      unresolvedForSignal(db, signal.id),
    ]);
    const links = addresses.length ? await loadAddressLinks(db, signal.id) : [];
    const linkByBag = new Map(links.map((link) => [String(link.bag_nummeraanduiding), link]));
    outputSignals.push({
      signal_id: signal.id,
      titel: signal.title,
      last_seen_at: signal.last_seen_at,
      adressen: addresses.map((address) => ({
        adres: address.adres,
        bag_nummeraanduiding: address.bag_id,
        buurtcode: address.buurtcode,
        verblijfsobject_id: address.verblijfsobject_id,
        monumenten_binnen_10m: nearbyMonuments(address, monuments),
        verbanden: linkByBag.get(String(address.bag_id)) || null,
      })),
      onopgeloste_adressen: unresolved,
    });
  }
  return {
    version: 1,
    generated_at: generatedAt,
    mode: 'precomputed-local',
    external_address_requests: 0,
    candidate_count: signals.length,
    signal_count_with_exact_addresses: outputSignals.filter((signal) => signal.adressen.length > 0).length,
    signals: outputSignals,
  };
}

function writeAtomic(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, filename);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Gebruik: node scraper/src/prepare-weger-address-scan.cjs --output <bestand.json>');
    return;
  }
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken in scraper/.env.');
  }
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const scan = await buildScan(db);
    writeAtomic(args.output, scan);
    console.log(JSON.stringify({ output: args.output, candidates: scan.candidate_count, with_addresses: scan.signal_count_with_exact_addresses }));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Voorbereiden weger-adresscan mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, pointFromRecord, nearbyMonuments, buildScan, writeAtomic };
