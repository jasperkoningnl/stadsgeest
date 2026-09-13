// Zelfstandige productie-run voor de knowledge-graph adapters en detectieregels.
// Bedoeld voor Windows Taakplanner; draait niet als permanent PM2-proces.

const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { createClient } = require('@libsql/client');
const { DetectionEngine } = require('./detection-engine.cjs');
const { registerPhase2Rules } = require('./detection-rules.cjs');
const { ArbeidsinspectieEerlijkWerkAdapter } = require('./adapters/arbeidsinspectie-eerlijk-werk.cjs');
const { LianderStoringenAdapter } = require('./adapters/liander-storingen.cjs');
const { AcmPublicatiesAdapter } = require('./adapters/acm-publicaties.cjs');
const { ApSanctiesAdapter } = require('./adapters/ap-sancties.cjs');
const { TuchtrechtSruAdapter } = require('./adapters/tuchtrecht-sru.cjs');
const { AsbestovertredingenAdapter } = require('./adapters/asbestovertredingen.cjs');
const { LrkKinderopvangAdapter } = require('./adapters/lrk-kinderopvang.cjs');
const { DuoSchoolvestigingenAdapter } = require('./adapters/duo-schoolvestigingen.cjs');
const { DuoLeerlingaantallenAdapter } = require('./adapters/duo-leerlingaantallen.cjs');
const { DuoPrognosesAdapter } = require('./adapters/duo-prognoses.cjs');
const { AfmRegisterAdapter } = require('./adapters/afm-register.cjs');
const { DnbRegisterAdapter } = require('./adapters/dnb-register.cjs');
const { PolitieCbsAdapter } = require('./adapters/politie-cbs-anomalies.cjs');
const { NdwPlanningAdapter } = require('./adapters/ndw-planning.cjs');
const { RvoProjectenAdapter } = require('./adapters/rvo-projecten.cjs');
const { KoopNonMunicipalAdapter } = require('./adapters/koop-nonmunicipal.cjs');
const { OnderwijsinspectieKwaliteitAdapter } = require('./adapters/onderwijsinspectie-kwaliteit.cjs');

const LOCK_PATH = path.join(__dirname, '../../.detection-run.lock');
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;

const ADAPTERS = [
  ['arbeidsinspectie', ArbeidsinspectieEerlijkWerkAdapter],
  ['liander', LianderStoringenAdapter],
  ['acm', AcmPublicatiesAdapter],
  ['ap', ApSanctiesAdapter],
  ['tuchtrecht', TuchtrechtSruAdapter],
  ['asbest', AsbestovertredingenAdapter],
  ['lrk', LrkKinderopvangAdapter],
  ['duo', DuoSchoolvestigingenAdapter],
  ['duo-leerlingen', DuoLeerlingaantallenAdapter],
  ['duo-prognoses', DuoPrognosesAdapter],
  ['inspectie-kwaliteit', OnderwijsinspectieKwaliteitAdapter, { sourceName: 'Onderwijsinspectie — kwaliteitsoordelen', minimumHours: 144 }],
  ['koop', KoopNonMunicipalAdapter, { sourceName: 'KOOP — niet-gemeentelijke officiële publicaties', minimumHours: 20 }],
  ['afm', AfmRegisterAdapter, { sourceName: 'AFM — register financiële dienstverleners', minimumHours: 20 }],
  ['dnb', DnbRegisterAdapter, { sourceName: 'DNB — openbaar register', minimumHours: 20 }],
  ['politie-cbs', PolitieCbsAdapter, { sourceName: 'Politie/CBS — geregistreerde misdrijven per buurt', minimumHours: 650 }],
  ['ndw', NdwPlanningAdapter, { sourceName: 'NDW — wegwerkzaamheden en evenementen', minimumHours: 0.2 }],
  ['rvo', RvoProjectenAdapter, { sourceName: 'RVO — Projectendatabase', minimumHours: 144 }],
];

function isDueAt(lastFinishedAt, minimumHours, now = Date.now()) {
  if (!lastFinishedAt) return true;
  const timestamp = Date.parse(lastFinishedAt);
  return !Number.isFinite(timestamp) || now - timestamp >= minimumHours * 3600000;
}

async function adapterIsDue(db, schedule) {
  if (!schedule) return true;
  const result = await db.execute({ sql: `SELECT MAX(fr.finished_at) AS last_finished_at
    FROM fetch_runs fr JOIN sources s ON s.id=fr.source_id WHERE s.name=? AND fr.status='ok'`, args: [schedule.sourceName] });
  return isDueAt(result.rows[0]?.last_finished_at, schedule.minimumHours);
}

function numberFrom(result, keys, fallback = 0) {
  for (const key of keys) {
    if (Number.isFinite(Number(result?.[key]))) return Number(result[key]);
  }
  return fallback;
}

