const MIN_TEXT = 200;

export function isNotubizUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'notubiz.nl' || host.endsWith('.notubiz.nl');
  } catch {
    return false;
  }
}

export function notubizDocumentParts(value) {
  if (!isNotubizUrl(value)) return null;
  const match = new URL(String(value)).pathname.match(/^\/document\/(\d+)\/(\d+)/i);
  if (!match) return null;
  return { documentId: match[1], revision: match[2] };
}

export function oriUrlCandidates(value) {
  const url = new URL(String(value));
  url.search = '';
  const clean = url.toString().replace(/\/$/, '');
  const parts = notubizDocumentParts(clean);
  const candidates = new Set([String(value), clean]);
  if (parts) {
    candidates.add(`https://api.notubiz.nl/document/${parts.documentId}/${parts.revision}`);
    candidates.add(`https://amersfoort.notubiz.nl/document/${parts.documentId}/${parts.revision}`);
  }
  return [...candidates];
}

export function buildOriLookup(value) {
  const urls = oriUrlCandidates(value);
  return {
    size: 10,
    query: {
      bool: {
        should: urls.flatMap(url => [
          { term: { 'original_url.keyword': url } },
          { term: { original_url: url } },
        ]),
        minimum_should_match: 1,
      },
    },
    _source: ['text', 'original_url'],
  };
}

export function extractOriText(payload, sourceUrl, minText = MIN_TEXT) {
  const sourceParts = notubizDocumentParts(sourceUrl);
  const matches = (payload?.hits?.hits || [])
    .map(hit => hit?._source || {})
    .filter(source => {
      if (!sourceParts) return true;
      const hitParts = notubizDocumentParts(source.original_url);
      return hitParts?.documentId === sourceParts.documentId;
    })
    .map(source => String(source.text || '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= minText)
    .sort((a, b) => b.length - a.length);
  return matches[0] || null;
}


// ── Directe pdf-route via api.notubiz.nl (toegevoegd 2026-10-03) ─────────────
// amersfoort.notubiz.nl zit achter Cloudflare en geeft een gewone fetch HTTP 403.
// De opgeslagen URL is dus niet op te halen; api.notubiz.nl levert dezelfde pdf
// zonder sleutel. Gemeten op 3 oktober: 7 van 8 stukken direct, de rest na het
// opzoeken van de actuele versie (een oude revisie geeft 400 "U moet een token
// doorgeven"). Ingekomen stukken hebben vaak meer dan één document (brief plus
// bijlage); die staan in het module-item.

const API = 'https://api.notubiz.nl';
const API_V = 'format=json&version=1.17.0&lang=nl-nl';
const API_DOC = /^https?:\/\/api\.notubiz\.nl\/document\/(\d+)\/(\d+)/i;

export function notubizPdfUrl(documentId, revision) {
  return `${API}/document/${documentId}/${revision}`;
}

export function notubizMetaUrl(documentId) {
  return `${API}/document/${documentId}?${API_V}`;
}

// Het module-item achter een URL: de overzichtspagina van een ingekomen stuk
// (/modules/1/Ingekomen stukken/123) of een documentlink met connection_type=16.
// connection_type 16 komt alleen bij ingekomen stukken (module 1) voor.
export function notubizModuleItem(value) {
  if (!isNotubizUrl(value)) return null;
  const url = new URL(String(value));
  const pad = url.pathname.match(/^\/modules\/(\d+)\/[^/]+\/(\d+)\/?$/);
  if (pad) return { moduleId: pad[1], itemId: pad[2] };
  const id = url.searchParams.get('connection_id') || '';
  if (url.searchParams.get('connection_type') === '16' && /^\d+$/.test(id)) return { moduleId: '1', itemId: id };
  return null;
}

export function notubizModuleItemUrl({ moduleId, itemId }) {
  return `${API}/modules/${moduleId}/items/${itemId}?${API_V}`;
}

// Documenten in een API-antwoord (module-item of documentmetadata), elk één
// keer, met de actuele versie zoals de API die in `url` geeft. Verwijzingen in
// `self` (connections) tellen niet mee.
export function documentenUitPayload(payload) {
  const gezien = new Map();
  function loop(node) {
    if (Array.isArray(node)) { for (const x of node) loop(x); return; }
    if (!node || typeof node !== 'object') return;
    const m = typeof node.url === 'string' ? node.url.match(API_DOC) : null;
    if (m && !gezien.has(m[1])) {
      gezien.set(m[1], { documentId: m[1], revision: m[2], titel: String(node.title || '').trim() });
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') loop(v);
  }
  loop(payload);
  return [...gezien.values()];
}

let pdfjs = null;
// Standaard pdf-extractie. 150 pagina's, gelijk aan de iBabs-bijlagen: de
// waarde zit in de lange stukken. verbosity 0 houdt fontwaarschuwingen van stderr.
export async function pdfBufferNaarTekst(buffer, maxPaginas = 150) {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0,
  }).promise;
  try {
    const delen = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPaginas); p++) {
      const inhoud = await (await doc.getPage(p)).getTextContent();
      delen.push(inhoud.items.map((i) => i.str).join(' '));
    }
    return delen.join('\n').replace(/\s+/g, ' ').trim();
  } finally {
    await doc.destroy();
  }
}

