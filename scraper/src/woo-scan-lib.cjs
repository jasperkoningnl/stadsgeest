'use strict';

// woo-scan-lib.cjs — zoekt in de tekst van Woo-bijlagen naar termen die op
// nieuwswaarde wijzen. Geen netwerk en geen database, zodat de regels los te
// testen zijn. Toegevoegd 2026-09-24.
//
// Waarom: een Woo-besluit kan honderd bijlagen hebben (tot 1,2 miljoen tekens).
// De weger kreeg daarvan alleen de eerste 4.000 tekens te zien. In
// september 2026 stond in bijlage 22 van Woo-besluit 518807 dat MetMaya zijn
// rekeningen niet kon betalen; dat kwam nooit bij de weger terecht.
//
// Gewicht 3: wijst zelfstandig op een mogelijk verhaal.
// Gewicht 2: relevant, maar komt ook in routinestukken voor.
// Gewicht 1: alleen in combinatie interessant.
// Patronen gebruiken woordgrenzen: 'schikking' mag niet op 'beschikking' raken.

const TERMEN = [
  { term: 'liquiditeit', gewicht: 3, re: /\bliquiditeit(s(tekort|problemen|positie|prognose))?\b/gi },
  { term: 'faillissement', gewicht: 3, re: /\b(faillissement|failliet|surs[eé]ance)\w*/gi,
    uitsluit: [/\b(indien|wanneer|ingeval|in geval)\b[^.]{0,160}(surs[eé]ance|faillissement)/i,
      /(van\s+rechtswege|ontbinden|ontbinding|beëindig\w*|opzeggen)[^.]{0,240}(surs[eé]ance|faillissement)/i, /(surs[eé]ance|faillissement)[^.]{0,40}(is\s+)?(aangevraagd|wordt\s+verleend|wordt\s+uitgesproken)/i] },
  { term: 'fraude', gewicht: 3, re: /\b(zorg)?fraude\w*/gi,
    uitsluit: [/fraude\s+of\s+fouten|fouten\s+of\s+fraude/i, /(beschadiging|vernietiging|diefstal)[^.]{0,80}fraude/i] },
  { term: 'ondermijning', gewicht: 2, re: /\bondermijn\w*/gi },
  { term: 'integriteit', gewicht: 3, re: /\bintegriteits(schending|onderzoek|melding)\w*/gi },
  { term: 'klokkenluider', gewicht: 3, re: /\bklokkenluid\w*/gi },
  { term: 'aansprakelijkstelling', gewicht: 3, re: /\b(aansprakelijkstelling\w*|aansprakelijk\s+(ge)?ste?ld)/gi },
  { term: 'ingebrekestelling', gewicht: 3, re: /\bingebrekestelling\w*/gi,
    uitsluit: [/aanmaning\s+of\s+ingebrekestelling/i, /waarschuwing\s*,\s*ingebrekestelling/i, /zonder\s+(enige\s+|nadere\s+)?(voorafgaande\s+)?ingebrekestelling/i, /na\s+ingebrekestelling/i, /ingebrekestelling[^.]{0,80}(niet\s+tijdig|beslistermijn)/i, /(niet\s+tijdig|beslistermijn)[^.]{0,80}ingebrekestelling/i] },
  // Alleen concrete strafzaken; 'strafrechtelijk' als los woord staat in veel
  // standaardteksten (AVG, contractclausules, functieprofielen boa's).
  { term: 'strafrechtelijk', gewicht: 3, re: /\b(aangifte\s+(is\s+)?gedaan|aangifte\s+tegen|strafrechtelijk\s+onderzoek|strafrechtelijke\s+vervolging|verdachte\s+van)\b/gi },
  { term: 'kort geding', gewicht: 3, re: /\bkort\s+geding\b/gi },
  { term: 'vaststellingsovereenkomst', gewicht: 3, re: /\bvaststellingsovereenkomst\w*/gi },
  { term: 'schikking', gewicht: 2, re: /\bschikking(en|svoorstel)?\b/gi },
  { term: 'dwangsom', gewicht: 2, re: /\bdwangsom\w*/gi,
    uitsluit: [/dwangsom\w*\s+bij\s+niet\s+tijdig\s+beslissen/i] },
  { term: 'bibob', gewicht: 2, re: /\bbibob\b/gi },
  { term: 'geheimhouding', gewicht: 1, re: /\bgeheimhouding\w*/gi,
    uitsluit: [/geheimhoudingsplicht\s+en\/of\s+een\s+verschoningsrecht/i, /geheimhoudings(verklaring|verplichting)/i, /artikel\s+\d+\s*_?\s*geheimhouding/i, /geheimhouding\s+van\s+(de\s+)?persoonsgegevens/i] },
  { term: 'onrechtmatig', gewicht: 2, re: /\bonrechtmatig\w*/gi,
    uitsluit: [/onrechtmatige?\s+(gebruik|verwerking|toegang)/i, /tegen\s+verlies[^.]{0,80}onrechtmatig/i] },
  { term: 'exploitatietekort', gewicht: 2, re: /\bexploitatietekort\w*/gi },
  { term: 'extra voorschot', gewicht: 2, re: /\b(extra|aanvullend|vervroegd)e?\s+(voorschot|bevoorschotting)\w*/gi },
  { term: 'verscherpt toezicht', gewicht: 2, re: /\bverscherpt\s+toezicht\b/gi },
  { term: 'boete', gewicht: 1, re: /\b(bestuurlijke\s+boete|boeteclausule)\w*/gi },
  { term: 'overschrijding', gewicht: 1, re: /\b(budget|begrotings|kosten)overschrijding\w*|\boverschrijding\s+van\s+(het|de)\s+(budget|begroting|krediet)\w*/gi },
  { term: 'claim', gewicht: 1, re: /\bclaims?\b/gi },
];

