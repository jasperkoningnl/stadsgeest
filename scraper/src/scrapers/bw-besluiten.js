// bw-besluiten.js — B&W besluitenlijsten gemeente Amersfoort (Notubiz / raadsinformatie.nl)
//
// Herschreven 2026-08-21.
//
// De oude versie gebruikte amersfoort.notubiz.nl, maar die URL is achter
// Cloudflare Turnstile terechtgekomen en leverde al maanden nul items.
// De publieke site amersfoort.raadsinformatie.nl draait dezelfde Notubiz-
// software en is via Playwright wél bereikbaar (Turnstile laat echte browsers
// door). De nieuwe opzet:
//
//   1. Overview-tabel laden via Playwright (alle besluitenlijsten van het
//      lopende jaar, ?month=all).
//   2. Per besluitenlijst de detailpagina openen in Playwright — daar staan
//      de agendapunten en de documentlinks.
//   3. Documentlinks zijn directe PDF-downloads. Die worden via Playwright's
//      download-API opgehaald, met pdfjs-dist geparsed naar tekst, en als
//      content opgeslagen.
//
// De volledige documenttekst is het doel — niet alleen de samenvatting.

import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const YEAR = new Date().getFullYear();
const SOURCE_URL = `https://amersfoort.raadsinformatie.nl/modules/12/Besluitenlijsten/view?month=all&year=${YEAR}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAUZE_MS = 1500;
const PDF_DOWNLOAD_TIMEOUT = 30000;  // 30s — sommige PDF's zijn groot
const MAX_PDF_BYTES = 50 * 1024 * 1024;  // 50 MB — grotere bestanden overslaan (geheugen)

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- PDF-tekst extraheren met pdfjs-dist ----
async function extractPdfText(pdfPath) {
  // Dynamische import zodat de rest van de scraper niet breekt als pdfjs-dist
  // niet geïnstalleerd is (dan slaat hij PDF's over en logt een waarschuwing).
  let pdfjsLib;
  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    try {
      pdfjsLib = await import('pdfjs-dist');
    } catch (err) {
      console.error('pdfjs-dist niet beschikbaar, PDF-tekst wordt overgeslagen:', err.message);
      return null;
    }
  }

  const data = new Uint8Array(await fs.readFile(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const maxPages = Math.min(doc.numPages, 50); // max 50 pagina's per PDF
  const tekstDelen = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const regels = content.items.map((item) => item.str).join(' ');
    tekstDelen.push(regels);
  }
  await doc.destroy();
  return tekstDelen.join('\n\n').replace(/\s+/g, ' ').trim();
}

// ---- Hoofdlogica ----
async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'B&W besluitenlijsten gemeente Amersfoort',
    url: 'https://amersfoort.raadsinformatie.nl/modules/12/Besluitenlijsten/view',
    sourceType: 'scrape',
    reliability: 'primary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  let saved = 0, skipped = 0, errors = 0, gevonden = 0;
  const overslagenPdfs = [];  // signalering: welke PDF's zijn te groot
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bw-pdf-'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'nl-NL',
    acceptDownloads: true,
    extraHTTPHeaders: { 'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8' },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    // ---- Stap 1: overview laden ----
    console.log(`[B&W] Overview laden: ${SOURCE_URL}`);
    await page.goto(SOURCE_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForSelector('table tr[data-id]', { timeout: 20000 }).catch(() => {});

    const rijen = await page.$$eval('table tr[data-id]', (rows) => {
      return rows.map((row) => {
        const cells = row.querySelectorAll('td');
        const actionLink = row.querySelector('td.item_actions a');
        const href = actionLink?.href || '';
        const datum = (cells[1]?.textContent || '').trim();
        const tijd = (cells[2]?.textContent || '').trim();
        const titel = (cells[3]?.textContent || '').trim();
        return { href, datum, tijd, titel, dataId: row.getAttribute('data-id') };
      }).filter((r) => r.href && r.titel);
    });

    gevonden = rijen.length;
    console.log(`[B&W] ${gevonden} besluitenlijsten gevonden voor ${YEAR}`);

    if (gevonden === 0) {
      throw new Error('Geen rijen in de overview-tabel — opbouw gewijzigd, controleer selectors');
    }

    // ---- Stap 2 + 3: per besluitenlijst detail + documenten ----
    for (const rij of rijen) {
      try {
        await pauze(PAUZE_MS);
        console.log(`[B&W] Detail: ${rij.titel} (${rij.datum})`);

        // Detail pagina openen
        await page.goto(rij.href, { waitUntil: 'networkidle', timeout: 30000 });

        // Agendapunten-tekst van de detailpagina
        const detailTekst = await page.evaluate(() => {
          const main = document.querySelector('main') || document.querySelector('.module-inner') || document.body;
          return main.innerText.trim();
        });

        // Documentlinks zoeken
        const docLinks = await page.$$eval('a[href*="/document/"]', (links) => {
          const seen = new Set();
          return links
            .map((a) => ({ href: a.href, label: (a.textContent || '').trim() }))
            .filter((l) => {
              if (!l.href || seen.has(l.href)) return false;
              seen.add(l.href);
              return true;
            });
        });

        console.log(`[B&W]   ${docLinks.length} document(en) gevonden`);

        // PDF's downloaden en tekst extraheren
        const pdfTeksten = [];
        for (const doc of docLinks) {
          let downloadPage = null;
          try {
            await pauze(500);
            // Playwright download: open een nieuw tabblad en wacht op download
            downloadPage = await context.newPage();
            const [download] = await Promise.all([
              downloadPage.waitForEvent('download', { timeout: PDF_DOWNLOAD_TIMEOUT }),
              downloadPage.goto(doc.href, { timeout: PDF_DOWNLOAD_TIMEOUT }).catch(() => {}),
            ]);

            const tmpPath = path.join(tmpDir, `${Date.now()}.pdf`);
            await download.saveAs(tmpPath);
            await downloadPage.close();
            downloadPage = null;

            // Grootte-check: heel grote PDF's overslaan (geheugen)
            const stat = await fs.stat(tmpPath);
            if (stat.size > MAX_PDF_BYTES) {
              const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
              console.warn(`[B&W]   ⚠ PDF OVERGESLAGEN (${sizeMB} MB, limiet ${MAX_PDF_BYTES/1024/1024} MB): ${doc.label}`);
              console.warn(`[B&W]     URL: ${doc.href}`);
              console.warn(`[B&W]     Besluitenlijst: ${rij.titel} (${rij.datum})`);
              overslagenPdfs.push({
                besluitenlijst: rij.titel,
                datum: rij.datum,
                document: doc.label,
                url: doc.href,
                sizeMB: parseFloat(sizeMB),
              });
              await fs.unlink(tmpPath).catch(() => {});
              continue;
            }

            const tekst = await extractPdfText(tmpPath);
            if (tekst && tekst.length > 20) {
              pdfTeksten.push(`--- ${doc.label} ---\n${tekst}`);
            }

            // Tijdelijk bestand opruimen
            await fs.unlink(tmpPath).catch(() => {});
          } catch (err) {
            console.error(`[B&W]   PDF-download mislukt (${doc.label}): ${err.message}`);
            if (downloadPage) await downloadPage.close().catch(() => {});
          }
        }

        // Content samenstellen: detailpagina + PDF-teksten
        const allePdfTekst = pdfTeksten.join('\n\n');
        const content = [detailTekst, allePdfTekst].filter(Boolean).join('\n\n=== DOCUMENTEN ===\n\n');

        const result = await saveRawItem(db, {
          sourceId,
          externalUrl: rij.href,
          title: `B&W besluitenlijst: ${rij.titel} — ${rij.datum}`.substring(0, 500),
          content: content.substring(0, 500000),
          summary: detailTekst.substring(0, 500),
          publishedAt: rij.datum || null,
        });
        if (result.saved) saved++; else skipped++;
      } catch (err) {
        errors++;
        console.error(`[B&W] Fout bij "${rij.titel}": ${err.message}`);
      }
    }
  } catch (err) {
    errors++;
    console.error(`[B&W] ${err.message}`);
  } finally {
    await browser.close();
    // Temp-map opruimen
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ---- Signalering overgeslagen PDF's ----
  if (overslagenPdfs.length > 0) {
    console.warn(`\n[B&W] ⚠ ${overslagenPdfs.length} PDF('s) overgeslagen wegens grootte (limiet: ${MAX_PDF_BYTES/1024/1024} MB):`);
    for (const p of overslagenPdfs) {
      console.warn(`  ${p.sizeMB} MB | ${p.datum} | ${p.document}`);
      console.warn(`    ${p.url}`);
    }
    console.warn(`[B&W] Controleer of deze documenten handmatig verwerkt moeten worden.\n`);

    // Sla de overgeslagen PDF's op in scrape_runs zodat ze achteraf te reviewen zijn
    try {
      await db.execute({
        sql: `INSERT INTO scrape_runs (job_name, source_id, source_name, items_found, items_new, items_duplicate, items_error, status)
              VALUES (?, ?, ?, ?, 0, ?, 0, 'skipped_pdfs')`,
        args: [
          process.env.SCRAPE_JOB_NAME || null,
          sourceId,
          'B&W overgeslagen PDF\'s: ' + overslagenPdfs.map(p => `${p.document} (${p.sizeMB}MB)`).join(', ').substring(0, 400),
          overslagenPdfs.length,
          overslagenPdfs.length,
        ],
      });
    } catch (logErr) {
      console.warn(`[B&W] Kon overgeslagen PDF's niet opslaan in scrape_runs: ${logErr.message}`);
    }
  }

  await logResult(db, sourceId, 'B&W besluitenlijsten gemeente Amersfoort', saved, skipped, errors, gevonden);
}

scrape().catch(console.error);
