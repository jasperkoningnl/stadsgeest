import fs from 'fs';
import { spawn } from 'child_process';
import { createCanvas } from '@napi-rs/canvas';

export const MIN_OCR_TEKENS = 200;
export const MAX_OCR_POGINGEN = 2;

export function isOcrKandidaat(status, pogingen = 0) {
  return status === 'geen_tekst' && Number(pogingen || 0) < MAX_OCR_POGINGEN;
}

export function vindTesseract() {
  const kandidaten = [
    process.env.TESSERACT_PATH,
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'tesseract',
  ].filter(Boolean);
  return kandidaten.find((p) => p === 'tesseract' || fs.existsSync(p)) || null;
}

function herkenPng(executable, png, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['stdin', 'stdout', '-l', 'nld+eng', '--psm', '6'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const uit = [], fout = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => uit.push(d));
    child.stderr.on('data', (d) => fout.push(d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Tesseract stopte met ${signal || code}: ${Buffer.concat(fout).toString('utf8').slice(-500)}`));
      resolve(Buffer.concat(uit).toString('utf8').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
    });
    child.stdin.end(png);
  });
}

export async function ocrPdf(buffer, { maxPaginas = 12, schaal = 2, paginaTimeoutMs = 30000 } = {}) {
  const executable = vindTesseract();
  if (!executable) throw new Error('Tesseract niet gevonden; zet TESSERACT_PATH of installeer Tesseract in Program Files.');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const delen = [];
  try {
    const n = Math.min(doc.numPages, maxPaginas);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: schaal });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const tekst = await herkenPng(executable, canvas.toBuffer('image/png'), paginaTimeoutMs);
      if (tekst) delen.push(tekst);
      page.cleanup();
    }
    return { tekst: delen.join('\n\n').trim(), paginas: doc.numPages, paginasOcr: n };
  } finally {
    await doc.destroy();
  }
}

export function bouwFullText(basis, bijlagen, maxTekens = 200000) {
  return [basis || '', ...bijlagen.map((b) => `\n\n=== Bijlage: ${b.titel || 'document'} ===\n${b.tekst || ''}`)]
    .join('').substring(0, maxTekens);
}
