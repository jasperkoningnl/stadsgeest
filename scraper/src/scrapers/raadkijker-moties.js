// Moties en amendementen van de gemeenteraad Amersfoort via RaadKijker
// (raadkijker.nl/open-data). Toegevoegd 23 september 2026.
//
// Waarom: de stromen 'Raad Amersfoort — Moties' (116) en '— Amendementen' (117)
// kregen sinds 15 juli niets meer binnen. ORI indexeert de nieuwe moties niet of
// laat, en de Notubiz-modulepagina's zitten achter Cloudflare. RaadKijker heeft
// een lijst van alle Amersfoortse moties met uitslag, indienende partij en de
// link naar de Notubiz-PDF. Op 23 september ontbraken 38 van de 84 moties sinds
// 1 juni in raw_items, en 19 van de aanwezige hadden geen fulltext.
//
// Wat deze scraper doet:
// 1. Haalt de nieuwste moties op (lijst is nieuwste eerst) binnen een venster.
// 2. Nieuw (niet op document-id en niet op motienummer bekend): nieuw raw_item
//    onder 116 of 117, met als tekst de Notubiz-PDF. Lukt die download niet,
//    dan de `document_tekst` van RaadKijker (meestal alleen het dictum).
// 3. Bekend: vult een ontbrekende fulltext aan en zet een uitslag vooraan de
//    titel ("AANGENOMEN Motie ..."), maar alleen als RaadKijker het gestempelde
//    stuk van de griffie heeft; het veld `uitslag` wordt niet vertrouwd (zie
//    raadkijker.mjs). Een late uitslag maakt dus géén nieuw raw_item en dus geen
//    nieuw signaal. Dat is een bewuste keuze voor nu; zie docs/SOURCES.md.
//
// Wat RaadKijker níét levert voor Amersfoort: stemgedrag per raadslid (leeg) en
// onderwerptags (leeg). De bron-url in raw_items is de Notubiz-PDF, niet
// RaadKijker: provenance blijft het officiële stuk.
//
// Grenzen: run-all.js geeft elke scraper 60 seconden. Daarom een tijdsbudget en
// een maximum aan PDF's per run; de rest komt de volgende dag. RaadKijker staat
// 60 verzoeken per minuut toe, dus minimaal een seconde tussen API-aanroepen.
// Cloudflare blokkeert RaadKijker vanaf datacenter-IP's; dit draait alleen goed
// op de notebook.
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult, makeSummary } from '../utils.js';
import {
  motieSleutel, zelfdeMotie, notubizDocumentId, normaliseerNotubizUrl,
  uitslagWijziging, inhoudskop, isBruikbaar,
} from '../raadkijker.mjs';

const API = 'https://raadkijker.nl/api/v1';
const UA = 'Stadsgeest033/1.0 (redactie@stadsgeest.nl)';
const SLEUTEL = process.env.RAADKIJKER_API_KEY;
// Twee vensters. Nieuwe raw_items alleen voor moties van de laatste DAGEN, zodat
// oude moties geen verse signalen worden. Bestaande items krijgen tot
// DAGEN_AANVUL terug nog fulltext en uitslag; dat maakt geen nieuwe signalen.
const DAGEN = parseInt(process.env.RAADKIJKER_DAGEN || '60', 10);
const DAGEN_AANVUL = Math.max(DAGEN, parseInt(process.env.RAADKIJKER_DAGEN_AANVUL || '180', 10));
const MAX_PDF = parseInt(process.env.RAADKIJKER_MAX_PDF || '15', 10);
const BUDGET_MS = parseInt(process.env.RAADKIJKER_BUDGET_MS || '45000', 10);
const START = Date.now();
// RAADKIJKER_DRYRUN=1: alles ophalen en tonen, niets wegschrijven.
const DRY = process.env.RAADKIJKER_DRYRUN === '1';
const BASIS_RAAD = 'https://amersfoort.raadsinformatie.nl';
// Zelfde rijen als raadsinformatie-ori.js gebruikt voor zijn ontdubbeling.
const VASTE_RAADSRIJEN = [108, 31];

const binnenBudget = () => Date.now() - START < BUDGET_MS;
const slaap = ms => new Promise(r => setTimeout(r, ms));

