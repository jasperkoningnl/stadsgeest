#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const lib = require('./documentlezer-lib.cjs');
const { controleerUittreksel } = require('./documentlezer-controle.cjs');

function optie(argv, naam, standaard = null) {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : standaard;
}

async function bereidRijVoor(db, bestand, model) {
  const u = JSON.parse(fs.readFileSync(bestand, 'utf8').replace(/^﻿/, ''));
  const eenheid = await lib.laadEenheid(db, u.sleutel);
  const controle = controleerUittreksel(u, eenheid);
  const ontbrekend = controle.feiten.filter((f) => !f.gevonden);
  if (controle.vormfouten.length || ontbrekend.length) {
    throw new Error(`${u.sleutel}: ${[...controle.vormfouten, ontbrekend.length ? `${ontbrekend.length} citaatfout(en)` : ''].filter(Boolean).join('; ')}`);
  }
  return {
    u, eenheid, controle,
    args: [
      u.sleutel, eenheid.hoofditem_id, eenheid.bijlage_id,
      eenheid.deelitem ? eenheid.raw_item_id : null,
      eenheid.begin_in_document, eenheid.tekens, eenheid.document_tekens,
      eenheid.sha, u.versie, model, u.kern.trim(), JSON.stringify(u.feiten),
      JSON.stringify(controle), eenheid.tekstveld,
      /afgekap|ontbreekt|niet in dit bestand/i.test(String(u.gelezen?.opmerking || '')) ? 1 : 0,
      new Date().toISOString(),
    ],
  };
}

async function main(argv = process.argv.slice(2)) {
  const map = path.resolve(optie(argv, '--uittreksels', path.join(lib.STANDAARD_MAP, 'uittreksels')));
  const model = optie(argv, '--model');
  const apply = argv.includes('--apply');
  const inputTokens = optie(argv, '--input-tokens');
  const outputTokens = optie(argv, '--output-tokens');
  const overheadTokens = optie(argv, '--vaste-overhead-tokens');
  if (!model) throw new Error('--model is verplicht');
  const bestanden = fs.readdirSync(map).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(map, f));
  if (!bestanden.length) throw new Error(`geen uittreksels in ${map}`);
  const lokaal = lib.openKopie(optie(argv, '--kopie'));
  const rijen = [];
  try {
    for (const bestand of bestanden) rijen.push(await bereidRijVoor(lokaal, bestand, model));
  } finally {
    lokaal.close();
  }
  const samenvatting = {
    mode: apply ? 'apply' : 'dry-run', uittreksels: rijen.length,
    feiten: rijen.reduce((n, r) => n + r.u.feiten.length, 0),
    onzeker: rijen.reduce((n, r) => n + r.u.feiten.filter((f) => f.bewijsstatus === 'extractie_onzeker').length, 0),
    tekens: rijen.reduce((n, r) => n + r.eenheid.tekens, 0),
    gebruik: { input_tokens: inputTokens ? Number(inputTokens) : null, output_tokens: outputTokens ? Number(outputTokens) : null, vaste_overhead_tokens: overheadTokens ? Number(overheadTokens) : null },
  };
  if (!apply) return console.log(JSON.stringify(samenvatting, null, 2));
  if (!process.env.TURSO_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_URL en TURSO_AUTH_TOKEN ontbreken.');
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const { biedSignalenOpnieuwAan } = await import('./heraanbieden.mjs');
  let geschreven = 0;
  try {
    for (const rij of rijen) {
      const resultaat = await db.execute({
        sql: `INSERT OR IGNORE INTO document_uittreksels
          (sleutel,raw_item_id,bijlage_id,deel_item_id,begin_in_document,tekens,document_tekens,
           tekst_sha,instructie_versie,model,kern,feiten,controle,tekstbron,afgekapt,gecontroleerd_at,
           input_tokens,output_tokens,vaste_overhead_tokens)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [...rij.args, inputTokens ? Number(inputTokens) : null, outputTokens ? Number(outputTokens) : null, overheadTokens ? Number(overheadTokens) : null],
      });
      if (Number(resultaat.rowsAffected || 0) === 0) continue;
      geschreven += 1;
      await biedSignalenOpnieuwAan(db, rij.eenheid.hoofditem_id, {
        actor: 'documentlezer', reden: `nieuw gecontroleerd uittreksel ${rij.u.sleutel}`,
      });
    }
  } finally {
    db.close();
  }
  console.log(JSON.stringify({ ...samenvatting, geschreven }, null, 2));
}

module.exports = { bereidRijVoor };
if (require.main === module) main().catch((e) => { console.error(`Opslaan mislukt: ${e.message}`); process.exitCode = 1; });
