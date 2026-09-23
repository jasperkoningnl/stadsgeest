// insolventies.js — Centraal Insolventieregister (CIR), alleen rechtspersonen in
// Amersfoort en Leusden. Toegevoegd 2026-09-23.
//
// Bron: de openbare dagoverzichten van insolventies.rechtspraak.nl.
//   /Services/BekendmakingenService/getAll/        → lijst van beschikbare dagen (±1 maand)
//   /Services/BekendmakingenService/haalOp/{Id}    → alle publicaties van die dag (JSON)
// Geen sleutel nodig; dit zijn dezelfde GET-verzoeken die de site zelf doet.
//
// Privacy: het register bevat ook schuldsaneringen en faillissementen van
// natuurlijke personen (met geboortedatum en woonadres). Die slaan we NIET op.
// We houden alleen publicaties over zonder geboortedatum ("geb."), zonder
// woonadres en buiten de schuldsaneringsclusters, met een vestigingsadres in
// het werkgebied. Een eenmanszaak (persoon h.o.d.n. bedrijf) valt daarmee
// bewust buiten de bron.

import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';
import { beoordeel } from '../insolventies-lib.js';

const BASIS = 'https://insolventies.rechtspraak.nl/Services/BekendmakingenService';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';

async function haal(pad) {
  const r = await fetch(`${BASIS}/${pad}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`CIR HTTP ${r.status} voor ${pad}`);
  return r.json();
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'Centraal Insolventieregister — Amersfoort',
    url: 'https://insolventies.rechtspraak.nl/',
    sourceType: 'api',
    reliability: 'primary',
    category: 'registry',
    scrapeFrequency: 'daily',
  });

  const dagen = await haal('getAll/');
  let saved = 0, skipped = 0, errors = 0, gevonden = 0;

  for (const dag of dagen) {
    try {
      const data = await haal(`haalOp/${dag.Id}`);
      for (const inst of data.Instanties || []) {
        for (const cl of inst.Publicatieclusters || []) {
          for (const ps of cl.Publicatiesoorten || []) {
            for (const loc of ps.PublicatiesNaarLocatie || []) {
              for (const tekst of loc.Publicaties || []) {
                const b = beoordeel(cl.PublicatieclusterOmschrijving || '', ps.PublicatiesoortCaption || '', tekst);
                if (!b) continue;
                gevonden++;
                const soort = [cl.PublicatieclusterOmschrijving, ps.PublicatiesoortCaption].filter(Boolean).join(' — ');
                const datum = `${dag.Id.slice(0, 4)}-${dag.Id.slice(4, 6)}-${dag.Id.slice(6, 8)}`;
                const res = await saveRawItem(db, {
                  sourceId,
                  externalUrl: `${BASIS}/haalOp/${dag.Id}#${b.kenmerk || ''}`,
                  title: `Insolventie: ${b.naam || 'onbekende rechtspersoon'} (${b.kenmerk || 'zonder kenmerk'}) — ${soort}`,
                  content: [
                    tekst,
                    '',
                    `Publicerende instantie: ${inst.PublicerendeInstantieOmschrijving}.`,
                    `Soort publicatie: ${soort}.`,
                    b.kvk ? `KvK-nummer: ${b.kvk}.` : '',
                    `Vestigingsadres: ${b.vestiging}.`,
                    b.curator ? `Curator: ${b.curator}.` : '',
                  ].filter(r => r !== '').join('\n'),
                  summary: `${soort}: ${b.naam || ''}, ${b.vestiging}`.substring(0, 500),
                  publishedAt: datum,
                });
                if (res.saved) saved++; else skipped++;
              }
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors++;
      console.error(`CIR dag ${dag.Id}: ${err.message}`);
    }
  }

  console.log(`CIR: ${dagen.length} dagen gelezen, ${gevonden} lokale rechtspersonen, ${saved} nieuw`);
  await logResult(db, sourceId, 'Centraal Insolventieregister — Amersfoort', saved, skipped, errors, gevonden);
}

// Alleen draaien als script, niet bij import in een test.
if (process.argv[1] && process.argv[1].endsWith('insolventies.js')) {
  scrape().catch(err => { console.error(err); process.exitCode = 1; });
}
