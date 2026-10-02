// stateninformatie-lib.mjs — pure hulpfuncties voor de Statenstukken van de
// provincie Utrecht (www.stateninformatie.provincie-utrecht.nl, een
// GemeenteOplossingen-systeem met open JSON-API). Geen netwerk en geen
// database, zodat ze los te testen zijn. Gebruikt door
// scrapers/stateninformatie.js.
//
// De API:
//   /api/v1/meetings?date_from=<epoch s>&date_to=<epoch s>  vergaderingen met
//       agendapunten (items) en documenten; de datums zijn Unix-seconden,
//       een jjjj-mm-dd wordt genegeerd en levert dan alles sinds 2007.
//   /api/v1/meetings/{id}/documents/{docId}                  de PDF.

export const BASIS = 'https://www.stateninformatie.provincie-utrecht.nl';

// Lokale termen. Amersfoortseweg en Amersfoortsestraat(weg) liggen in
// Soesterberg, Maarn, Doorn en Huis ter Heide en tellen niet; "Amersfoortse"
// als bijvoeglijk naamwoord wel. Hoevelaken ligt in Nijkerk maar grenst aan
// Vathorst en het knooppunt is Amersfoorts nieuws.
const LOKAAL = /\b(amersfoort(?!se\s*(?:weg|straat))\w*|leusden\w*|leusderheide|hoevelaken|eemland|vathorst|isselt|hoogland(?:erveen)?|achterveld|stoutenburg|soesterkwartier|liendert|schothorst|kattenbroek|nieuwland|zielhorst|bergkwartier)\b/gi;

/** Aantal lokale treffers en de unieke termen (kleine letters). */
export function lokaleTreffers(tekst) {
  const termen = new Set();
  let aantal = 0;
  for (const m of String(tekst || '').matchAll(LOKAAL)) {
    aantal++;
    termen.add(m[1].toLowerCase());
  }
  return { aantal, termen: [...termen] };
}

/**
 * Hoeveel treffers een tekst nodig heeft om lokaal te heten, naar lengte. Een
 * brief van twee kantjes met twee keer Amersfoort gaat over Amersfoort; een
 * omgevingsverordening van 200.000 tekens noemt elke gemeente wel een paar
 * keer.
 */
export function drempel(tekstLengte) {
  if (tekstLengte < 50000) return 2;
  if (tekstLengte < 150000) return 3;
  return 5;
}

/**
 * Is een stuk lokaal genoeg om te bewaren? Een treffer in de titel is altijd
 * genoeg (de griffie noemt de plaats dan niet voor niets). In de tekst zijn
 * minstens `drempel(lengte)` treffers nodig: een begroting die Amersfoort één
 * keer in een opsomming van 26 gemeenten noemt, is geen Amersfoorts stuk.
 */
export function isLokaal({ titel, tekst }, minTekst = null) {
  if (lokaleTreffers(titel).aantal > 0) return { lokaal: true, reden: 'titel' };
  const t = lokaleTreffers(tekst);
  const nodig = minTekst ?? drempel(String(tekst || '').length);
  if (t.aantal >= nodig) return { lokaal: true, reden: `tekst ${t.aantal}× (${t.termen.join(', ')})` };
  return { lokaal: false, reden: t.aantal ? `tekst ${t.aantal}× van ${nodig} nodig` : 'geen treffer' };
}

/** Venster in Unix-seconden, zoals de API het wil. */
export function venster(nu = new Date(), dagenTerug = 30, dagenVooruit = 21) {
  const s = Math.floor(nu.getTime() / 1000);
  return { van: s - dagenTerug * 86400, tot: s + dagenVooruit * 86400 };
}

export function vergaderDatum(meeting) {
  return meeting && meeting.date ? String(meeting.date).slice(0, 10) : null;
}

export function vergaderNaam(meeting) {
  const gremium = meeting && meeting.dmu && meeting.dmu.name ? String(meeting.dmu.name).trim() : 'Provinciale Staten';
  return gremium;
}

