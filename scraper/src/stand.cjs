#!/usr/bin/env node
'use strict';

// Genereert docs/STAND.md: de telbare stand van Stadsgeest (bronnen, runs,
// signalen, tips, taken). docs/CURRENT.md bevat de vaste tekst; cijfers horen
// hier, zodat ze niet met de hand verouderen.
//
// Gebruik (op de notebook, vanuit de repowortel):
//   node scraper/src/stand.cjs            leest Turso (circa 50.000 reads) en schrijft docs/STAND.md
//   node scraper/src/stand.cjs --lokaal   leest de lokale kopie (geen reads)
//   node scraper/src/stand.cjs --droog    drukt af zonder te schrijven
//
// Geen namen van redacteuren in de uitvoer: de repo is publiek.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { falendeScrapers } = require('./bewaking-lib.cjs');

const UIT = path.join(__dirname, '..', '..', 'docs', 'STAND.md');
const KOPIE = process.env.STADSGEEST_KOPIE || path.join(__dirname, '..', 'tmp', 'kopie', 'stadsgeest.db');

function dag(nu, dagenTerug) {
  return new Date(nu.getTime() - dagenTerug * 86400000).toISOString().substring(0, 10);
}

function getal(n) {
  return Number(n || 0).toLocaleString('nl-NL');
}

