#!/usr/bin/env node
'use strict';

// Ruimt de achterstand aan momentopnamen onder scraper/data/phase3-snapshots op
// (2026-10-04). Sinds dezelfde dag bewaart phase3-core.cjs per URL hoogstens één
// momentopname per twintig uur en geen ongewijzigde kopieën meer; dit script is
// voor wat er al stond (NDW: 29 GB in drie weken).
//
// Wat weg mag:
//  - in elke map: latere kopieën van een bestand met dezelfde hash (de oudste
//    blijft, daar wijst source_snapshots naar);
//  - in mappen van bronnen die elk kwartier ophalen (standaard 'ndw-'): alles
//    behalve de laatste momentopname per dag en de laatste 48 uur.
//
// Standaard droog: het script toont alleen wat het zou doen. Met --apply worden
// de bestanden verwijderd. De rijen in source_snapshots blijven staan als bewijs
// van hash en omvang; hun storage_uri wijst daarna naar een bestand dat weg is.
//
// Gebruik: node scraper/src/snapshot-opruimen.cjs [--apply] [--kwartier ndw-,andere-]

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'phase3-snapshots');
const NAAM = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([0-9a-f]{12})\.gz$/;

function ontleed(naam) {
  const m = String(naam).match(NAAM);
  if (!m) return null;
  return { naam, dag: m[1], tijd: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`), hash: m[6] };
}

/**
 * Welke bestanden in één map mogen weg? `kwartier` = bron die vaak ophaalt.
 * Bestanden met een onbekende naam blijven altijd staan.
 */
function teVerwijderen(namen, { kwartier = false, nu = new Date(), bewaarUren = 48 } = {}) {
  const bestanden = namen.map(ontleed).filter(Boolean).sort((a, b) => a.tijd - b.tijd);
  const weg = new Set();
  const gezien = new Set();
  for (const b of bestanden) {
    if (gezien.has(b.hash)) weg.add(b.naam); else gezien.add(b.hash);
  }
  if (kwartier) {
    const grens = nu.getTime() - bewaarUren * 3600000;
    const laatstePerDag = new Map();
    for (const b of bestanden) if (!weg.has(b.naam)) laatstePerDag.set(b.dag, b.naam);
    const houden = new Set(laatstePerDag.values());
    for (const b of bestanden) {
      if (b.tijd >= grens || houden.has(b.naam)) continue;
      weg.add(b.naam);
    }
  }
  return [...weg];
}

function main(argv = process.argv.slice(2)) {
  const verplaats = argv.includes('--verplaats');
  const apply = argv.includes('--apply') || verplaats;
  // --verplaats verwijdert niets: de bestanden gaan naar de map _te-verwijderen
  // binnen de snapshotmap, zodat iemand die in één keer zelf kan weggooien.
  const doelRoot = path.join(DIR, '_te-verwijderen');
  const i = argv.indexOf('--kwartier');
  const voorvoegsels = (i >= 0 ? argv[i + 1] : 'ndw-').split(',').map((s) => s.trim()).filter(Boolean);
  if (!fs.existsSync(DIR)) { console.log('Geen snapshotmap gevonden.'); return; }
  let totaalAantal = 0, totaalBytes = 0;
  for (const map of fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_te-verwijderen')) {
    const pad = path.join(DIR, map.name);
    const namen = fs.readdirSync(pad);
    const weg = teVerwijderen(namen, { kwartier: voorvoegsels.some((v) => map.name.startsWith(v)) });
    if (!weg.length) continue;
    let bytes = 0;
    for (const naam of weg) {
      const bestand = path.join(pad, naam);
      bytes += fs.statSync(bestand).size;
      if (verplaats) {
        const doel = path.join(doelRoot, map.name);
        fs.mkdirSync(doel, { recursive: true });
        fs.renameSync(bestand, path.join(doel, naam));
      } else if (apply) fs.unlinkSync(bestand);
    }
    totaalAantal += weg.length; totaalBytes += bytes;
    console.log(`${map.name}: ${weg.length} van ${namen.length} bestanden ${verplaats ? 'verplaatst' : apply ? 'verwijderd' : 'kunnen weg'} (${(bytes / 1024 ** 3).toFixed(2)} GB)`);
  }
  const wat = verplaats ? `Verplaatst naar ${doelRoot}` : apply ? 'Verwijderd' : 'Droog: zou verwijderen';
  console.log(`${wat}: ${totaalAantal} bestanden, ${(totaalBytes / 1024 ** 3).toFixed(2)} GB.${apply ? '' : ' Draai met --verplaats of --apply om het uit te voeren.'}`);
}

if (require.main === module) main();

module.exports = { teVerwijderen, ontleed };
