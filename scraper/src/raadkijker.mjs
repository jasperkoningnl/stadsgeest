// Pure hulpfuncties voor de RaadKijker-bron (raadkijker.nl/open-data).
// Geen netwerk en geen database, zodat ze los te testen zijn.
//
// Wat RaadKijker voor Amersfoort levert (gemeten 23 september 2026):
// - een lijst van alle moties en amendementen, nieuwste eerst, met datum, type,
//   uitslag (vaak pas later), indienende partij en de Notubiz-document-URL;
// - per motie een `document_tekst`, maar die is meestal alleen het dictum
//   ("verzoekt het college ..."). De volledige tekst staat in de Notubiz-PDF.
// - stemgedrag per raadslid: leeg voor Amersfoort.

export const UITSLAGWOORDEN = ['AANGENOMEN', 'VERWORPEN', 'INGETROKKEN', 'VERDAAGD', 'AANGEHOUDEN'];

// Motienummer zoals de griffie het schrijft: 2026-099M, 2026-077A, 2026-092.
// De letter wisselt: een verdaagde motie kwam in juli terug als 2026-092 en in
// september opnieuw als 2026-092. Moties en amendementen delen één nummerreeks.
// De sleutel is daarom jaar-nummer zonder letter.
export function motieSleutel(titel) {
  const m = String(titel || '').match(/\b(20\d{2})-(\d{2,3})[MA]?(?![\dA-Za-z])/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Zelfde motie in een bestaande titel? Voorkomt dat 2026-09 op 2026-092 matcht.
export function titelBevatSleutel(titel, sleutel) {
  if (!sleutel) return false;
  return motieSleutel(titel) === sleutel;
}

export function notubizDocumentId(url) {
  const m = String(url || '').match(/notubiz\.nl\/document\/(\d+)\/(\d+)/i);
  return m ? { id: m[1], revisie: m[2] } : null;
}

export function normaliseerNotubizUrl(url) {
  const d = notubizDocumentId(url);
  return d ? `https://api.notubiz.nl/document/${d.id}/${d.revisie}` : (url || null);
}

// Uitslagwoord vooraan de titel, in de vorm die de griffie op gestempelde
// documenten gebruikt en die al in raw_items staat ("AANGENOMEN Motie ...").
export function bestaandUitslagwoord(titel) {
  const eerste = String(titel || '').trim().split(/\s+/)[0]?.toUpperCase();
  return UITSLAGWOORDEN.includes(eerste) ? eerste : null;
}

export function uitslagwoord(uitslag) {
  const w = String(uitslag || '').trim().toUpperCase();
  return UITSLAGWOORDEN.includes(w) ? w : null;
}

export function titelMetUitslag(titel, uitslag) {
  const kaal = String(titel || '').trim();
  const nieuw = uitslagwoord(uitslag);
  if (!nieuw) return kaal;
  const oud = bestaandUitslagwoord(kaal);
  const zonder = oud ? kaal.slice(oud.length).trim() : kaal;
  return `${nieuw} ${zonder}`;
}

// Uitslag komt uitsluitend uit het stempel van de griffie in de titel
// ("VERWORPEN Motie 2026-054M ..."), niet uit het veld `uitslag` van RaadKijker.
// Dat veld is bij ongestempelde versies soms fout: Motie 2026-054M staat bij
// RaadKijker in de ongestempelde versie (393321, data_level verrijkt_ai) als
// aangenomen, terwijl het gestempelde stuk (393547) en raw_item 6681 VERWORPEN
// zeggen. Gemeten 23 september 2026.
export function uitslagUitStempel(titel) {
  return bestaandUitslagwoord(titel);
}

const VOORLOPIG = ['VERDAAGD', 'AANGEHOUDEN'];

// Moet een bestaande titel een uitslag krijgen? Alleen als de RaadKijker-titel
// een stempel heeft en de bestaande titel nog geen definitieve uitslag heeft.
// Een bestaand definitief stempel wordt nooit overschreven.
export function uitslagWijziging(bestaandeTitel, raadkijkerTitel) {
  const nieuw = uitslagUitStempel(raadkijkerTitel);
  if (!nieuw) return null;
  const oud = bestaandUitslagwoord(bestaandeTitel);
  if (oud === nieuw) return null;
  if (oud && !VOORLOPIG.includes(oud)) return null;
  return titelMetUitslag(bestaandeTitel, nieuw);
}

// De griffie hergebruikt soms een nummer: 2026-057M is in april "Bruggen
// bouwen" en in mei "Maak en houd vergunningen betaalbaar". Een nummer alleen is
// dus geen identiteit. Twee titels met hetzelfde nummer gelden als dezelfde
// motie als ze ook inhoudelijke woorden delen (partijnamen tellen niet mee).
const STOP = new Set(('motie moties amendement aangenomen verworpen ingetrokken verdaagd aangehouden ' +
  'amersfoort amersfoort2014 a2014 keihart vrijheid christenunie beter dieren partij forum democratie ' +
  'denk bpa avv sgp voor van het een met aan bij over door niet naar zijn wordt').split(' '));
function woorden(titel) {
  return new Set(String(titel || '').toLowerCase()
    .replace(/\b20\d{2}-\d{2,3}[ma]?\b/g, ' ')
    .split(/[^a-z0-9à-ÿ]+/)
    .filter(w => w.length >= 4 && !STOP.has(w)));
}
export function zelfdeMotie(titelA, titelB) {
  const sa = motieSleutel(titelA);
  if (!sa || sa !== motieSleutel(titelB)) return false;
  const a = woorden(titelA), b = woorden(titelB);
  if (!a.size || !b.size) return true; // niets om te vergelijken: nummer beslist
  let gedeeld = 0;
  for (const w of a) if (b.has(w)) gedeeld++;
  return gedeeld >= 2 || gedeeld / Math.min(a.size, b.size) >= 0.5;
}

// Kop boven de tekst, zodat intake, NER en weger indiener en uitslag zien
// zonder de bron te kennen.
export function inhoudskop(m) {
  const regels = [
    `${m.type === 'amendement' ? 'Amendement' : 'Motie'} gemeenteraad Amersfoort`,
    m.datum ? `Raadsvergadering: ${m.datum}` : null,
    m.indiener_partij ? `Ingediend door: ${m.indiener_partij}` : null,
    `Uitslag: ${uitslagUitStempel(m.titel)?.toLowerCase() || 'nog niet bekend'}`,
  ].filter(Boolean);
  return regels.join('\n');
}

// Items zonder motienummer overslaan. Dat zijn verzamelpunten van de agenda
// ("Moties", "Besluiten zonder debat, met amendementen en moties") en oude
// stukken met een verkeerde datum ("Amendement Zwaluwstaarten, 25 januari 2022"
// staat bij RaadKijker op 2026-06-03).
export function isBruikbaar(m) {
  if (!m || !m.titel || !m.bron_document_url) return false;
  const sleutel = motieSleutel(m.titel);
  if (!sleutel) return false;
  const jaar = Number(sleutel.slice(0, 4));
  const datumJaar = Number(String(m.datum || '').slice(0, 4));
  return !datumJaar || Math.abs(datumJaar - jaar) <= 1;
}
