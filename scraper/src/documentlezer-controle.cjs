#!/usr/bin/env node
'use strict';

// Documentlezer — controle van uittreksels tegen de brontekst.
// Leest uitsluitend de lokale kopie. Zie operations/DOCUMENTLEZER.md.
//
// Per uittreksel:
//   1. vorm: velden, soorten, aantal feiten, lengte van citaten;
//   2. citaat: staat het letterlijk in de brontekst (alleen witruimte telt
//      niet mee)? Een citaat dat niet gevonden wordt is een fout;
//   3. weger: staat het citaat in wat de weger nu van het stuk krijgt (de
//      eerste 4.000 tekens van het hoofditem), en waar begint het in het
//      document?
//
// Gebruik:
//   node scraper/src/documentlezer-controle.cjs [--uittreksels <map>] [--rapport <pad.json>] [--kopie <pad>]
// Eindigt met code 1 bij een citaatfout, een vormfout of een onleesbaar bestand.

const fs = require('fs');
const path = require('path');
const lib = require('./documentlezer-lib.cjs');

function optie(argv, naam, standaard) {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : standaard;
}

function zinnen(tekst) {
  return String(tekst || '').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9‘'"])/).filter((z) => z.trim()).length;
}

// Regelnummer (vanaf 1) in de leesversie waar teken `positie` van de
// genormaliseerde tekst valt.
function regelVan(leesregels, positie) {
  let gehad = 0;
  for (let i = 0; i < leesregels.length; i++) {
    const n = lib.normaliseer(leesregels[i]).length;
    if (n === 0) continue;
    gehad += n + (gehad > 0 ? 1 : 0);
    if (positie < gehad) return i + 1;
  }
  return leesregels.length;
}

