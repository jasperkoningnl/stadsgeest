// destadsbron.js — De Stadsbron, onderzoeksjournalistiek platform in
// Amersfoort, spiegelbron. Toegevoegd 2026-10-02.
//
// Waarom: De Stadsbron staat in docs/EDITORIAL-PROFILE.md als spiegelbron en
// in migrate-tips.cjs als te markeren naam, maar had geen bronrij. Zij
// publiceert enkele langere stukken per maand over precies de onderwerpen
// waar Stadsgeest tips over maakt (warmtenet, woningbouw, gemeentefinanciën);
// zonder deze bron kon de weger niet zien dat zij er al over schreven.
//
// Geen RSS (het CMS Hypha); de voorpagina toont de vijftien nieuwste
// artikelen met datum en samenvatting (destadsbron-lib.mjs). De samenvatting
// is de inhoud: voor ontdubbeling en bevestiging is dat genoeg, en het
// scheelt per run veertien extra pagina's.
//
// Spiegelbron: nooit dragend (zie intake-run.mjs); bronrol op de bronrij.
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';
import { BASIS, parseLijst } from '../destadsbron-lib.mjs';

const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';
const NAAM = 'De Stadsbron';
const DRY = process.env.STADSBRON_DRYRUN === '1';

async function scrape() {
  const r = await fetch(BASIS, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`De Stadsbron HTTP ${r.status}`);
  const artikelen = parseLijst(await r.text());
  if (artikelen.length === 0) throw new Error('De Stadsbron: geen artikelen gevonden op de voorpagina (opmaak gewijzigd?)');

  if (DRY) {
    for (const a of artikelen) console.log(`  [dry] ${a.datum || '-'} | ${a.titel} | ${a.auteur || '-'} | ${a.url} | ${a.samenvatting.length} tekens`);
    console.log(`destadsbron: ${artikelen.length} artikelen (dry-run, niets opgeslagen)`);
    return;
  }

  const sourceId = await getOrCreateSource(db, {
    name: NAAM, url: BASIS, sourceType: 'scrape', reliability: 'secondary', category: 'local_news', scrapeFrequency: 'daily',
  });
  await db.execute({
    sql: "UPDATE sources SET bronrol = 'spiegel', tier = 3, gemeente = 'Amersfoort' WHERE id = ? AND bronrol IS NULL",
    args: [sourceId],
  }).catch((e) => console.error('destadsbron: bronrol niet gezet:', e.message));

  let saved = 0, skipped = 0, errors = 0;
  for (const a of artikelen) {
    try {
      const inhoud = [a.auteur ? `Door ${a.auteur}` : null, a.samenvatting].filter(Boolean).join('\n\n');
      const result = await saveRawItem(db, {
        sourceId, externalUrl: a.url, title: a.titel, content: inhoud, summary: a.samenvatting.slice(0, 500), publishedAt: a.datum,
      });
      if (result.saved) saved++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`destadsbron: fout bij "${a.titel}":`, err.message);
    }
  }
  await logResult(db, sourceId, NAAM, saved, skipped, errors, artikelen.length);
}

scrape().then(() => process.exit(0)).catch((e) => { console.error('destadsbron:', e.message); process.exit(1); });
