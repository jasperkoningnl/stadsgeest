'use strict';

const SCORE_MODEL = 'redactioneel-2';
const SCORE_THRESHOLD = 7;
const CRITERIA = { ontdekking: 4, bewijs: 3, gevolgen: 3 };
const CONDITIONS = ['bronregel', 'lokaal', 'vergelijkbaar', 'nieuwheid', 'tegenverklaring'];

function validateScore(tip, field) {
  const errors = [];
  const w = tip?.weging;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return errors;
  if (w._model !== SCORE_MODEL) errors.push(`${field}.weging._model moet ${SCORE_MODEL} zijn; oude scores worden niet opnieuw geschreven.`);
  if (!['onderzoek', 'nieuwsfeit'].includes(w._route)) errors.push(`${field}.weging._route moet onderzoek of nieuwsfeit zijn.`);
  let sum = 0;
  for (const [name, max] of Object.entries(CRITERIA)) {
    if (!Number.isInteger(w[name]) || w[name] < 0 || w[name] > max) errors.push(`${field}.weging.${name} moet een geheel getal van 0 tot ${max} zijn.`);
    else sum += w[name];
  }
  for (const key of Object.keys(w)) {
    if (!Object.hasOwn(CRITERIA, key) && !['_model', '_route', '_voorwaarden', '_onderbouwing', '_nieuwsfeit_reden', '_run'].includes(key)) {
      errors.push(`${field}.weging.${key} is geen criterium in ${SCORE_MODEL}; geen losse bron-, bedrag- of locatiebonussen.`);
    }
  }
  if (tip.score !== sum) errors.push(`${field}.score moet de som van ontdekking, bewijs en gevolgen zijn (${sum}).`);
  if (tip.score < SCORE_THRESHOLD || tip.score > 10) errors.push(`${field}.score moet minimaal ${SCORE_THRESHOLD} en maximaal 10 zijn; geen uitzondering onder de drempel.`);
  if (w.ontdekking < 2 || w.bewijs < 2 || w.gevolgen < 1) errors.push(`${field} vereist minstens 2 voor ontdekking, 2 voor bewijs en 1 voor gevolgen.`);
  for (const name of CONDITIONS) {
    if (w._voorwaarden?.[name] !== true) errors.push(`${field}.weging._voorwaarden.${name} moet expliciet gecontroleerd en true zijn.`);
  }
  for (const name of ['ontdekking', 'bewijs', 'gevolgen', 'tegenverklaring', 'nieuwheid']) {
    if (typeof w._onderbouwing?.[name] !== 'string' || !w._onderbouwing[name].trim()) errors.push(`${field}.weging._onderbouwing.${name} is verplicht.`);
  }
  if (w._route === 'nieuwsfeit') {
    if (w.gevolgen !== 3) errors.push(`${field}: de route nieuwsfeit vereist zwaar lokaal belang (gevolgen 3).`);
    if (typeof w._nieuwsfeit_reden !== 'string' || !w._nieuwsfeit_reden.trim()) errors.push(`${field}.weging._nieuwsfeit_reden moet het uitzonderlijke actuele feit verklaren.`);
  }
  if (tip.supertip === true && w._route !== 'onderzoek') errors.push(`${field}: een supertip gebruikt de route onderzoek.`);
  return errors;
}

module.exports = { SCORE_MODEL, SCORE_THRESHOLD, CRITERIA, CONDITIONS, validateScore };
