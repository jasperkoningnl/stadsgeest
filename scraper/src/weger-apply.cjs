#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

const TIP_TYPES = new Set(['nieuwsfeit', 'patroon', 'verdieping', 'dossiersignaal']);
const MUNICIPALITIES = new Set(['Amersfoort', 'Leusden', 'regio']);
const SIGNAL_ROLES = new Set(['dragend', 'bevestigend', 'context']);
const REVIEW_STATUSES = new Set(['watching', 'discarded']);
const FACT_TYPES = new Set([
  'incident', 'besluit', 'bedrag', 'contract', 'subsidie', 'claim', 'plan',
  'realisatie', 'maatregel', 'correctie', 'overig',
]);
const CERTAINTIES = new Set([
  'bevestigd', 'officieel', 'claim_belanghebbende', 'verwachting',
  'theoretisch', 'onbevestigd', 'betwist',
]);
const REQUIRED_BRIEFING_HEADINGS = [
  'WAT WE WETEN',
  'BETROKKEN PERSONEN EN ORGANISATIES',
  'HOE DIT IS GEVONDEN',
  'WAT WE NIET WETEN',
  'WAT HIER NIET IN MAG',
  'ELDERS GEBRACHT',
];

function usage() {
  return `Gebruik: node scraper/src/weger-apply.cjs plan.json [--apply]\n\n` +
    `Zonder --apply wordt het plan volledig gevalideerd en alleen als voorvertoning\n` +
    `getoond. Met --apply worden reviews, tips en dossierfeiten atomair geschreven.\n\n` +
    `Hoofdvelden: { reviews: [], tips: [], dossier_facts: [] }`;
}

function words(value) {
  return String(value ?? '').trim().split(/\s+/).filter(Boolean).length;
}

