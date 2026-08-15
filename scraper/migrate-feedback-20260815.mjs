/**
 * migrate-feedback-20260815.mjs — tabel voor algemene feedback op het dashboard.
 *
 * De redactie kon tot nu toe alleen iets zeggen óver een tip (redencode bij
 * goedkeuren/parkeren/afkeuren, in `tip_feedback`). Wat er over het dashboard
 * zelf te melden viel — dit is onduidelijk, dit ontbreekt, dit werkt niet —
 * had geen plek. Deze tabel is die plek.
 *
 * Losgehouden van `tip_feedback` met opzet: die tabel is het meetmateriaal van
 * de testperiode (waarom werd een tip wel of niet gebruikt) en moet één
 * betekenis houden. Opmerkingen over de werking van het dashboard horen daar
 * niet tussen.
 *
 * Append-only, net als tip_feedback: er wordt nooit iets overschreven.
 *
 * Draaien: node migrate-feedback-20260815.mjs [--doen]
 * Zonder --doen rapporteert hij alleen wat hij zou wijzigen.
 */

import { createDb } from './src/lib.js';

const db = createDb();
const DOEN = process.argv.includes('--doen');

console.log(`\n=== Migratie dashboardfeedback 2026-08-15 (${DOEN ? 'echt' : 'proefdraai'}) ===\n`);

const bestaat = (await db.execute(
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_feedback'`,
)).rows.length > 0;

if (bestaat) {
  const n = Number((await db.execute('SELECT COUNT(*) n FROM dashboard_feedback')).rows[0]?.n ?? 0);
  console.log(`dashboard_feedback bestaat al (${n} rijen) — overgeslagen`);
} else if (DOEN) {
  await db.execute(`
    CREATE TABLE dashboard_feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      gebruiker  TEXT NOT NULL,
      soort      TEXT,
      tekst      TEXT NOT NULL,
      pagina     TEXT,
      aanleiding TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_dashboard_feedback_created ON dashboard_feedback(created_at)',
  );
  console.log('UITGEVOERD: tabel dashboard_feedback + index aangemaakt');
} else {
  console.log('ZOU DOEN: tabel dashboard_feedback + index aanmaken');
}

// Kolommen ter controle tonen, ook bij een proefdraai op een bestaande tabel.
if (bestaat || DOEN) {
  const kolommen = (await db.execute("SELECT name, type FROM pragma_table_info('dashboard_feedback')")).rows;
  console.log('\nKolommen:', kolommen.map((k) => `${k.name} ${k.type}`).join(', '));
}

console.log('\nKlaar.\n');
