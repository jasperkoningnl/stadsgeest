// backfill-tenderned-partijen.js — eenmalige/periodieke inhaalslag van partijen uit
// gegunde opdrachten (AGO) op TenderNed die "Amersfoort" of "Leusden" noemen.
// Schrijft alleen naar tender_parties, niet naar raw_items: zo ontstaat er geen
// golf aan signalen, maar wel een koppelbare lijst van winnaars met KvK en adres.
//
// Aanroep (vanuit scraper/): node src/backfill-tenderned-partijen.js [--zoek amersfoort,leusden] [--max 5000]
import db from './db.js';
import { pdfNaarRegels, parsePartijen, winnaarsWaarde, zorgVoorTabel, slaPartijenOp } from './tenderned-partijen.js';

const API = 'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties';
const UA = 'Stadsgeest033/1.0 (nieuwssite; contact@stadsgeest.nl)';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const ZOEK = arg('--zoek', 'amersfoort,leusden').split(',');
const MAX = Number(arg('--max', '5000'));
const wacht = ms => new Promise(r => setTimeout(r, ms));

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function lijst(term) {
  const uit = [];
  for (let page = 0; page < 100; page++) {
    const d = await json(`${API}?page=${page}&size=100&search=${encodeURIComponent(term)}`);
    uit.push(...(d.content || []));
    if (d.last || !(d.content || []).length) break;
    await wacht(300);
  }
  return uit;
}

async function main() {
  await zorgVoorTabel(db);
  const gezien = new Set((await db.execute('SELECT DISTINCT publicatie_id FROM tender_parties')).rows.map(r => String(r.publicatie_id)));
  const kandidaten = new Map();
  for (const term of ZOEK) {
    for (const p of await lijst(term)) {
      if (p.typePublicatie?.code === 'AGO' && !gezien.has(String(p.publicatieId))) kandidaten.set(String(p.publicatieId), p);
    }
  }
  console.log(`Backfill TenderNed: ${kandidaten.size} gegunde opdrachten nog te verwerken (zoektermen: ${ZOEK.join(', ')})`);

  let verwerkt = 0, rijen = 0, leeg = 0, fouten = 0;
  for (const p of [...kandidaten.values()].slice(0, MAX)) {
    try {
      const r = await fetch(`${API}/${p.publicatieId}/pdf`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(`PDF HTTP ${r.status}`);
      const regels = await pdfNaarRegels(Buffer.from(await r.arrayBuffer()));
      const partijen = parsePartijen(regels);
      if (!partijen.length) leeg++;
      rijen += await slaPartijenOp(db, {
        publicatieId: p.publicatieId, kenmerk: p.kenmerk, publicatieDatum: p.publicatieDatum, type: 'AGO',
        aanbestedingNaam: p.aanbestedingNaam, opdrachtgeverNaam: p.opdrachtgeverNaam,
        url: p.link?.href || `https://www.tenderned.nl/aankondigingen/overzicht/${p.publicatieId}`,
      }, partijen, winnaarsWaarde(regels));
    } catch (e) {
      fouten++;
      console.error(`Publicatie ${p.publicatieId}: ${e.message}`);
    }
    verwerkt++;
    if (verwerkt % 100 === 0) console.log(`  ${verwerkt} verwerkt, ${rijen} rijen, ${leeg} zonder partijen, ${fouten} fouten`);
    await wacht(700);
  }
  console.log(`Klaar: ${verwerkt} publicaties, ${rijen} partijrijen, ${leeg} zonder hoofdstuk 8, ${fouten} fouten`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
