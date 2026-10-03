// ob-routing.mjs — welke bronrij een officiële bekendmaking van Amersfoort
// krijgt. Pure functies, los te testen; gebruikt door
// scrapers/officielebekendmakingen-repo.js.
//
// Elk item krijgt een bron op basis van zijn rubriek (de documenttypes uit de
// SRU-metadata). Zo blijft de tier-indeling bruikbaar en kan de weger
// onderscheid maken tussen een dakkapel en een bestemmingsplanwijziging.
//
// Sinds 3 oktober 2026 gaat de titel vóór de rubriek voor één categorie:
// grond en vastgoed. Na het Didam-arrest moet de gemeente elk voornemen tot
// verkoop, verhuur of uitgifte van grond en gebouwen publiceren, met partij,
// locatie en vaak de prijsvorm. Die publicaties vielen onder "Gemeenteblad
// overig" en verdwenen daar tussen de routine; nu hebben ze een eigen bron.

export const RUBRIEK_ROUTING = [
  { match: /omgevingsvergunning|omgevingsmelding|bouw/i, source: 'ob-omgevingsvergunningen', name: 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort', tier: 1 },
  { match: /verkeersbesluit/i,                            source: 'ob-verkeersbesluiten',      name: 'Officiële Bekendmakingen — Verkeersbesluiten Amersfoort', tier: 1 },
  { match: /verordening|algemeen verbindend voorschrift/i, source: 'ob-verordeningen',          name: 'Officiële Bekendmakingen — Verordeningen Amersfoort', tier: 1 },
  { match: /beleidsregel/i,                               source: 'ob-beleidsregels',          name: 'Officiële Bekendmakingen — Beleidsregels Amersfoort', tier: 1 },
  { match: /evenementenvergunning|apv|ontheffing/i,       source: 'ob-vergunningen-overig',    name: 'Officiële Bekendmakingen — Vergunningen overig Amersfoort', tier: 1 },
  { match: /ruimtelijk|bestemmingsplan|omgevingsplan/i,   source: 'ob-ruimtelijke-plannen',    name: 'Officiële Bekendmakingen — Ruimtelijke plannen Amersfoort', tier: 1 },
];

export const FALLBACK_SOURCE = { source: 'ob-gemeenteblad-overig', name: 'Officiële Bekendmakingen — Gemeenteblad overig Amersfoort', tier: 1 };

// Titelpatronen voor grond en vastgoed. "voornemen tot" plus een
// transactiewoord, de Didam-formules ("enige serieuze gegadigde",
// "één serieuze gegadigde"), en de gemeentelijke standaardkoppen voor
// verkoop of uitgifte van grond, percelen en gebouwen. Een bouwkavel voor
// particulieren telt ook: dat is grond die de gemeente uitgeeft.
export const GROND_VASTGOED = {
  match: /voornemen\s+(?:tot|om)\s+(?:de\s+)?(?:verkoop|verhuur|uitgifte|vestiging|ingebruikgeving|ruil)|(?:enige|één|een)\s+serieuze\s+gegadigde|didam|(?:verkoop|verhuur|uitgifte|ruil|ingebruikgeving)\s+(?:van\s+)?(?:(?:een\s+)?(?:perceel|percelen|strook|stroken|gemeentegrond|grond|bouwkavel|kavel|kavels|snippergroen|restgroen|pand|gebouw|vastgoed|opstal|erfpacht|gemeentelijk)|.{0,40}\b(?:perceel|grond|kavel|pand|vastgoed)\b)|erfpacht(?:s)?(?:uitgifte|recht)|gronduitgifte|grondverkoop|snippergroen/i,
  source: 'ob-grond-vastgoed',
  name: 'Officiële Bekendmakingen — Grond en vastgoed Amersfoort',
  tier: 1,
};

/** Alle brondefinities die de scraper vooraf als bronrij klaarzet. */
export const ALLE_BRONNEN = [...RUBRIEK_ROUTING, GROND_VASTGOED, FALLBACK_SOURCE];

/**
 * Bron voor een publicatie. De titel gaat voor bij grond en vastgoed; daarna
 * beslist de rubriek; de rest is Gemeenteblad overig.
 */
export function routeRubriek(docTypes, title = '') {
  if (title && GROND_VASTGOED.match.test(String(title))) return GROND_VASTGOED;
  const joined = (docTypes || []).join(' ');
  for (const r of RUBRIEK_ROUTING) if (r.match.test(joined)) return r;
  return FALLBACK_SOURCE;
}
