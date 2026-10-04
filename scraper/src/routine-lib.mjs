// routine-lib.mjs - vast filter voor routinebekendmakingen, vóór de weger (2026-10-04).
//
// De weger zette deze items elke run één voor één weg (operations/WEGER.md,
// 'Snelle triage'). Dat kost zijn aandacht en Turso-reads. Dit filter haalt er
// in de intake alleen de soorten uit waar geen verband iets aan verandert:
// de vergunning 'tijdelijk gebruik van de weg' voor een container, steiger,
// bouwplaats en dergelijke, en een verlengde beslistermijn. Gemeten op dertig
// dagen bekendmakingen: 173 van de 579.
//
// Bewust NIET hier: dakkapellen, kozijnen, dakopbouwen en het kappen van een
// boom. Die kunnen op een rijksmonument liggen of een patroon vormen; dat ziet
// pas de adreskoppeling, en die draait na de intake. Die blijven bij de weger.
//
// Het item blijft in raw_items staan en de reden komt in intake_decisions, dus
// niets is onvindbaar kwijt.

const GEBRUIK_WEG = /vergunning tijdelijk gebruik van de weg/i;
const VOORWERP = /container|steiger|verhuislift|hoogwerker|dixi|toilet|schaft|bouwkeet|bouwplaats|bouwhek|kraan|kranen|opslag/i;
const BESLISTERMIJN = /\bverleng(?:ing|en|d)\b[^.]{0,40}\bbeslistermijn\b|\bbeslistermijn\b[^.]{0,40}\bverleng(?:ing|en|d)\b/i;

/** Reden om een item als routine weg te filteren, of null. */
export function routineReden(item) {
  const bron = String(item?.source_name || '');
  if (!bron.startsWith('Officiële Bekendmakingen')) return null;
  const titel = String(item?.title || '');
  if (!titel) return null;
  if (BESLISTERMIJN.test(titel)) return 'routine: verlengde beslistermijn';
  if (GEBRUIK_WEG.test(titel) && VOORWERP.test(titel)) {
    return 'routine: tijdelijk gebruik van de weg (container, steiger, bouwplaats en dergelijke)';
  }
  return null;
}
