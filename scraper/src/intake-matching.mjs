// Pure matchregels voor de intake. Dit bestand bevat bewust geen databasecode,
// zodat de regels met regressietests en historische replays te controleren zijn.

const STOPWOORDEN = new Set([
  'de','het','een','en','van','in','te','dat','is','op','aan','met','er','maar','om','dan','ook','door','als','bij','dit','zijn','uit','noch','naar','tot','onder','over','worden','heeft','was','voor','nog','wel','niet','meer','zo','nu','al','elke','alle','elk','die','wat','wie','hoe','waar','wanneer','welke','hoeveel','waarom','echter','omdat','want','toch','ja','nee','hier','daar','deze','zeer','veel','minder','andere','ieder','iedere','werd','hebben','kunnen','zal','zou','mogen','willen','gaan',
  // Regio- en registertaal zegt niets over het concrete onderwerp.
  'amersfoort','amersfoortse','leusden','leusdense','gemeente','gemeentelijke',
  'besluit','aanvraag','bekendmaking','vergadering','agenda','vergunning',
  'omgevingsvergunning','verleende','verleend','ontvangen','perceel','plaatsen',
  'kappen','boom','bomen','slopen','realiseren','wijzigen','vervangen','tijdelijk',
  'gebruik','hoogte','container','steiger','kennisgeving','ontvangst','beschikking',
  'behandelen','intrekken','ingetrokken','buiten','behandeling','laten','aangevraagd',
  'vertrokken','onbekende','bestemming','beslistermijn','verlengen','verlengd',
  'woning','dakvlak','dakkapel','voorgevel','achtergevel','gevel','dakterras',
  'verdachte','straf','taakstraf','geldboete','rijontzegging','voorwaardelijke',
  'januari','februari','maart','april','mei','juni','juli','augustus','september',
  'oktober','november','december','2024','2025','2026','2027','2028',
  // Sjabloonvelden van raadsstukken. Deze veroorzaakten ondanks een score van
  // 6-9 nog steeds koppelingen tussen inhoudelijk totaal verschillende stukken.
  'schriftelijke','vragen','vraag','feitelijke','beantwoording','raadsinformatiebrief',
  'programma','nummer','onderwerp','inwoner','kennisnemen','bekijken','commissie',
  'bestuur','omgeving','sociaal','bedrijvigheid','college','raad','advies',
  'inspreektekst','betrekken','gunning','aanbesteding','marktconsultatie',
]);

const HARDE_SJABLONEN = new Set([
  'rechtspraak', 'verkeersbesluit', 'vergunning', 'ingekomen_stuk', 'spoorstoring',
]);

