// notubiz-lib.js — pure hulpfuncties voor de Notubiz-API (api.notubiz.nl).
// Geen netwerk en geen database, zodat ze los te testen zijn. Gebruikt door
// scrapers/notubiz-leusden.js.

// Waarde van een Notubiz-attribuut (id 1 = titel, 50 = locatie).
export function attribuut(obj, id) {
  const a = (obj && Array.isArray(obj.attributes) ? obj.attributes : []).find((x) => x && x.id === id);
  return a ? String(a.value || '').trim() : '';
}

export function startdatum(obj) {
  const p = obj && Array.isArray(obj.plannings) ? obj.plannings[0] : null;
  return p && p.start_date ? String(p.start_date).slice(0, 10) : null;
}

const DOC_URL = /^https?:\/\/api\.notubiz\.nl\/document\/(\d+)\/(\d+)/;

export function documentId(url) {
  const m = String(url || '').match(DOC_URL);
  return m ? m[1] : null;
}

// Alle documenten in een vergadering, met het agendapunt waar ze onder hangen.
// Loopt de hele JSON-boom af, zodat ook documenten in module_items of
// sub-agendapunten meekomen. Elk document één keer (op document-id).
export function verzamelDocumenten(meeting) {
  const gezien = new Map();
  function loop(node, agendapunt) {
    if (Array.isArray(node)) { for (const x of node) loop(x, agendapunt); return; }
    if (!node || typeof node !== 'object') return;
    let punt = agendapunt;
    if (node.type_data && Array.isArray(node.type_data.attributes)) {
      const titel = attribuut(node.type_data, 1);
      if (titel) punt = [node.type_data.title_prefix, titel].filter(Boolean).join(' ');
    }
    const id = documentId(node.url);
    if (id && node.title && !gezien.has(id)) {
      gezien.set(id, {
        id, url: node.url, titel: String(node.title).trim(), agendapunt: punt || null,
        soort: (Array.isArray(node.types) ? node.types : []).map((t) => t.value).filter(Boolean).join('/') || null,
        publicatiedatum: node.publication_date || null,
        pdf: (Array.isArray(node.versions) ? node.versions : []).some((v) => /pdf/i.test(v.mime_type || '')),
      });
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'organisation' || k === 'gremium' || k === 'meeting' || k === 'parent') continue;
      if (v && typeof v === 'object') loop(v, punt);
    }
  }
  loop(meeting, null);
  return [...gezien.values()];
}

// Titel voor raw_items: vergadering, datum, agendapunt en document.
export function itemTitel(vergadering, datum, doc) {
  const kop = [vergadering, datum].filter(Boolean).join(' ');
  const punt = doc.agendapunt && !doc.titel.toLowerCase().includes(doc.agendapunt.toLowerCase().replace(/^\d+\s+/, ''))
    ? `${doc.agendapunt} — ` : '';
  return `Raad Leusden: ${kop}: ${punt}${doc.titel}`.replace(/\s+/g, ' ').slice(0, 300);
}

// Een vergadering die langer dan `dagen` geleden was, levert achtergrond op en
// geen nieuwe signalen (is_historical=1, is_processed=1).
export function isHistorisch(datum, nu = new Date(), dagen = 7) {
  if (!datum) return false;
  return new Date(`${datum}T00:00:00Z`).getTime() < nu.getTime() - dagen * 864e5;
}
