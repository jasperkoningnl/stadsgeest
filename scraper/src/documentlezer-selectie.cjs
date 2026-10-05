#!/usr/bin/env node
'use strict';

// Documentlezer — tellen, kiezen en klaarzetten van grote stukken.
// Leest uitsluitend de lokale kopie (node scraper/src/lokale-kopie.cjs).
// Zie operations/DOCUMENTLEZER.md.
//
//   --tel                    omvang per soort (de eenmalige inhaalslag)
//   --kandidaten             alle documenten boven de drempel, één per regel
//   --exporteer <sleutels>   leesversies en manifest.json schrijven; sleutels
//                            met komma's gescheiden of @bestand met één per
//                            regel (tekst na # is commentaar). Een sleutel
//                            zonder -d<N> wordt zo nodig zelf in knipdelen
//                            uitgeschreven.
// Opties:
//   --drempel 40000          ondergrens in tekens
//   --max 200000             grootste leeseenheid in tekens
//   --sinds JJJJ-MM-DD       bij --kandidaten: binnengekomen sinds
//   --zonder-uittreksel <map> bij --kandidaten: sla over wat daar al een
//                            uittreksel heeft
//   --uit <map>              bij --exporteer; standaard scraper/tmp/documentlezer/teksten
//   --kopie <pad>            andere lokale kopie

const fs = require('fs');
const path = require('path');
const lib = require('./documentlezer-lib.cjs');

function optie(argv, naam, standaard) {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : standaard;
}

const nl = (n) => Number(n || 0).toLocaleString('nl-NL');
const som = (rijen, veld) => rijen.reduce((n, r) => n + Number(r[veld] || 0), 0);

async function laadOverzicht(db) {
  const extra = lib.EXTRA_BRONNEN.join(',') || '0';
  const items = (await db.execute(`
    SELECT r.id, r.source_id, s.name AS bron, s.tier, r.title, r.scraped_at,
           length(coalesce(r.full_text, '')) AS ft, length(coalesce(r.content, '')) AS c,
           (SELECT count(*) FROM raw_item_parts p WHERE p.part_id = r.id) AS is_deel,
           (SELECT count(*) FROM raw_item_parts p WHERE p.parent_id = r.id) AS delen,
           (SELECT coalesce(sum(length(coalesce(d.full_text, ''))), 0) FROM raw_item_parts p
              JOIN raw_items d ON d.id = p.part_id WHERE p.parent_id = r.id) AS deel_tekens,
           (SELECT count(*) FROM raw_item_attachments a WHERE a.raw_item_id = r.id) AS bijlagen,
           (SELECT count(*) FROM signal_items si WHERE si.raw_item_id = r.id) AS signalen
    FROM raw_items r JOIN sources s ON s.id = r.source_id
    WHERE s.tier = 1 OR s.id IN (${extra})`)).rows;
  const bijlagen = (await db.execute(`
    SELECT a.id, a.raw_item_id, a.titel, length(coalesce(a.tekst, '')) AS t, a.paginas, a.opgehaald_at,
           r.title AS item_titel, r.source_id, s.name AS bron, s.tier
    FROM raw_item_attachments a JOIN raw_items r ON r.id = a.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE s.tier = 1 OR s.id IN (${extra})`)).rows;
  return { items, bijlagen };
}