let laatsteApi = 0;
async function api(pad) {
  const wacht = 1050 - (Date.now() - laatsteApi);
  if (wacht > 0) await slaap(wacht);
  laatsteApi = Date.now();
  const resp = await fetch(`${API}${pad}`, {
    headers: { 'X-API-Key': SLEUTEL, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`RaadKijker HTTP ${resp.status} op ${pad}`);
  const type = resp.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error(`RaadKijker gaf ${type} in plaats van JSON (Cloudflare?)`);
  return resp.json();
}

async function pdfTekst(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  // Notubiz geeft voor een deel van de nieuwste stukken HTTP 400 "Document kan
  // niet gedownload worden". Dat is geen fout van deze run.
  if (!resp.ok) return null;
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true,
  }).promise;
  const delen = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    const inhoud = await (await doc.getPage(p)).getTextContent();
    delen.push(inhoud.items.map(i => i.str).join(' '));
  }
  await doc.destroy();
  const tekst = delen.join('\n').replace(/[ \t]+/g, ' ').trim();
  return tekst.length >= 200 ? tekst : null;
}

async function scrape() {
  if (!SLEUTEL) throw new Error('RAADKIJKER_API_KEY ontbreekt in scraper/.env');

  const bronnen = {
    motie: await getOrCreateSource(db, {
      name: 'Raad Amersfoort — Moties', url: `${BASIS_RAAD}/#/raad-moties`,
      sourceType: 'api', reliability: 'primary', category: 'government', scrapeFrequency: 'daily',
    }),
    amendement: await getOrCreateSource(db, {
      name: 'Raad Amersfoort — Amendementen', url: `${BASIS_RAAD}/#/raad-amendementen`,
      sourceType: 'api', reliability: 'primary', category: 'government', scrapeFrequency: 'daily',
    }),
  };
  const raadsrijen = (await db.execute(
    "SELECT id FROM sources WHERE name LIKE 'Raad Amersfoort —%'",
  )).rows.map(r => Number(r.id));
  const RIJEN = [...new Set([...VASTE_RAADSRIJEN, ...raadsrijen, ...Object.values(bronnen).map(Number)])];
  const ph = RIJEN.map(() => '?').join(',');

  async function zoekBestaand(m) {
    const doc = notubizDocumentId(m.bron_document_url);
    if (doc) {
      const r = await db.execute({
        sql: `SELECT id, title, full_text IS NOT NULL AS ft FROM raw_items
              WHERE external_url LIKE ? AND source_id IN (${ph}) LIMIT 1`,
        args: [`%notubiz.nl/document/${doc.id}/%`, ...RIJEN],
      });
      if (r.rows[0]) return r.rows[0];
    }
    const sleutel = motieSleutel(m.titel);
    const r = await db.execute({
      sql: `SELECT id, title, full_text IS NOT NULL AS ft FROM raw_items
            WHERE title LIKE ? AND source_id IN (${ph}) ORDER BY id DESC LIMIT 10`,
      args: [`%${sleutel}%`, ...RIJEN],
    });
    // Alleen echte moties/amendementen, geen agendapunt of preadvies dat het nummer noemt.
    return r.rows.find(x => /motie|amendement/i.test(x.title) && zelfdeMotie(x.title, m.titel)) || null;
  }

  // 1. Lijst ophalen tot het venster voorbij is.
  const sinds = new Date(Date.now() - DAGEN * 864e5).toISOString().slice(0, 10);
  const sindsAanvul = new Date(Date.now() - DAGEN_AANVUL * 864e5).toISOString().slice(0, 10);
  const lijst = [];
  for (let offset = 0, pagina = 0; pagina < 5; pagina++, offset += 100) {
    const r = await api(`/moties?gemeente=amersfoort&limit=100&offset=${offset}`);
    const data = r.data || [];
    lijst.push(...data.filter(m => String(m.datum || '') >= sindsAanvul));
    if (data.length < 100 || String(data[data.length - 1].datum || '') < sindsAanvul) break;
  }

  const stats = { motie: { new: 0, skipped: 0, errors: 0 }, amendement: { new: 0, skipped: 0, errors: 0 } };
  let pdfs = 0, bijgewerkt = 0, uitgesteld = 0, onbruikbaar = 0;

  for (const m of lijst) {
    const soort = m.type === 'amendement' ? 'amendement' : 'motie';
    if (!isBruikbaar(m)) { onbruikbaar++; continue; }
    if (!binnenBudget()) { uitgesteld++; continue; }
    try {
      const bestaand = await zoekBestaand(m);
      const url = normaliseerNotubizUrl(m.bron_document_url);

      if (bestaand) {
        const nieuweTitel = uitslagWijziging(bestaand.title, m.titel);
        if (nieuweTitel) {
          if (DRY) console.log(`  [dry] titel ${bestaand.id}: ${bestaand.title.slice(0, 50)} -> ${nieuweTitel.slice(0, 50)}`);
          else await db.execute({ sql: 'UPDATE raw_items SET title = ? WHERE id = ?', args: [nieuweTitel.substring(0, 300), bestaand.id] });
          bijgewerkt++;
        }
        if (!bestaand.ft && pdfs < MAX_PDF) {
          pdfs++;
          const tekst = await pdfTekst(url);
          if (tekst && DRY) console.log(`  [dry] fulltext ${bestaand.id}: ${tekst.length} tekens`);
          else if (tekst) {
            await db.execute({
              sql: `UPDATE raw_items SET full_text = ?, fulltext_fetched_at = ?, entities_scanned_at = NULL
                    WHERE id = ? AND full_text IS NULL`,
              args: [tekst.substring(0, 200000), new Date().toISOString(), bestaand.id],
            });
            bijgewerkt++;
          }
        }
        stats[soort].skipped++;
        continue;
      }

      if (String(m.datum || '') < sinds) { stats[soort].skipped++; continue; } // te oud voor een nieuw item
      if (pdfs >= MAX_PDF) { uitgesteld++; continue; }
      pdfs++;
      const detail = (await api(`/moties/${m.id}`)).data || {};
      const pdf = await pdfTekst(url);
      const rkTekst = String(detail.document_tekst || '').trim();
      const tekst = pdf || rkTekst;
      const kop = inhoudskop({ ...m, ...detail });
      const content = `${kop}\n\n${tekst}`.trim();
      if (DRY) {
        console.log(`  [dry] nieuw ${soort}: ${String(m.titel).slice(0, 70)} | pdf ${pdf ? pdf.length : 'nee'} | rk ${rkTekst.length}`);
        stats[soort].new++;
        continue;
      }
      const r = await saveRawItem(db, {
        sourceId: bronnen[soort],
        externalUrl: url,
        title: String(m.titel).trim().substring(0, 300),
        content: content.substring(0, 25000),
        fullText: tekst.length >= 200 ? `${kop}\n\n${tekst}` : null,
        summary: makeSummary(tekst) || kop,
        publishedAt: m.datum,
      });
      if (r.saved) stats[soort].new++; else stats[soort].skipped++;
    } catch (e) {
      console.error(`raadkijker-moties: ${m.id} ${m.titel?.slice(0, 60)}: ${e.message}`);
      stats[soort].errors++;
    }
  }

  console.log(`raadkijker-moties: ${lijst.length} in venster (nieuw sinds ${sinds}, aanvullen sinds ${sindsAanvul}), ${onbruikbaar} zonder motienummer overgeslagen, ` +
    `${pdfs} PDF-pogingen, ${bijgewerkt} bestaande bijgewerkt, ${uitgesteld} uitgesteld naar volgende run`);
  if (DRY) { console.log('raadkijker-moties: dry-run, niets weggeschreven', JSON.stringify(stats)); return; }
  for (const soort of ['motie', 'amendement']) {
    const s = stats[soort];
    await logResult(db, bronnen[soort], `RaadKijker — ${soort === 'motie' ? 'Moties' : 'Amendementen'} Amersfoort`,
      s.new, s.skipped, s.errors, lijst.filter(m => (m.type === 'amendement') === (soort === 'amendement')).length);
  }
}

scrape().then(() => process.exit(0)).catch(e => { console.error('raadkijker-moties:', e.message); process.exit(1); });
