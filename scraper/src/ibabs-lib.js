// ibabs-lib.js — parsering voor het iBabs-publieksportaal (amersfoort.bestuurlijkeinformatie.nl)
// zonder netwerk of database, zodat de regels los te testen zijn.

export const IBABS_BASE = 'https://amersfoort.bestuurlijkeinformatie.nl';

// Categorieoverzichten. De lijst komt via POST /Reports/GetReportData/{id} (DataTables).
export const RAPPORTEN = {
  woo: { id: '69b01c4f-3ce6-443e-b1f9-b05ce5df3339', soort: 'Woo-verzoeken', datumVeld: ['datum2', 'DAtum1'] },
  convenanten: { id: '98f3693f-6cd1-4fda-8cf3-74292e74378e', soort: 'Convenanten', datumVeld: ['registrationdate'] },
};

// Rij uit GetReportData → item met url, titel en datum (dd-mm-jjjj).
export function rijNaarItem(rij, rapport) {
  const titel = String(rij.title || '').replace(/\s+/g, ' ').trim();
  const datum = rapport.datumVeld.map(v => rij[v]).find(Boolean) || null;
  return {
    id: rij.DT_RowId,
    url: `${IBABS_BASE}/Reports/Item/${rij.DT_RowId}`,
    titel: `${rapport.soort}: ${titel}`.substring(0, 500),
    datum,
    zaaknummer: rij.zaaknummer || rij.regnummer || null,
  };
}

// Documentlinks op een itempagina: /Reports/Document/{item}?documentId={doc} met de linktekst als titel.
export function documentLinks(html) {
  const uit = new Map();
  for (const m of html.matchAll(/<a[^>]+href="\/Reports\/Document\/[0-9a-f-]+\?documentId=([0-9a-f-]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const titel = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!uit.has(m[1])) uit.set(m[1], titel || m[1]);
  }
  return [...uit.entries()].map(([documentId, titel]) => ({ documentId, titel, url: `${IBABS_BASE}/Document/View/${documentId}` }));
}

// dd-mm-jjjj → leeftijd in dagen (null als onleesbaar).
export function leeftijdDagen(ddmmjjjj, nu = Date.now()) {
  const m = String(ddmmjjjj || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return (nu - Date.UTC(+m[3], +m[2] - 1, +m[1])) / 86400000;
}