function requiredString(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} is verplicht.`);
}

function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return ['Het plan moet een JSON-object zijn.'];
  }
  const reviews = Array.isArray(plan.reviews) ? plan.reviews : [];
  const tips = Array.isArray(plan.tips) ? plan.tips : [];
  const facts = Array.isArray(plan.dossier_facts) ? plan.dossier_facts : [];
  if (plan.reviews !== undefined && !Array.isArray(plan.reviews)) errors.push('reviews moet een array zijn.');
  if (plan.tips !== undefined && !Array.isArray(plan.tips)) errors.push('tips moet een array zijn.');
  if (plan.dossier_facts !== undefined && !Array.isArray(plan.dossier_facts)) errors.push('dossier_facts moet een array zijn.');

  const reviewIds = new Set();
  const reviewStatusById = new Map();
  reviews.forEach((review, index) => {
    const field = `reviews[${index}]`;
    if (!Number.isInteger(review?.signal_id) || review.signal_id < 1) errors.push(`${field}.signal_id is ongeldig.`);
    if (reviewIds.has(review?.signal_id)) errors.push(`${field}.signal_id komt dubbel voor.`);
    reviewIds.add(review?.signal_id);
    reviewStatusById.set(review?.signal_id, review?.status_to);
    if (!REVIEW_STATUSES.has(review?.status_to)) errors.push(`${field}.status_to moet watching of discarded zijn.`);
    requiredString(review?.reason, `${field}.reason`, errors);
  });

  const linkedSignalIds = new Set();
  tips.forEach((tip, index) => {
    const field = `tips[${index}]`;
    requiredString(tip?.titel, `${field}.titel`, errors);
    requiredString(tip?.kern, `${field}.kern`, errors);
    requiredString(tip?.briefing, `${field}.briefing`, errors);
    requiredString(tip?.categorie, `${field}.categorie`, errors);
    requiredString(tip?.score_motivatie, `${field}.score_motivatie`, errors);
    for (const heading of REQUIRED_BRIEFING_HEADINGS) {
      if (!new RegExp(`^\\s*${heading}\\s*$`, 'm').test(tip?.briefing ?? '')) {
        errors.push(`${field}.briefing mist de kop ${heading} op een eigen regel.`);
      }
    }
    if (words(tip?.titel) > 10) errors.push(`${field}.titel mag maximaal 10 woorden bevatten.`);
    if (words(tip?.kern) > 30) errors.push(`${field}.kern mag maximaal 30 woorden bevatten.`);
    if (!TIP_TYPES.has(tip?.soort)) errors.push(`${field}.soort is ongeldig.`);
    if (!MUNICIPALITIES.has(tip?.gemeente)) errors.push(`${field}.gemeente is ongeldig.`);
    if (!Number.isInteger(tip?.score)) errors.push(`${field}.score moet een geheel getal zijn.`);
    if (!Array.isArray(tip?.vervolgvragen) || tip.vervolgvragen.length === 0) errors.push(`${field}.vervolgvragen moet een niet-lege array zijn.`);
    if (!tip?.weging || typeof tip.weging !== 'object' || Array.isArray(tip.weging)) errors.push(`${field}.weging moet een object zijn.`);
    if (!Array.isArray(tip?.herkomst) || tip.herkomst.length === 0) errors.push(`${field}.herkomst moet een niet-lege array zijn.`);
    if (Array.isArray(tip?.herkomst) && !tip.herkomst.some((source) => [1, 2].includes(Number(source?.tier)) && source?.spiegel !== true)) {
      errors.push(`${field}.herkomst mist een dragende tier-1- of tier-2-bron.`);
    }
    if (!Array.isArray(tip?.elders_gebracht)) errors.push(`${field}.elders_gebracht moet een array zijn.`);
    if ((tip?.elders_gebracht?.length ?? 0) > 0) requiredString(tip?.toegevoegde_waarde, `${field}.toegevoegde_waarde`, errors);
    if (!Array.isArray(tip?.trefwoorden) || tip.trefwoorden.length < 3 || tip.trefwoorden.length > 5) {
      errors.push(`${field}.trefwoorden moet 3 tot 5 items bevatten.`);
    }
    if (!Array.isArray(tip?.signals) || tip.signals.length === 0) {
      errors.push(`${field}.signals moet een niet-lege array zijn.`);
    } else {
      if (!tip.signals.some((link) => link?.rol === 'dragend')) errors.push(`${field}.signals mist een dragend signaal.`);
      tip.signals.forEach((link, linkIndex) => {
        const linkField = `${field}.signals[${linkIndex}]`;
        if (!Number.isInteger(link?.id) || link.id < 1) errors.push(`${linkField}.id is ongeldig.`);
        if (!SIGNAL_ROLES.has(link?.rol)) errors.push(`${linkField}.rol is ongeldig.`);
        if (linkedSignalIds.has(link?.id)) errors.push(`${linkField}.id wordt door meerdere tips gebruikt.`);
        linkedSignalIds.add(link?.id);
        if (!reviewIds.has(link?.id)) errors.push(`${linkField}.id mist een review-oordeel.`);
        if (reviewStatusById.get(link?.id) && reviewStatusById.get(link.id) !== 'watching') {
          errors.push(`${linkField}.id kan niet tegelijk aan een tip gekoppeld en discarded worden.`);
        }
      });
    }
  });

  const thinTips = tips.filter((tip) => Number.isInteger(tip?.score) && tip.score < 6);
  if (thinTips.length > 1) errors.push('Maximaal één tip per run mag onder de gewone scoredrempel liggen.');
  for (const tip of thinTips) {
    if (/onder.{0,20}drempel/i.test(tip.score_motivatie ?? '')) {
      errors.push(`Tip "${tip.titel ?? '?'}" mag de drempelwaarschuwing niet in score_motivatie tonen.`);
    }
    const warningSection = String(tip.briefing ?? '').match(
      /^\s*WAT HIER NIET IN MAG\s*$([\s\S]*?)^\s*ELDERS GEBRACHT\s*$/m
    )?.[1] ?? '';
    const lastWarningLine = warningSection.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
    if (!/onder.{0,20}drempel/i.test(lastWarningLine)) {
      errors.push(`Tip "${tip.titel ?? '?'}" ligt onder de drempel; vermeld dat als laatste waarschuwing onder WAT HIER NIET IN MAG.`);
    }
  }

  facts.forEach((fact, index) => {
    const field = `dossier_facts[${index}]`;
    if (!Number.isInteger(fact?.dossier_id) || fact.dossier_id < 1) errors.push(`${field}.dossier_id is ongeldig.`);
    if (!FACT_TYPES.has(fact?.fact_type)) errors.push(`${field}.fact_type is ongeldig.`);
    if (!CERTAINTIES.has(fact?.zekerheid)) errors.push(`${field}.zekerheid is ongeldig.`);
    requiredString(fact?.titel, `${field}.titel`, errors);
    if (!Array.isArray(fact?.secundaire_bronnen)) errors.push(`${field}.secundaire_bronnen moet een array zijn.`);
    if (fact?.signal_id != null && (!Number.isInteger(fact.signal_id) || fact.signal_id < 1)) {
      errors.push(`${field}.signal_id is ongeldig.`);
    }
  });
  return errors;
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const apply = argv.includes('--apply');
  const files = argv.filter((arg) => !arg.startsWith('-'));
  if (files.length !== 1) throw new Error('Geef precies één JSON-planbestand op.');
  return { help: false, apply, file: path.resolve(files[0]) };
}

function normalizeIds(plan) {
  const signalIds = new Set();
  const dossierIds = new Set();
  for (const review of plan.reviews ?? []) signalIds.add(review.signal_id);
  for (const tip of plan.tips ?? []) {
    for (const link of tip.signals ?? []) signalIds.add(link.id);
    if (tip.dossier_id != null) dossierIds.add(tip.dossier_id);
  }
  for (const fact of plan.dossier_facts ?? []) {
    dossierIds.add(fact.dossier_id);
    if (fact.signal_id != null) signalIds.add(fact.signal_id);
  }
  return { signalIds: [...signalIds], dossierIds: [...dossierIds] };
}

async function fetchRowsByIds(db, table, ids, columns = 'id') {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return (await db.execute({ sql: `SELECT ${columns} FROM ${table} WHERE id IN (${placeholders})`, args: ids })).rows;
}

async function preflight(db, plan) {
  const errors = [];
  const { signalIds, dossierIds } = normalizeIds(plan);
  const signals = await fetchRowsByIds(db, 'signals', signalIds, 'id, status');
  const foundSignals = new Set(signals.map((row) => Number(row.id)));
  for (const id of signalIds) if (!foundSignals.has(id)) errors.push(`Signaal ${id} bestaat niet.`);
  const dossiers = await fetchRowsByIds(db, 'dossiers', dossierIds);
  const foundDossiers = new Set(dossiers.map((row) => Number(row.id)));
  for (const id of dossierIds) if (!foundDossiers.has(id)) errors.push(`Dossier ${id} bestaat niet.`);

  const tipSignalIds = (plan.tips ?? []).flatMap((tip) => tip.signals.map((link) => link.id));
  if (tipSignalIds.length > 0) {
    const placeholders = tipSignalIds.map(() => '?').join(',');
    const linked = await db.execute({
      sql: `SELECT DISTINCT signal_id FROM tip_signals WHERE signal_id IN (${placeholders})`,
      args: tipSignalIds,
    });
    for (const row of linked.rows) errors.push(`Signaal ${row.signal_id} is al aan een tip gekoppeld.`);
  }
  return { errors, statusBySignal: new Map(signals.map((row) => [Number(row.id), row.status])) };
}

async function applyPlan(db, plan, statusBySignal) {
  const tx = await db.transaction('write');
  try {
    const tipSignalIds = (plan.tips ?? []).flatMap((tip) => tip.signals.map((link) => link.id));
    if (tipSignalIds.length > 0) {
      const placeholders = tipSignalIds.map(() => '?').join(',');
      const linked = await tx.execute({
        sql: `SELECT DISTINCT signal_id FROM tip_signals WHERE signal_id IN (${placeholders})`,
        args: tipSignalIds,
      });
      if (linked.rows.length > 0) {
        throw new Error(`Gelijktijdigheidscontrole: signaal ${linked.rows[0].signal_id} is inmiddels aan een tip gekoppeld.`);
      }
    }
    for (const tip of plan.tips ?? []) {
      const inserted = await tx.execute({
        sql: `INSERT INTO tips
          (titel, kern, briefing, vervolgvragen, soort, gemeente, categorie, score,
           score_motivatie, weging, herkomst, elders_gebracht, toegevoegde_waarde,
           dossier_id, actor, trefwoorden)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex-weger', ?)`,
        args: [
          tip.titel.trim(), tip.kern.trim(), tip.briefing.trim(), JSON.stringify(tip.vervolgvragen),
          tip.soort, tip.gemeente, tip.categorie.trim(), tip.score, tip.score_motivatie.trim(),
          JSON.stringify(tip.weging), JSON.stringify(tip.herkomst), JSON.stringify(tip.elders_gebracht),
          tip.toegevoegde_waarde?.trim() || null, tip.dossier_id ?? null, JSON.stringify(tip.trefwoorden),
        ],
      });
      const tipId = Number(inserted.lastInsertRowid);
      for (const link of tip.signals) {
        await tx.execute({ sql: 'INSERT INTO tip_signals (tip_id, signal_id, rol) VALUES (?, ?, ?)', args: [tipId, link.id, link.rol] });
        await tx.execute({
          sql: `INSERT INTO signal_events
                (signal_id, actor, event_type, status_from, status_to, reason, payload)
                VALUES (?, 'weger', 'tip_created', ?, 'watching', ?, ?)`,
          args: [link.id, statusBySignal.get(link.id), `Tip ${tipId}: ${tip.titel}`, JSON.stringify({ tip_id: tipId, rol: link.rol })],
        });
      }
      await tx.execute({
        sql: `INSERT INTO tip_events (tip_id, actor, event_type, status_to, reason)
              VALUES (?, 'codex-weger', 'created', 'wachtrij', ?)`,
        args: [tipId, tip.score_motivatie.trim()],
      });
    }

    for (const review of plan.reviews ?? []) {
      const statusFrom = statusBySignal.get(review.signal_id);
      await tx.execute({
        sql: `INSERT INTO signal_events
              (signal_id, actor, event_type, status_from, status_to, reason)
              VALUES (?, 'weger', 'reviewed', ?, ?, ?)`,
        args: [review.signal_id, statusFrom, review.status_to, review.reason.trim()],
      });
      await tx.execute({ sql: 'UPDATE signals SET status = ? WHERE id = ?', args: [review.status_to, review.signal_id] });
    }

    for (const fact of plan.dossier_facts ?? []) {
      await tx.execute({
        sql: `INSERT INTO dossier_facts
          (dossier_id, fact_type, datum, locatie, titel, details, classificatie,
           zekerheid, primaire_bron_url, secundaire_bronnen, signal_id,
           tegenstrijdigheid, actor)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex-weger')`,
        args: [
          fact.dossier_id, fact.fact_type, fact.datum ?? null, fact.locatie ?? null,
          fact.titel.trim(), fact.details ?? null, fact.classificatie ?? null,
          fact.zekerheid, fact.primaire_bron_url ?? null, JSON.stringify(fact.secundaire_bronnen),
          fact.signal_id ?? null, fact.tegenstrijdigheid ?? null,
        ],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const plan = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  const validationErrors = validatePlan(plan);
  if (validationErrors.length > 0) throw new Error(`Ongeldig plan:\n- ${validationErrors.join('\n- ')}`);
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken in scraper/.env.');
  }
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const checked = await preflight(db, plan);
    if (checked.errors.length > 0) throw new Error(`Voorcontrole mislukt:\n- ${checked.errors.join('\n- ')}`);
    const counts = {
      reviews: plan.reviews?.length ?? 0,
      tips: plan.tips?.length ?? 0,
      dossier_facts: plan.dossier_facts?.length ?? 0,
    };
    if (!args.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', valid: true, counts }, null, 2));
      return;
    }
    await applyPlan(db, plan, checked.statusBySignal);
    console.log(JSON.stringify({ mode: 'applied', counts }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Weger-plan mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { validatePlan, words };