function tabel(koppen, rijen) {
  if (rijen.length === 0) return '_Geen gegevens._';
  return [`| ${koppen.join(' | ')} |`, `|${koppen.map(() => '---').join('|')}|`,
    ...rijen.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function telling(rijen, sleutel = 'k', waarde = 'n') {
  return rijen.map((r) => `${r[sleutel] ?? 'leeg'} ${getal(r[waarde])}`).join(', ') || 'geen';
}

async function verzamel(db, nu) {
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  const d3 = dag(nu, 3); const d7 = dag(nu, 7); const d30 = dag(nu, 30);
  const d = { sinds: { d3, d7, d30 } };
  d.bronnen = await q("SELECT tier, COALESCE(bronrol,'') bronrol, COALESCE(is_active,1) actief, COUNT(*) n FROM sources GROUP BY 1,2,3");
  d.gezondheid = await q("SELECT COALESCE(health,'ok') k, COUNT(*) n FROM sources WHERE COALESCE(is_active,1) = 1 GROUP BY 1 ORDER BY 2 DESC");
  d.runs = await q('SELECT status k, COUNT(*) n FROM scrape_runs WHERE started_at >= ? GROUP BY 1 ORDER BY 2 DESC', [d3]);
  d.falend = falendeScrapers(await q('SELECT scraper_file, status, started_at FROM scrape_runs WHERE started_at >= ? AND scraper_file IS NOT NULL', [d7]));
  d.intake = await q('SELECT decision k, COUNT(*) n FROM intake_decisions WHERE created_at >= ? GROUP BY 1 ORDER BY 2 DESC', [d7]);
  d.items = (await q('SELECT COUNT(*) n, MAX(scraped_at) laatste FROM raw_items'))[0];
  d.deelitems = (await q('SELECT COUNT(*) n FROM raw_item_parts'))[0].n;
  d.signalen = await q('SELECT status k, COUNT(*) n FROM signals GROUP BY 1 ORDER BY 2 DESC');
  d.signalen30 = (await q('SELECT COUNT(*) n, SUM(detection_rule IS NOT NULL) regels FROM signals WHERE created_at >= ?', [d30]))[0];
  d.perDag = await q('SELECT substr(created_at,1,10) k, COUNT(*) n FROM signals WHERE created_at >= ? GROUP BY 1 ORDER BY 1', [d7]);
  d.meerBron = (await q(`SELECT COUNT(*) n, COALESCE(SUM(bronnen > 1),0) meer FROM (
      SELECT si.signal_id, COUNT(DISTINCT ri.source_id) bronnen
      FROM signals s JOIN signal_items si ON si.signal_id = s.id JOIN raw_items ri ON ri.id = si.raw_item_id
      WHERE s.created_at >= ? GROUP BY si.signal_id)`, [d30]))[0];
  d.tips = await q('SELECT status k, COUNT(*) n FROM tips GROUP BY 1 ORDER BY 2 DESC');
  d.tipsPerMaand = await q('SELECT substr(created_at,1,7) k, COUNT(*) n FROM tips GROUP BY 1 ORDER BY 1');
  d.tipsOud = (await q("SELECT COUNT(*) n FROM tips WHERE status = 'wachtrij' AND created_at < ?", [d30]))[0].n;
  d.laatsteTip = (await q('SELECT MAX(created_at) m FROM tips'))[0].m;
  d.beslissingen = (await q('SELECT COUNT(*) n, MAX(created_at) laatste, COUNT(DISTINCT gebruiker) wie FROM tip_feedback'))[0];
  d.artikelen = (await q("SELECT COUNT(*) n, COALESCE(SUM(without_stadsgeest = 1),0) zonder FROM editorial_outcomes WHERE status = 'published'"))[0];
  d.dossiers = (await q('SELECT COUNT(*) n FROM dossiers'))[0].n;
  d.feiten = (await q("SELECT COUNT(*) n, COALESCE(SUM(zekerheid = 'officieel'),0) officieel FROM dossier_facts"))[0];
  d.kg = await q('SELECT entity_type k, COUNT(*) n FROM kg_entities WHERE merged_into_id IS NULL GROUP BY 1 ORDER BY 2 DESC');
  d.golden = await q('SELECT verdict k, COUNT(*) n FROM phase1_golden_reviews GROUP BY 1 ORDER BY 2 DESC');
  d.bijlagen = await q("SELECT status || COALESCE(' (' || tekstbron || ')','') k, COUNT(*) n, COALESCE(SUM(tekens),0) tekens FROM raw_item_attachments GROUP BY 1 ORDER BY 2 DESC");
  return d;
}

function powershell(commando) {
  if (process.platform !== 'win32') return null;
  try {
    const uit = execFileSync('powershell.exe', ['-NoProfile', '-Command', commando], { encoding: 'utf8', timeout: 30000 }).trim();
    return uit ? JSON.parse(uit) : null;
  } catch { return null; }
}

function machine() {
  const m = { taken: null, pm2: null, vrijGb: null };
  const taken = powershell("Get-ScheduledTask -TaskName 'Stadsgeest*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ naam = $_.TaskName; staat = \"$($_.State)\"; laatste = $i.LastRunTime.ToString('yyyy-MM-dd HH:mm'); resultaat = $i.LastTaskResult } } | ConvertTo-Json -Compress");
  if (taken) m.taken = Array.isArray(taken) ? taken : [taken];
  const schijf = powershell('[pscustomobject]@{ vrij = [math]::Round((Get-PSDrive C).Free / 1GB) } | ConvertTo-Json -Compress');
  if (schijf) m.vrijGb = schijf.vrij;
  if (process.platform === 'win32') {
    try {
      // Alleen lezen. Nooit `pm2 save` vanuit dit script (zie AGENTS.md).
      const lijst = JSON.parse(execFileSync('cmd.exe', ['/c', 'pm2', 'jlist'], { encoding: 'utf8', timeout: 30000 }).trim().split(/\r?\n/).pop());
      m.pm2 = lijst.map((p) => ({ naam: p.name, status: p.pm2_env?.status }));
    } catch { m.pm2 = null; }
  }
  return m;
}

function maakMarkdown(d, m, teller, meta) {
  const actief = d.bronnen.filter((r) => Number(r.actief) === 1);
  const som = (rijen) => rijen.reduce((s, r) => s + Number(r.n), 0);
  const perTier = [1, 2, 3].map((t) => `tier ${t}: ${som(actief.filter((r) => Number(r.tier) === t))}`).join(', ');
  const spiegel = som(actief.filter((r) => r.bronrol === 'spiegel'));
  const golden = Object.fromEntries(d.golden.map((r) => [r.k, Number(r.n)]));
  const beoordeeld = (golden.same || 0) + (golden.different || 0);
  const regels = [
    '# Stand — gegenereerd',
    '',
    `**Gegenereerd:** ${meta.moment} uit ${meta.bron}.`,
    '**Niet met de hand bewerken.** Opnieuw maken: `npm run stand` op de notebook.',
    'Duiding en vaste afspraken staan in `CURRENT.md`; dit bestand bevat alleen tellingen.',
    '',
    '## Bronnen en runs',
    '',
    `- Bronrijen: ${getal(som(d.bronnen))}, waarvan ${getal(som(actief))} actief (${perTier}; ${spiegel} spiegel).`,
    `- Gezondheid actieve bronnen: ${telling(d.gezondheid)}.`,
    `- Scraperruns sinds ${d.sinds.d3}: ${telling(d.runs)}.`,
    `- Scrapers met drie of meer fouten of timeouts op rij (sinds ${d.sinds.d7}): ${d.falend.length === 0 ? 'geen' : d.falend.map((f) => `${f.scraper} (${f.aantal}×, ${f.status}, sinds ${f.sinds})`).join('; ')}.`,
    `- Items: ${getal(d.items.n)}, nieuwste van ${String(d.items.laatste || '').substring(0, 16)}; deelitems: ${getal(d.deelitems)}.`,
    `- Bijlagen: ${d.bijlagen.map((r) => `${r.k} ${getal(r.n)}${Number(r.tekens) ? ` (${(Number(r.tekens) / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mln tekens)` : ''}`).join(', ') || 'geen'}.`,
    '',
    '## Intake en signalen',
    '',
    `- Intakebeslissingen sinds ${d.sinds.d7}: ${telling(d.intake)}.`,
    `- Signalen in totaal: ${telling(d.signalen)}.`,
    `- Signalen sinds ${d.sinds.d30}: ${getal(d.signalen30.n)}, waarvan ${getal(d.signalen30.regels)} uit detectieregels.`,
    `- Signalen met meer dan één bron sinds ${d.sinds.d30}: ${getal(d.meerBron.meer)} van ${getal(d.meerBron.n)}.`,
    `- Nieuwe signalen per dag sinds ${d.sinds.d7}: ${d.perDag.map((r) => `${String(r.k).substring(5)}: ${r.n}`).join(', ') || 'geen'}.`,
    '',
    '## Tips en redactie',
    '',
    `- Tips: ${getal(som(d.tips))} (${telling(d.tips)}); laatste aangemaakt ${String(d.laatsteTip || '').substring(0, 16)}.`,
    `- Tips per maand: ${telling(d.tipsPerMaand)}.`,
    `- Wachtrijtips van vóór ${d.sinds.d30}: ${getal(d.tipsOud)}.`,
    `- Redactiebeslissingen: ${getal(d.beslissingen.n)} door ${getal(d.beslissingen.wie)} accounts; laatste op ${String(d.beslissingen.laatste || '').substring(0, 10)}.`,
    `- Gepubliceerde artikelen bij een tip: ${getal(d.artikelen.n)}, waarvan ${getal(d.artikelen.zonder)} die er volgens de redactie zonder Stadsgeest niet waren geweest.`,
    `- Dossiers: ${getal(d.dossiers)} met ${getal(d.feiten.n)} feiten, waarvan ${getal(d.feiten.officieel)} officieel.`,
    '',
    '## Kennisgraaf',
    '',
    `- Entiteiten (niet samengevoegd): ${telling(d.kg)}.`,
    `- Golden set fase 1: ${getal(beoordeeld)} beoordeeld (zelfde ${getal(golden.same)}, anders ${getal(golden.different)}), ${getal(golden.skipped)} overgeslagen; precisie ${beoordeeld ? ((100 * (golden.same || 0)) / beoordeeld).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) : '–'}% (eis: 200 beoordeeld, 98%).`,
    '',
    '## Machine en verbruik',
    '',
  ];
  if (teller) regels.push(`- Turso: ${(teller.gelezen / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 0 })} mln gelezen rijen deze maand; plan ${teller.plan}${teller.limiet ? `, limiet ${(teller.limiet / 1e6).toLocaleString('nl-NL')} mln` : ''}.`);
  else regels.push('- Turso: teller niet beschikbaar.');
  if (m.vrijGb !== null) regels.push(`- Schijf C: ${getal(m.vrijGb)} GB vrij.`);
  if (m.pm2) regels.push(`- PM2: ${m.pm2.length} jobs (${[...new Set(m.pm2.map((p) => p.status))].map((s) => `${s} ${m.pm2.filter((p) => p.status === s).length}`).join(', ')}); \`stopped\` tussen runs is normaal.`);
  else regels.push('- PM2: niet uitgelezen.');
  regels.push('');
  if (m.taken) {
    regels.push(tabel(['Geplande taak', 'Staat', 'Laatste run', 'Resultaat'], m.taken.map((t) => [t.naam, t.staat, t.laatste, String(t.resultaat)])));
  } else {
    regels.push('_Geplande taken niet uitgelezen (alleen op de notebook)._');
  }
  regels.push('');
  return regels.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const { createClient } = require('@libsql/client');
  const lokaal = argv.includes('--lokaal');
  const nu = new Date();
  if (lokaal && !fs.existsSync(KOPIE)) throw new Error(`geen lokale kopie op ${KOPIE}`);
  const db = lokaal
    ? createClient({ url: `file:${KOPIE.replace(/\\/g, '/')}` })
    : createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  let d; let bron = 'Turso';
  try {
    if (lokaal) {
      const meta = await db.execute('SELECT gemaakt_op FROM _kopie_meta').catch(() => null);
      bron = `de lokale kopie van ${String(meta?.rows[0]?.gemaakt_op || 'onbekend').substring(0, 16).replace('T', ' ')} UTC`;
    }
    d = await verzamel(db, nu);
  } finally {
    db.close();
  }
  const teller = await require('./turso-teller.cjs').stand().catch(() => null);
  const moment = `${nu.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).substring(0, 16)} uur`;
  const md = maakMarkdown(d, machine(), teller, { moment, bron });
  if (argv.includes('--droog')) { console.log(md); return; }
  fs.writeFileSync(UIT, md, 'utf8');
  console.log(`Stand geschreven naar ${path.relative(process.cwd(), UIT)} (${bron}).`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`Stand mislukt: ${e.message}`); process.exitCode = 1; });
}

module.exports = { maakMarkdown, tabel, dag };
