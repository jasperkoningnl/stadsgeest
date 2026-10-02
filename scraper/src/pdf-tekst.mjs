// pdf-tekst.mjs — tekst uit een PDF-URL halen met pdfjs. Gedeeld door scrapers
// die officiële stukken als PDF binnenkrijgen (Statenstukken; het patroon komt
// uit scrapers/notubiz-leusden.js). Geen database.
//
// verbosity 0 onderdrukt de fontwaarschuwingen van pdfjs op stderr; run-all.js
// zou die anders bij elke run als fouttekst doorgeven.
//
// Resultaat: { status, tekst }. Statussen: ok, geen_tekst (scan zonder
// tekstlaag of te kort), geen_pdf, te_groot, http_<code>, fout.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGINAS = 80;

let pdfjs = null;

export async function pdfTekst(url, { ua = 'Stadsgeest033/1.0 (+https://stadsgeest.nl)', timeoutMs = 25000, maxBytes = MAX_BYTES, maxPaginas = MAX_PAGINAS } = {}) {
  let r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { status: 'fout', tekst: null, fout: e.message };
  }
  if (!r.ok) return { status: `http_${r.status}`, tekst: null };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) return { status: 'te_groot', tekst: null };
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 'geen_pdf', tekst: null };
  try {
    if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    const delen = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++) {
      const inhoud = await (await doc.getPage(p)).getTextContent();
      delen.push(inhoud.items.map((i) => i.str).join(' '));
    }
    await doc.destroy();
    const tekst = delen.join('\n').replace(/[ \t]+/g, ' ').trim();
    return tekst.length >= 100 ? { status: 'ok', tekst } : { status: 'geen_tekst', tekst: null };
  } catch (e) {
    return { status: 'fout', tekst: null, fout: e.message };
  }
}