const UA_STANDAARD = 'Stadsgeest033/1.0 (lokale nieuwssite Amersfoort; redactie@stadsgeest.nl)';

async function haalJson(url, { fetchFn, ua }) {
  try {
    const r = await fetchFn(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(25000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function haalPdf(url, { fetchFn, ua }) {
  try {
    const r = await fetchFn(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { buf, status: 'pdf' };
    return { buf: null, status: r.ok ? 'geen_pdf' : `http_${r.status}` };
  } catch (e) {
    return { buf: null, status: `fout: ${e.message}` };
  }
}

// Eén document: de pdf in de opgeslagen revisie; weigert die, dan de actuele versie.
async function documentTekst(doc, opties) {
  let revision = doc.revision;
  let { buf, status } = await haalPdf(notubizPdfUrl(doc.documentId, revision), opties);
  if (!buf) {
    const meta = await haalJson(notubizMetaUrl(doc.documentId), opties);
    const actueel = documentenUitPayload(meta).find((d) => d.documentId === doc.documentId);
    if (actueel && actueel.revision !== revision) {
      revision = actueel.revision;
      ({ buf, status } = await haalPdf(notubizPdfUrl(doc.documentId, revision), opties));
    }
  }
  if (!buf) return { ...doc, revision, status, tekst: '' };
  try {
    const tekst = await opties.pdfNaarTekst(buf);
    return { ...doc, revision, status: tekst.length >= opties.minText ? 'ok' : 'scan', tekst, bytes: buf.length };
  } catch (e) {
    return { ...doc, revision, status: `pdf onleesbaar: ${e.message}`, tekst: '' };
  }
}

// Tekst van een Notubiz-item: alle documenten van het module-item, of het ene
// document uit de URL. Resultaat: { text, reason, documenten }. `documenten`
// geeft per document de status (ok, scan, http_400, geen_pdf, …) en het aantal
// tekens, zodat een inhaalslag scans zonder tekstlaag kan tellen.
export async function haalNotubizTekst(url, {
  fetchFn = fetch, pdfNaarTekst = pdfBufferNaarTekst, ua = UA_STANDAARD,
  minText = MIN_TEXT, maxDocumenten = 25, pauzeMs = 400,
} = {}) {
  const opties = { fetchFn, pdfNaarTekst, ua, minText };
  const item = notubizModuleItem(url);
  const delen = notubizDocumentParts(url);
  let documenten = item ? documentenUitPayload(await haalJson(notubizModuleItemUrl(item), opties)) : [];
  if (!documenten.length && delen) documenten = [{ documentId: delen.documentId, revision: delen.revision, titel: '' }];
  if (!documenten.length) {
    return { text: null, reason: item ? 'module-item zonder document' : 'geen Notubiz-document in de URL', documenten: [] };
  }

  const uitkomsten = [];
  for (const doc of documenten.slice(0, maxDocumenten)) {
    if (uitkomsten.length && pauzeMs) await new Promise((r) => setTimeout(r, pauzeMs));
    uitkomsten.push(await documentTekst(doc, opties));
  }
  const metTekst = uitkomsten.filter((u) => u.tekst);
  const text = uitkomsten.length === 1
    ? (metTekst[0]?.tekst || '')
    : metTekst.map((u) => `[${u.titel || `document ${u.documentId}`}]\n${u.tekst}`).join('\n\n');
  const overzicht = uitkomsten.map(({ tekst, ...rest }) => ({ ...rest, tekens: tekst.length }));
  if (text.length >= minText) return { text, reason: null, documenten: overzicht };
  const statussen = [...new Set(uitkomsten.map((u) => u.status))].join(', ');
  const scan = uitkomsten.some((u) => u.status === 'scan');
  return { text: null, reason: scan ? `pdf zonder tekstlaag (${statussen})` : statussen, documenten: overzicht };
}
