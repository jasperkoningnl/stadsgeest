/**
 * stilte-alarm.mjs — slaat alarm als er te lang niets binnenkomt.
 *
 * De pm2-healthcheck bewaakt of de jobs bestaan. Die merkt niets als de laptop
 * uit staat, als een netwerkstoring alles laat mislukken, of als de scrapers wel
 * draaien maar niets meer opleveren. Dit script kijkt naar het enige dat telt:
 * staat er nog verse data in de database.
 *
 * Drie controles:
 *   1. Wanneer kwam het laatste raw_item binnen?          (drempel: 24 uur)
 *   2. Wanneer draaide de intake voor het laatst?          (drempel: 30 uur)
 *   3. Hoeveel items leverde de laatste etmaal op?         (ondergrens: 10)
 *
 * Exitcode 0 = rustig, 1 = alarm, 2 = kon niet meten (databasefout).
 * De uitvoer is één regel per bevinding; stilte-alarm.ps1 logt en toont die.
 *
 * Let op: hier staat bewust `process.exitCode = n` en geen `process.exit(n)`.
 * Een harde exit terwijl de libsql-client nog een open handle heeft, laat Node
 * op Windows afbreken met "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
 * en levert een onbruikbare exitcode (-1073740791) op. Eerst db.close(), dan
 * Node zelf laten eindigen.
 */

import { createDb } from './src/lib.js';

const UREN_ITEMS  = Number(process.env.ALARM_UREN_ITEMS  || 24);
const UREN_INTAKE = Number(process.env.ALARM_UREN_INTAKE || 30);
const MIN_ITEMS   = Number(process.env.ALARM_MIN_ITEMS   || 10);

// Tijdstempels staan gemengd in de database: '...T...Z' naast '... ...' zonder Z.
// Zonder normaliseren klopt een vergelijking binnen dezelfde dag niet.
const NORM = (kolom) => `replace(replace(${kolom},'T',' '),'Z','')`;

function urenGeleden(waarde) {
  if (!waarde) return null;
  const t = Date.parse(String(waarde).replace(' ', 'T').replace(/Z?$/, 'Z'));
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

let db = null;
try {
  db = createDb();
  const meldingen = [];

  const laatsteItem = await db.execute(
    `SELECT max(${NORM('scraped_at')}) AS t FROM raw_items`
  );
  const uItem = urenGeleden(laatsteItem.rows[0]?.t);
  if (uItem === null) {
    meldingen.push('ALARM geen enkel raw_item met een leesbare datum gevonden');
  } else if (uItem > UREN_ITEMS) {
    meldingen.push(`ALARM laatste nieuwe item is ${Math.round(uItem)} uur oud (drempel ${UREN_ITEMS})`);
  }

  const laatsteIntake = await db.execute(
    `SELECT max(${NORM('started_at')}) AS t FROM intake_runs`
  );
  const uIntake = urenGeleden(laatsteIntake.rows[0]?.t);
  if (uIntake === null) {
    meldingen.push('ALARM geen intake-run met een leesbare datum gevonden');
  } else if (uIntake > UREN_INTAKE) {
    meldingen.push(`ALARM laatste intake-run is ${Math.round(uIntake)} uur geleden (drempel ${UREN_INTAKE})`);
  }

  const etmaal = await db.execute(
    `SELECT COUNT(*) AS n FROM raw_items WHERE ${NORM('scraped_at')} >= datetime('now','-24 hour')`
  );
  const n24 = Number(etmaal.rows[0]?.n ?? 0);
  if (n24 < MIN_ITEMS) {
    meldingen.push(`ALARM slechts ${n24} nieuwe items in 24 uur (ondergrens ${MIN_ITEMS})`);
  }

  if (meldingen.length === 0) {
    console.log(`ok laatste item ${Math.round(uItem)}u geleden, intake ${Math.round(uIntake)}u geleden, ${n24} items in 24u`);
    process.exitCode = 0;
  } else {
    for (const m of meldingen) console.log(m);
    process.exitCode = 1;
  }
} catch (e) {
  console.log(`FOUT kon de database niet bevragen: ${e.message}`);
  process.exitCode = 2;
} finally {
  try { db?.close?.(); } catch { /* client was al dicht */ }
}
