#!/usr/bin/env node
'use strict';

// Migratie 2026-09-24: kolom tips.supertip.
//
// Een supertip komt uit de wekelijkse supertip-run (donderdag). Tot nu toe was
// het alleen een voorvoegsel "Supertip:" in de titel. Dit script voegt de kolom
// toe, zet hem aan voor tips met dat voorvoegsel en haalt het voorvoegsel uit de
// titel. Het is idempotent: nogmaals draaien verandert niets.
//
// Gebruik: node scraper/src/migreer-supertip.cjs [--apply]

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const kolommen = (await db.execute("SELECT name FROM pragma_table_info('tips')")).rows.map((r) => r.name);
    const heeftKolom = kolommen.includes('supertip');
    const metVoorvoegsel = (await db.execute(
      "SELECT id, titel FROM tips WHERE lower(titel) LIKE 'supertip%'",
    )).rows;
    console.log(`Kolom supertip aanwezig: ${heeftKolom ? 'ja' : 'nee'}`);
    console.log(`Tips met voorvoegsel Supertip: ${metVoorvoegsel.map((r) => r.id).join(', ') || 'geen'}`);
    if (!apply) {
      console.log('Droog gedraaid. Gebruik --apply om te schrijven.');
      return;
    }
    if (!heeftKolom) {
      await db.execute('ALTER TABLE tips ADD COLUMN supertip INTEGER NOT NULL DEFAULT 0');
    }
    for (const rij of metVoorvoegsel) {
      const titel = String(rij.titel).replace(/^\s*supertip\s*[:\-–—]\s*/i, '').trim();
      await db.execute({ sql: 'UPDATE tips SET supertip = 1, titel = ? WHERE id = ?', args: [titel, rij.id] });
    }
    const na = (await db.execute('SELECT id, titel FROM tips WHERE supertip = 1')).rows;
    console.log(`Supertips na migratie: ${na.map((r) => `${r.id} (${r.titel})`).join('; ') || 'geen'}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Migratie mislukt: ${error.message}`);
  process.exitCode = 1;
});