function ascii(text) {
  return (text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

export function normalizeTitle(text) {
  return ascii(text).replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function tokenizeTitle(text) {
  return normalizeTitle(text).split(' ').filter(w => w.length > 3 && !STOPWOORDEN.has(w));
}

export function bronwereld(naam) {
  const n = ascii(naam);
  if (n.includes('rechtspraak') || n.includes('raad van state')) return 'rechtspraak';
  if (n.includes('bekendmaking') || n.startsWith('ob ') || n.includes('gemeenteblad')
      || n.includes('provinciaal blad') || n.includes('waterschapsblad')
      || n.includes('verkeersbesluit') || n.includes('omgevingsvergunning')) return 'bekendmaking';
  if (n.includes('inspectie') || n.includes('nvwa') || n.includes('omgevingsdienst')
      || n.includes('lrk') || n.includes('toezicht')) return 'inspectie';
  return 'anders';
}

function recordTitle(record) {
  return record?.seed_title || record?.title || '';
}

function recordSource(record) {
  return record?.seed_source_name || record?.source_name || '';
}

export function documentSoort(record) {
  const title = ascii(recordTitle(record));
  const source = ascii(recordSource(record));
  if (/\becli:[a-z]{2}:[a-z0-9]+:\d{4}:[a-z0-9.]+\b/i.test(title)
      || source.includes('rechtspraak') || source.includes('raad van state')) return 'rechtspraak';
  if (title.includes('verkeersbesluit') || source.includes('verkeersbesluit')) return 'verkeersbesluit';
  if (title.includes('schriftelijke vragen') || source.includes('schriftelijke vragen')) return 'schriftelijke_vraag';
  if (title.includes('raadsinformatiebrief') || source.includes('raadsinformatiebrieven')) return 'raadsinformatiebrief';
  if (/^\s*\d+\.\s+[^\d]+\s+\d{2,4}\b/.test(title) || source.includes('ingekomen stukken')) return 'ingekomen_stuk';
  if (title.startsWith('[ns]') || source.includes('ns verstoring')) return 'spoorstoring';
  if (title.includes('omgevingsvergunning') || title.includes('vergunningvrij')
      || source.includes('omgevingsvergunning')) return 'vergunning';
  if (source.includes('inspectie') || /^inspectie\b/.test(title)) return 'inspectie';
  if (source.includes('tenderned') || /^(gunning|aanbesteding|marktconsultatie)\b/.test(title)) return 'aanbesteding';
  return 'overig';
}

export function documentReferentie(record) {
  const title = ascii(recordTitle(record));
  const soort = documentSoort(record);
  if (soort === 'rechtspraak') return title.match(/\becli:[a-z]{2}:[a-z0-9]+:\d{4}:[a-z0-9.]+\b/)?.[0] || null;
  if (soort === 'schriftelijke_vraag' || soort === 'raadsinformatiebrief') {
    return title.match(/\b20\d{2}[-/]\d{2,4}\b/)?.[0]?.replace('/', '-') || null;
  }
  if (soort === 'ingekomen_stuk') {
    const m = title.match(/^\s*(\d+)\.\s+[^\d]+?\s+(\d{2,4})\b/);
    return m ? `${m[1]}-${m[2]}` : null;
  }
  return null;
}

export function adresSleutels(record) {
  const title = ascii(recordTitle(record));
  const keys = new Set();
  // Huisnummer direct vóór een Nederlandse postcode: "Straat 74, 3818 PN".
  for (const m of title.matchAll(/\b(\d+[a-z]?(?:-\d+[a-z]?)?)\s*,?\s*(\d{4})\s*([a-z]{2})\b/g)) {
    keys.add(`${m[2]}${m[3]}:${m[1]}`);
  }
  return keys;
}

export function matchBewijs(item, signal) {
  const a = new Set(tokenizeTitle(recordTitle(item)));
  const b = new Set(tokenizeTitle(recordTitle(signal)));
  let common = 0;
  for (const token of a) if (b.has(token)) common++;
  const kleinste = Math.min(a.size, b.size);
  return {
    common,
    coverage: kleinste ? common / kleinste : 0,
    itemTokens: a.size,
    signalTokens: b.size,
  };
}

export function zelfdeSpecifiekeReferentie(item, signal) {
  const aSoort = documentSoort(item);
  const bSoort = documentSoort(signal);
  const aRef = documentReferentie(item);
  const bRef = documentReferentie(signal);
  if (aSoort === bSoort && aRef && bRef && aRef === bRef) return true;

  const aAdres = adresSleutels(item);
  const bAdres = adresSleutels(signal);
  for (const key of aAdres) if (bAdres.has(key)) return true;
  return false;
}

export function documentConflict(item, signal) {
  const aSoort = documentSoort(item);
  const bSoort = documentSoort(signal);
  const aRef = documentReferentie(item);
  const bRef = documentReferentie(signal);
  return aSoort === bSoort && aRef && bRef && aRef !== bRef;
}

export function woordMatchScore(item, signal) {
  if (normalizeTitle(recordTitle(item)) === normalizeTitle(recordTitle(signal))) {
    return Math.max(3, tokenizeTitle(recordTitle(signal)).length);
  }
  if (documentConflict(item, signal)) return 0;

  const aSoort = documentSoort(item);
  const bSoort = documentSoort(signal);
  const specifiek = zelfdeSpecifiekeReferentie(item, signal);
  const bewijs = matchBewijs(item, signal);

  if (specifiek) return bewijs.common >= 2 ? Math.max(3, bewijs.common) : 0;
  if (HARDE_SJABLONEN.has(aSoort) || HARDE_SJABLONEN.has(bSoort)) return 0;

  // Verschillende raadsdocumenten mogen alleen koppelen als hun concrete
  // onderwerp vrijwel hetzelfde is (bijv. RIB plus vragen over hetzelfde plan).
  const raadA = aSoort === 'schriftelijke_vraag' || aSoort === 'raadsinformatiebrief';
  const raadB = bSoort === 'schriftelijke_vraag' || bSoort === 'raadsinformatiebrief';
  if (raadA || raadB) return bewijs.common >= 4 && bewijs.coverage >= 0.6 ? bewijs.common : 0;

  // Titel-only: summary/content tellen niet meer mee. Dat was de grootste bron
  // van score-3-koppelingen tussen volstrekt ongerelateerde stukken.
  return bewijs.common >= 3 && bewijs.coverage >= 0.6 ? bewijs.common : 0;
}

export function entiteitMatchToegestaan(item, signal, { strongMatches = 0, locationMatches = 0 } = {}) {
  if (normalizeTitle(recordTitle(item)) === normalizeTitle(recordTitle(signal))) return true;
  if (documentConflict(item, signal)) return false;
  if (zelfdeSpecifiekeReferentie(item, signal)) return true;

  const aSoort = documentSoort(item);
  const bSoort = documentSoort(signal);
  if (HARDE_SJABLONEN.has(aSoort) || HARDE_SJABLONEN.has(bSoort)) return false;

  const bewijs = matchBewijs(item, signal);
  if (strongMatches >= 2) return bewijs.common >= 1;
  if (strongMatches >= 1) return bewijs.common >= 2 && bewijs.coverage >= 0.35;

  // Alleen gebiedsnamen zijn geen betrouwbaar bewijs. Een exact adres is
  // hierboven al toegelaten via dezelfdeSpecifiekeReferentie.
  return locationMatches >= 3 && bewijs.common >= 3 && bewijs.coverage >= 0.6;
}