// Pure controle van één uittreksel tegen één leeseenheid
// ({ sleutel, tekst, weger, begin_in_document }).
function controleerUittreksel(u, eenheid) {
  const vormfouten = [];
  const waarschuwingen = [];
  const bron = lib.normaliseer(eenheid.tekst);
  const weger = lib.normaliseer(eenheid.weger);
  const leesregels = lib.leesversie(eenheid.tekst).split('\n');

  if (!u || typeof u !== 'object') return { vormfouten: ['geen JSON-object'], waarschuwingen, feiten: [] };
  if (u.sleutel !== eenheid.sleutel) vormfouten.push(`sleutel ${u.sleutel} hoort ${eenheid.sleutel} te zijn`);
  if (typeof u.kern !== 'string' || !u.kern.trim()) vormfouten.push('kern ontbreekt');
  else if (zinnen(u.kern) !== 3) waarschuwingen.push(`kern heeft ${zinnen(u.kern)} zinnen in plaats van 3`);
  if (!Array.isArray(u.feiten)) vormfouten.push('feiten is geen lijst');
  if (u.versie !== 'productie-2') vormfouten.push(`versie ${u.versie} hoort productie-2 te zijn`);
  if (u.gelezen?.volledig !== true) vormfouten.push('gelezen.volledig is niet true');
  if (Number(u.gelezen?.regels) !== leesregels.length) waarschuwingen.push(`gelezen.regels ${u.gelezen?.regels}, leesversie heeft ${leesregels.length}`);
  const lijst = Array.isArray(u.feiten) ? u.feiten : [];
  if (lijst.length > lib.MAX_FEITEN) vormfouten.push(`${lijst.length} feiten, hoogstens ${lib.MAX_FEITEN}`);

  const feiten = lijst.map((f, i) => {
    const nr = i + 1;
    if (!lib.SOORTEN.includes(f?.soort)) vormfouten.push(`feit ${nr}: soort ongeldig: ${f?.soort}`);
    if (typeof f?.zin !== 'string' || !f.zin.trim()) vormfouten.push(`feit ${nr}: zin ontbreekt`);
    if (!lib.BEWIJSSTATUSSEN.includes(f?.bewijsstatus)) vormfouten.push(`feit ${nr}: bewijsstatus ongeldig: ${f?.bewijsstatus}`);
    const citaten = Array.isArray(f?.citaten) ? f.citaten : [];
    if (citaten.length < 1 || citaten.length > 3) vormfouten.push(`feit ${nr}: citaten moet 1 tot 3 bewijsplaatsen bevatten`);
    if (f?.bewijsstatus === 'direct' && citaten.length !== 1) vormfouten.push(`feit ${nr}: direct bewijs heeft precies één citaat`);
    if (f?.bewijsstatus === 'samengesteld' && citaten.length < 2) vormfouten.push(`feit ${nr}: samengesteld bewijs heeft minstens twee citaten`);
    const gecontroleerdeCitaten = citaten.map((c, ci) => {
      for (const veld of ['tekst', 'plek']) {
        if (typeof c?.[veld] !== 'string' || !c[veld].trim()) vormfouten.push(`feit ${nr}, citaat ${ci + 1}: ${veld} ontbreekt`);
      }
      const citaat = lib.normaliseer(c?.tekst);
      if (citaat.length < lib.CITAAT_MIN || citaat.length > lib.CITAAT_MAX) {
        waarschuwingen.push(`feit ${nr}, citaat ${ci + 1}: ${citaat.length} tekens (hoort ${lib.CITAAT_MIN}-${lib.CITAAT_MAX})`);
      }
      const positie = citaat ? bron.indexOf(citaat) : -1;
      const gevonden = positie >= 0;
      const regel = gevonden ? regelVan(leesregels, positie) : null;
      if (gevonden && Number.isInteger(c?.regel) && Math.abs(c.regel - regel) > 1) {
        waarschuwingen.push(`feit ${nr}, citaat ${ci + 1}: regel ${c.regel} opgegeven, citaat begint op regel ${regel}`);
      }
      const inDocument = gevonden ? eenheid.begin_in_document + positie : null;
      return {
        tekst: c?.tekst, plek: c?.plek, gevonden, regel, positie_in_document: inDocument,
        bij_weger: gevonden && weger.includes(citaat),
        voorbij_grens: gevonden && inDocument + citaat.length > lib.WEGER_TEKENS,
      };
    });
    const privacy = lib.privacyTreffers([f?.zin, ...citaten.map((c) => c?.tekst)].join(' '));
    if (privacy.length) vormfouten.push(`feit ${nr}: privacycontrole blokkeert ${privacy.join(', ')}`);
    return {
      nr, soort: f?.soort, zin: f?.zin, bewijsstatus: f?.bewijsstatus,
      citaten: gecontroleerdeCitaten,
      gevonden: gecontroleerdeCitaten.length > 0 && gecontroleerdeCitaten.every((c) => c.gevonden),
      bij_weger: gecontroleerdeCitaten.length > 0 && gecontroleerdeCitaten.every((c) => c.bij_weger),
      voorbij_grens: gecontroleerdeCitaten.some((c) => c.voorbij_grens),
      privacy,
    };
  });
  return { vormfouten, waarschuwingen, feiten };
}