async function tel(db, drempel, max) {
  const { items, bijlagen } = await laadOverzicht(db);
  const extra = new Set(lib.EXTRA_BRONNEN);
  const lengte = (r) => Math.max(Number(r.ft), Number(r.c));
  const tier1 = items.filter((r) => Number(r.tier) === 1);
  const hoofd = tier1.filter((r) => !Number(r.is_deel));
  const A = hoofd.filter((r) => Number(r.ft) > drempel);
  const B = bijlagen.filter((r) => Number(r.tier) === 1 && Number(r.t) > drempel);
  const C = tier1.filter((r) => Number(r.is_deel));
  const ouders = tier1.filter((r) => Number(r.delen) > 0).length;
  const BW = items.filter((r) => extra.has(Number(r.source_id)) && lengte(r) > drempel);

  console.log(`Drempel ${nl(drempel)} tekens; lokale kopie van ${await lib.kopieDatum(db)}\n`);
  console.log('Per soort (tier 1):');
  console.log(`  raw_items.full_text           ${nl(A.length)} stukken, ${nl(som(A, 'ft'))} tekens`
    + ` (waarvan ${nl(A.filter((r) => Number(r.bijlagen)).length)} items waarvan de tekst uit bijlagen bestaat)`);
  console.log(`  raw_item_attachments.tekst    ${nl(B.length)} bijlagen, ${nl(som(B, 't'))} tekens`);
  console.log(`  raw_item_parts (deelitems)    ${nl(C.length)} delen bij ${nl(ouders)} documenten, ${nl(som(C, 'ft'))} tekens`
    + ` (${nl(C.filter((r) => Number(r.ft) > drempel).length)} delen boven de drempel)`);
  console.log(`  bron ${[...extra].join(', ')} (tier 2, tekst in content): ${nl(BW.length)} stukken, ${nl(BW.reduce((n, r) => n + lengte(r), 0))} tekens`);

  // Zonder dubbeltelling: een document is een hoofditem plus zijn deelitems.
  // Items met bijlagen tellen hier via hun samengevoegde tekst, niet per bijlage.
  const docs = items.filter((r) => !Number(r.is_deel) && lengte(r) > drempel);
  const perBron = new Map();
  const perMaand = new Map();
  let tekens = 0;
  let beurten = 0;
  for (const d of docs) {
    const t = lengte(d) + Number(d.deel_tekens);
    const b = Math.ceil(lengte(d) / max) + Number(d.delen);
    tekens += t; beurten += b;
    const k = `${d.source_id} ${d.bron}`;
    const p = perBron.get(k) || { n: 0, tekens: 0, beurten: 0, metSignaal: 0 };
    p.n += 1; p.tekens += t; p.beurten += b; p.metSignaal += Number(d.signalen) > 0 ? 1 : 0;
    perBron.set(k, p);
    const m = String(d.scraped_at || '').slice(0, 7);
    perMaand.set(m, (perMaand.get(m) || 0) + 1);
  }
  console.log('\nZonder dubbeltelling (hoofditem plus deelitems = één document):');
  console.log(`  ${nl(docs.length)} documenten, ${nl(beurten)} leesbeurten van hoogstens ${nl(max)} tekens, ${nl(tekens)} tekens`);
  console.log('\nPer bron (documenten | leesbeurten | tekens | met signaal):');
  for (const [k, p] of [...perBron].sort((a, b) => b[1].tekens - a[1].tekens)) {
    console.log(`  ${k.padEnd(62).slice(0, 62)} ${String(p.n).padStart(4)} | ${String(p.beurten).padStart(4)} | ${nl(p.tekens).padStart(11)} | ${String(p.metSignaal).padStart(4)}`);
  }
  console.log('\nBinnengekomen per maand (scraped_at; inhaalslagen tellen mee):');
  for (const [m, n] of [...perMaand].sort()) console.log(`  ${m}  ${n}`);
}

function heeftUittreksel(map, sleutel) {
  return fs.existsSync(path.join(map, `${sleutel}.json`)) || fs.existsSync(path.join(map, `${sleutel}-d1.json`));
}