function summarizeRun(result = {}) {
  const skipped = numberFrom(result, ['skipped']);
  const local = numberFrom(result, ['lokaal', 'matched']);
  const found = numberFrom(result, ['total'], local + skipped);
  return {
    recordsFound: found,
    recordsNew: numberFrom(result, ['created', 'events']),
    recordsChanged: numberFrom(result, ['updated', 'changed']),
    recordsRemoved: numberFrom(result, ['removed']),
  };
}

async function acquireLock() {
  try {
    const handle = await fs.open(LOCK_PATH, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.stat(LOCK_PATH);
    if (Date.now() - stat.mtimeMs <= STALE_LOCK_MS) {
      throw new Error('Er draait al een detection-run (actieve lock).');
    }
    await fs.unlink(LOCK_PATH);
    return acquireLock();
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(LOCK_PATH, now, now).catch(() => {});
  }, 60_000);
  heartbeat.unref();
  return heartbeat;
}

async function releaseLock(heartbeat) {
  if (heartbeat) clearInterval(heartbeat);
  await fs.unlink(LOCK_PATH).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function logAdapterRun(db, adapter, startedAt, status, result, errorMessage) {
  if (!adapter.sourceId || adapter.dryRun) return;
  const counts = summarizeRun(result);
  await db.execute({
    sql: `INSERT INTO fetch_runs
          (source_id, adapter_version, started_at, finished_at, status,
           records_found, records_new, records_changed, records_removed,
           error_message, duration_ms)
          VALUES (?, 'orchestrator-1.0', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      adapter.sourceId,
      startedAt,
      new Date().toISOString(),
      status,
      counts.recordsFound,
      counts.recordsNew,
      counts.recordsChanged,
      counts.recordsRemoved,
      errorMessage ? String(errorMessage).slice(0, 500) : null,
      Date.now() - new Date(startedAt).getTime(),
    ],
  });
}

function parseOptions(argv) {
  const value = name => argv.find(arg => arg.startsWith(`${name}=`))?.split('=').slice(1).join('=');
  const adapterArg = value('--adapters');
  return {
    dryRun: argv.includes('--dry-run'),
    skipAdapters: argv.includes('--skip-adapters'),
    skipRules: argv.includes('--skip-rules'),
    days: Math.max(1, Number.parseInt(value('--days') || '2', 10)),
    adapterNames: adapterArg ? new Set(adapterArg.split(',').map(v => v.trim()).filter(Boolean)) : null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  let heartbeat;
  let lockAcquired = false;
  const failures = [];
  const adapterResults = [];

  try {
    heartbeat = await acquireLock();
    lockAcquired = true;
    console.log(`[DetectionRun] Start ${new Date().toISOString()}${options.dryRun ? ' (DRY RUN)' : ''}`);

    if (!options.skipAdapters) {
      for (const [name, Adapter, schedule] of ADAPTERS) {
        if (options.adapterNames && !options.adapterNames.has(name)) continue;
        if (!options.adapterNames && !options.dryRun && !(await adapterIsDue(db, schedule))) {
          adapterResults.push({ name, status: 'not_due' });
          continue;
        }
        const startedAt = new Date().toISOString();
        const adapter = new Adapter({ db, dryRun: options.dryRun });
        try {
          const result = await adapter.run();
          let health = null;
          if (typeof adapter.health === 'function') {
            health = await adapter.health();
            if (health?.status === 'error') failures.push(`${name} health: ${health.message}`);
          }
          const status = health?.status === 'error' ? 'error' : (summarizeRun(result).recordsFound === 0 ? 'empty' : 'ok');
          await logAdapterRun(db, adapter, startedAt, status, result, health?.status === 'error' ? health.message : null);
          adapterResults.push({ name, status, result, health });
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
          await logAdapterRun(db, adapter, startedAt, 'error', {}, error.message).catch(() => {});
          adapterResults.push({ name, status: 'error', error: error.message });
          console.error(`[DetectionRun] ${name} mislukt: ${error.message}`);
        }
      }
    }

    let detection = null;
    if (!options.skipRules) {
      const engine = new DetectionEngine({ db, dryRun: options.dryRun });
      registerPhase2Rules(engine);
      const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
      detection = await engine.evaluate({ since });
      for (const detail of detection.details.filter(item => item.action === 'error')) {
        failures.push(`${detail.ruleId}: ${detail.error}`);
      }
    }

    const summary = { adapters: adapterResults, detection, failures };
    console.log(`[DetectionRun] Samenvatting ${JSON.stringify(summary)}`);
    if (failures.length > 0) process.exitCode = 1;
    return summary;
  } finally {
    if (lockAcquired) await releaseLock(heartbeat);
    await db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[DetectionRun] Fatale fout:', error);
    process.exitCode = 1;
  });
}

module.exports = { ADAPTERS, adapterIsDue, isDueAt, summarizeRun, parseOptions, main };