async function main(argv = process.argv.slice(2)) {
  const map = path.resolve(optie(argv, '--uittreksels', path.join(lib.STANDAARD_MAP, 'uittreksels')));
  const rapportPad = path.resolve(optie(argv, '--rapport', path.join(map, '..', 'controle-rapport.json')));
  if (!fs.existsSync(map)) throw new Error(`geen map ${map}`);
  const bestanden = fs.readdirSync(map).filter((f) => f.endsWith('.json')).sort();
  if (!bestanden.length) throw new Error(`geen uittreksels in ${map}`);
  const db = lib.openKopie(optie(argv, '--kopie'));
  const rapport = { kopie: null, gemaakt_op: new Date().toISOString(), stukken: [], totaal: {} };
  const t = { stukken: 0, feiten: 0, citaatfouten: 0, vormfouten: 0, waarschuwingen: 0, niet_bij_weger: 0, voorbij_grens: 0, onleesbaar: 0 };
  try {
    rapport.kopie = await lib.kopieDatum(db);
    console.log(`Uittreksels: ${map}\nLokale kopie van ${rapport.kopie}\n`);
    console.log('sleutel              | feiten | citaatfout | niet bij weger | voorbij 4.000 | vorm | oordeel');
    for (const bestand of bestanden) {
      const sleutel = bestand.replace(/\.json$/, '');
      let u;
      try {
        u = JSON.parse(fs.readFileSync(path.join(map, bestand), 'utf8').replace(/^﻿/, ''));
      } catch (e) {
        t.onleesbaar += 1;
        rapport.stukken.push({ sleutel, onleesbaar: e.message });
        console.log(`${sleutel.padEnd(20)} | ONLEESBAAR: ${e.message}`);
        continue;
      }
      const eenheid = await lib.laadEenheid(db, sleutel);
      const r = controleerUittreksel(u, eenheid);
      const fout = r.feiten.filter((f) => !f.gevonden);
      const nietBijWeger = r.feiten.filter((f) => f.gevonden && !f.bij_weger);
      const voorbij = r.feiten.filter((f) => f.voorbij_grens);
      t.stukken += 1; t.feiten += r.feiten.length; t.citaatfouten += fout.length;
      t.vormfouten += r.vormfouten.length; t.waarschuwingen += r.waarschuwingen.length;
      t.niet_bij_weger += nietBijWeger.length; t.voorbij_grens += voorbij.length;
      rapport.stukken.push({
        sleutel, titel: eenheid.titel, bron: `${eenheid.bron_id} ${eenheid.bron}`, url: eenheid.url,
        tekstveld: eenheid.tekstveld, tekens: eenheid.tekens, document_tekens: eenheid.document_tekens,
        begin_in_document: eenheid.begin_in_document, sha: eenheid.sha,
        feiten: r.feiten.length, citaatfouten: fout.length,
        niet_bij_weger: nietBijWeger.length, voorbij_grens: voorbij.length,
        vormfouten: r.vormfouten, waarschuwingen: r.waarschuwingen, per_feit: r.feiten,
      });
      console.log([sleutel.padEnd(20), String(r.feiten.length).padStart(6), String(fout.length).padStart(10),
        String(nietBijWeger.length).padStart(14), String(voorbij.length).padStart(13),
        String(r.vormfouten.length).padStart(4), '-'].join(' | '));
      for (const f of fout) console.log(`   CITAAT NIET GEVONDEN feit ${f.nr}`);
      for (const v of r.vormfouten) console.log(`   VORM ${v}`);
    }
  } finally {
    db.close();
  }
  rapport.totaal = t;
  fs.writeFileSync(rapportPad, JSON.stringify(rapport, null, 2), 'utf8');
  const pct = (n) => (t.feiten ? `${Math.round((1000 * n) / t.feiten) / 10}%` : '-');
  console.log(`\nTotaal: ${t.stukken} uittreksels, ${t.feiten} citaten, ${t.citaatfouten} citaatfouten, ${t.vormfouten} vormfouten, ${t.waarschuwingen} waarschuwingen, ${t.onleesbaar} onleesbaar`);
  console.log(`Niet in wat de weger nu krijgt: ${t.niet_bij_weger} van ${t.feiten} (${pct(t.niet_bij_weger)})`);
  console.log(`Voorbij teken ${lib.WEGER_TEKENS} van het document: ${t.voorbij_grens} van ${t.feiten} (${pct(t.voorbij_grens)})`);
  console.log(`Rapport per feit: ${rapportPad}`);
  if (t.citaatfouten || t.vormfouten || t.onleesbaar) process.exitCode = 1;
}

module.exports = { controleerUittreksel, regelVan, zinnen };

if (require.main === module) {
  main().catch((e) => { console.error(`Mislukt: ${e.message}`); process.exitCode = 1; });
}