async function kandidaten(db, drempel, sinds, zonder) {
  const { items, bijlagen } = await laadOverzicht(db);
  const rijen = [];
  for (const r of items) {
    const lengte = Math.max(Number(r.ft), Number(r.c));
    if (lengte <= drempel || (sinds && String(r.scraped_at) < sinds)) continue;
    rijen.push({
      sleutel: `item-${r.id}`, soort: Number(r.is_deel) ? 'deelitem' : 'item', bron: `${r.source_id} ${r.bron}`,
      tekens: lengte, extra: Number(r.delen) ? `+${r.delen} deelitems` : '', datum: String(r.scraped_at).slice(0, 10),
      signaal: Number(r.is_deel) ? '' : (Number(r.signalen) > 0 ? 'signaal' : 'geen signaal'), titel: r.title,
    });
  }
  for (const a of bijlagen) {
    if (Number(a.t) <= drempel || (sinds && String(a.opgehaald_at) < sinds)) continue;
    rijen.push({
      sleutel: `bijlage-${a.id}`, soort: 'bijlage', bron: `${a.source_id} ${a.bron}`, tekens: Number(a.t),
      extra: a.paginas ? `${a.paginas} blz.` : '', datum: String(a.opgehaald_at).slice(0, 10), signaal: '',
      titel: `${a.item_titel} — ${a.titel}`,
    });
  }
  const over = zonder ? rijen.filter((r) => !heeftUittreksel(zonder, r.sleutel)) : rijen;
  over.sort((x, y) => x.bron.localeCompare(y.bron) || y.tekens - x.tekens);
  for (const r of over) {
    console.log([r.sleutel, r.soort, r.bron, nl(r.tekens), r.extra, r.datum, r.signaal,
      String(r.titel || '').replace(/\s+/g, ' ').slice(0, 140)].join(' | '));
  }
  console.log(`(${over.length} kandidaten${zonder ? `, ${rijen.length - over.length} al gelezen` : ''})`);
}

async function exporteer(db, invoer, uit, max) {
  const ruwe = invoer.startsWith('@')
    ? fs.readFileSync(invoer.slice(1), 'utf8').split(/\r?\n/)
    : invoer.split(',');
  const gevraagd = ruwe.map((s) => s.replace(/#.*$/, '').trim()).filter(Boolean);
  fs.mkdirSync(uit, { recursive: true });
  const manifest = [];
  for (const g of gevraagd) {
    const { soort, id, knipdeel } = lib.ontleedSleutel(g);
    const sleutels = knipdeel ? [g] : await lib.sleutelsVan(db, soort, id, max);
    for (const sleutel of sleutels) {
      const e = await lib.laadEenheid(db, sleutel, max);
      const tekst = lib.leesversie(e.tekst);
      const bestand = `${e.sleutel}.txt`;
      const regels = tekst.split('\n').length;
      fs.writeFileSync(path.join(uit, bestand), tekst, 'utf8');
      manifest.push({
        sleutel: e.sleutel, bestand, titel: e.titel, bron: `${e.bron_id} ${e.bron}`, url: e.url, datum: e.datum,
        raw_item_id: e.raw_item_id, hoofditem_id: e.hoofditem_id, bijlage_id: e.bijlage_id,
        tekstveld: e.tekstveld, tekens: e.tekens, document_tekens: e.document_tekens, regels,
        knip: e.knip, deelitem: e.deelitem, heeft_deelitems: e.heeft_deelitems, sha: e.sha,
      });
      console.log(`${e.sleutel}: ${nl(e.tekens)} tekens, ${nl(regels)} regels — ${String(e.titel).replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  fs.writeFileSync(path.join(uit, 'manifest.json'),
    JSON.stringify({ kopie: await lib.kopieDatum(db), max, eenheden: manifest }, null, 2), 'utf8');
  console.log(`Klaar: ${manifest.length} leeseenheden in ${uit}`);
}

async function main(argv = process.argv.slice(2)) {
  const drempel = Number(optie(argv, '--drempel', 40000));
  const max = Number(optie(argv, '--max', lib.MAX_EENHEID));
  const db = lib.openKopie(optie(argv, '--kopie'));
  try {
    if (argv.includes('--tel')) await tel(db, drempel, max);
    else if (argv.includes('--kandidaten')) await kandidaten(db, drempel, optie(argv, '--sinds'), optie(argv, '--zonder-uittreksel'));
    else if (argv.includes('--exporteer')) {
      await exporteer(db, optie(argv, '--exporteer'), path.resolve(optie(argv, '--uit', path.join(lib.STANDAARD_MAP, 'teksten'))), max);
    } else {
      console.log('Gebruik: --tel | --kandidaten [--sinds datum] [--zonder-uittreksel map] | --exporteer <sleutels|@bestand> [--uit map]');
    }
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`Mislukt: ${e.message}`); process.exitCode = 1; });
}
