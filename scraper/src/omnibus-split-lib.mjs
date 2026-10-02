// Splitsing van B&W-besluitenlijsten ("omnibus-documenten") in losse stukken.
//
// Een besluitenlijst bevat meerdere ongerelateerde besluiten. De intake maakt
// van elk inhoudelijk stuk een eigen raw_item. Tot 2 oktober 2026 kregen die
// stukken de URL van de lijst zelf; het URL-duplicaatfilter gooide ze daardoor
// bij de volgende run weg, en de omnibus-check zag ze op bronnaam aan voor een
// hele besluitenlijst. Elk stuk krijgt daarom een eigen URL met een vast
// kenmerk, en gesplitste stukken slaan de omnibus-check over.

import crypto from 'crypto';

export const STUK_KENMERK = '#stuk=';
const PROCEDUREEL = /besluitenlijst\s+(b\.|hamerstukken)|invitaties|collegebericht/i;
const MAX_TEKENS = 50000;

// Vaste, herhaalbare URL per stuk: dezelfde lijst en titel geven altijd
// dezelfde URL, zodat opnieuw splitsen geen dubbele signalen oplevert.
export function stukUrl(lijstUrl, documentTitel) {
  const basis = String(lijstUrl || '').split(STUK_KENMERK)[0];
  const sleutel = String(documentTitel || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const kenmerk = crypto.createHash('sha1').update(sleutel).digest('hex').slice(0, 12);
  return `${basis}${STUK_KENMERK}${kenmerk}`;
}

export function isGesplitstStuk(item) {
  return String(item?.external_url || '').includes(STUK_KENMERK)
    || String(item?.summary || '').startsWith('Gesplitst uit besluitenlijst');
}

export function isOmnibus(item) {
  if (isGesplitstStuk(item)) return false;
  const bron = String(item?.source_name || '').toLowerCase();
  return bron.includes('b&w besluitenlijst')
    || bron.includes('b&w-besluitenlijst')
    || bron.includes('besluitenlijst college')
    || /\bbesluitenlijst\b/i.test(item?.title || '');
}

// Geeft null als de documentensectie ontbreekt; anders de inhoudelijke stukken
// en het aantal overgeslagen procedurele stukken.
export function splitsOmnibus(item) {
  const delen = String(item?.content || '').split('=== DOCUMENTEN ===');
  if (delen.length < 2 || delen[1].trim().length < 50) return null;
  const docParts = delen[1].split(/\n--- (.+?) ---\n/);
  const stukken = [];
  const gebruikt = new Set();
  let procedureel = 0;
  for (let d = 1; d < docParts.length; d += 2) {
    const docTitel = docParts[d].trim();
    const docTekst = (docParts[d + 1] || '').trim();
    if (PROCEDUREEL.test(docTitel)) { procedureel++; continue; }
    if (docTekst.length < 100) continue;
    const titel = docTitel.replace(/^\d{6}\w?\s*[-\u2013]\s*/, '');
    // Twee stukken met dezelfde titel in één lijst: volgnummer achter het kenmerk.
    const basisUrl = stukUrl(item.external_url, docTitel);
    let url = basisUrl;
    for (let n = 2; gebruikt.has(url); n++) url = `${basisUrl}-${n}`;
    gebruikt.add(url);
    stukken.push({
      external_url: url,
      title: `[B&W] ${titel}`,
      content: docTekst.substring(0, MAX_TEKENS),
      summary: `Gesplitst uit besluitenlijst (item #${item.id}): ${titel}`,
    });
  }
  return { stukken, procedureel };
}