function zonderExtensie(naam) {
  return String(naam || '').replace(/\.(pdf|docx?|xlsx?|pptx?)$/i, '').trim();
}

/**
 * Alle documenten van een vergadering, met het agendapunt waar ze onder
 * hangen. Vertrouwelijke stukken en vergaderingen vallen af. Elk document één
 * keer (op document-id).
 */
export function documentenVanVergadering(meeting) {
  if (!meeting || meeting.confidential) return [];
  const gezien = new Map();
  const voeg = (doc, agendapunt) => {
    if (!doc || doc.confidential || !doc.id || gezien.has(doc.id)) return;
    const titel = zonderExtensie(doc.description || doc.filename) || `document ${doc.id}`;
    gezien.set(doc.id, {
      id: doc.id,
      vergaderingId: meeting.id,
      titel,
      bestandsnaam: doc.filename || null,
      omvang: Number(doc.filesize) || null,
      gewijzigd: doc.modified || null,
      agendapunt,
      pdf: /\.pdf$/i.test(doc.filename || '') || !doc.filename,
      url: `${BASIS}/api/v1/meetings/${meeting.id}/documents/${doc.id}`,
    });
  };
  for (const doc of meeting.documents || []) voeg(doc, null);
  for (const item of meeting.items || []) {
    const punt = [item.number, item.title].filter((x) => x && String(x).trim()).join(' ').trim() || null;
    for (const doc of item.documents || []) voeg(doc, punt);
  }
  return [...gezien.values()];
}

/** Titel voor raw_items: herkomst, gremium, datum, agendapunt en stuk. */
export function itemTitel(meeting, doc) {
  const kop = [vergaderNaam(meeting), vergaderDatum(meeting)].filter(Boolean).join(' ');
  const puntKaal = doc.agendapunt ? doc.agendapunt.replace(/^\S+\s+/, '').toLowerCase() : '';
  const punt = doc.agendapunt && !doc.titel.toLowerCase().includes(puntKaal) ? `${doc.agendapunt} — ` : '';
  return `Provinciale Staten Utrecht: ${kop}: ${punt}${doc.titel}`.replace(/\s+/g, ' ').slice(0, 300);
}

/** Kopregels boven de tekst, zodat de weger herkomst en datum ziet. */
export function itemKop(meeting, doc) {
  return [
    `Provincie Utrecht — ${vergaderNaam(meeting)}`,
    vergaderDatum(meeting) ? `Vergaderdatum: ${vergaderDatum(meeting)}` : null,
    doc.agendapunt ? `Agendapunt: ${doc.agendapunt}` : null,
    meeting.fullUrl ? `Vergadering: ${meeting.fullUrl}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Een vergadering die langer dan `dagen` geleden was, levert achtergrond op
 * (is_historical=1, is_processed=1) en geen nieuwe signalen. De Staten
 * vergaderen maandelijks; daarom ruimer dan de 7 dagen van de raad Leusden.
 */
export function isHistorisch(datum, nu = new Date(), dagen = 14) {
  if (!datum) return false;
  return new Date(`${datum}T00:00:00Z`).getTime() < nu.getTime() - dagen * 864e5;
}

/**
 * Welke documenten deze run aan de beurt zijn: nog niet beoordeeld, of eerder
 * mislukt met minder dan `maxPogingen` pogingen. Nieuwste vergadering eerst.
 */
export function teBeoordelen(meetings, beoordeeld, maxPogingen = 3) {
  const uit = [];
  const gesorteerd = [...meetings].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const m of gesorteerd) {
    for (const doc of documentenVanVergadering(m)) {
      const eerder = beoordeeld[String(doc.id)];
      if (eerder && eerder.besluit !== 'fout') continue;
      if (eerder && eerder.besluit === 'fout' && (eerder.pogingen || 1) >= maxPogingen) continue;
      uit.push({ meeting: m, doc, pogingen: eerder ? eerder.pogingen || 1 : 0 });
    }
  }
  return uit;
}