const FRAGMENT_TEKENS = 220; // aan weerszijden van de treffer
const MAX_FRAGMENTEN_PER_TERM = 3;

// Standaardteksten die in vrijwel ieder Woo-besluit staan en anders ruis geven.
// Daarnaast heeft iedere term eigen uitsluitingen (standaardclausules in
// contracten en convenanten, vaste Woo-zinnen); die gelden voor het fragment.

function fragment(tekst, start, eind) {
  const van = Math.max(0, start - FRAGMENT_TEKENS);
  const tot = Math.min(tekst.length, eind + FRAGMENT_TEKENS);
  return (van > 0 ? '…' : '') + tekst.slice(van, tot).replace(/\s+/g, ' ').trim() + (tot < tekst.length ? '…' : '');
}

// Geeft per term het aantal treffers en hoogstens drie fragmenten terug.
function scanTekst(tekst) {
  const bron = String(tekst ?? '');
  const uit = [];
  for (const t of TERMEN) {
    t.re.lastIndex = 0;
    let aantal = 0;
    const fragmenten = [];
    let vorigeEind = -Infinity;
    for (const m of bron.matchAll(t.re)) {
      const frag = fragment(bron, m.index, m.index + m[0].length);
      if ((t.uitsluit || []).some((b) => b.test(frag))) continue;
      aantal++;
      // Treffers dicht op elkaar leveren één fragment op.
      if (fragmenten.length < MAX_FRAGMENTEN_PER_TERM && m.index > vorigeEind + FRAGMENT_TEKENS) {
        fragmenten.push(frag);
        vorigeEind = m.index;
      }
    }
    if (aantal > 0) uit.push({ term: t.term, gewicht: t.gewicht, aantal, fragmenten });
  }
  return uit;
}

// Score van een Woo-item: som van de gewichten van de verschillende termen
// (niet van het aantal treffers, anders wint het langste document).
function itemScore(treffers) {
  const perTerm = new Map();
  for (const t of treffers) perTerm.set(t.term, Math.max(perTerm.get(t.term) ?? 0, t.gewicht));
  return [...perTerm.values()].reduce((a, b) => a + b, 0);
}

const PROMOTIE_DREMPEL = 3;

module.exports = { TERMEN, scanTekst, itemScore, PROMOTIE_DREMPEL };
