// waaroverheid.js — WaarOverheid, gemeente Amersfoort
//
// Onderzocht op 9 augustus 2026. NIET GEREPAREERD, en dat is een bevinding, geen
// nalatigheid. Wat hier stond logde 0/0/0 met als vermoeden "React-SPA met
// bot-detectie". Dat vermoeden klopt niet. Wat er werkelijk aan de hand is:
//
//   1. waaroverheid.nl bestaat niet meer als eigen product. Elk verzoek wordt
//      doorgestuurd naar openbesluitvorming.nl; /gemeente/amersfoort geeft daar
//      een 404 met de tekst "Niet gevonden".
//   2. openbesluitvorming.nl draait op Open Raadsinformatie. De data komt uit
//      https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search —
//      exact het endpoint dat raadsinformatie-ori.js sinds 2 augustus al leest.
//   3. Die index bevat voor Amersfoort 9.672 documenten in vier soorten:
//      MediaObject (4.242), AgendaItem (3.202), Meeting (2.170) en Organization (58).
//      raadsinformatie-ori.js haalt de eerste drie al op. Er is dus niets dat
//      WaarOverheid zou toevoegen behalve dezelfde documenten onder een tweede naam.
//
// Wat WaarOverheid vroeger onderscheidde was de kaart: besluiten op een adres
// tonen. Die geo-laag zit niet in de open API; alleen de documenten zitten erin.
//
// Daarom staat hier geen scraper die data ophaalt. Volgens de werkafspraak van
// 9 augustus wordt een bron niet uitgezet: dit bestand blijft draaien en blijft in
// run-browser.js staan. Wat het elke run doet is de aanname toetsen die hierboven
// staat, zodat het opvalt op de dag dat openbesluitvorming wél weer een eigen
// ingang krijgt. Er wordt bewust niets weggeschreven.
//
// BESLISSING AAN JASPER: rij 'WaarOverheid — gemeente Amersfoort' is hiermee een
// dubbele van de ORI-raadsinformatiestroom. Markeren als `dubbel`, of de bron een
// eigen opdracht geven (bijvoorbeeld de geo-koppeling zelf maken op basis van
// adressen in besluitteksten). Niet zelf besloten.

import db from '../db.js';
import { getOrCreateSource, logResult } from '../utils.js';

const SOURCE_URL = 'https://waaroverheid.nl/gemeente/amersfoort';
const ORI = 'https://api.openraadsinformatie.nl/v1/elastic/ori_amersfoort*/_search?size=0';
const UA = 'Stadsgeest033/1.0 (+https://stadsgeest.nl; redactie@nieuwsplein33.nl)';

async function toetsAanname() {
  const bevindingen = [];

  try {
    const resp = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    const doorgestuurd = new URL(resp.url).hostname;
    bevindingen.push(`waaroverheid.nl → ${doorgestuurd} (HTTP ${resp.status})`);
    if (!/openbesluitvorming\.nl$/.test(doorgestuurd) || resp.ok) {
      bevindingen.push('AFWIJKING: het doorsturen naar openbesluitvorming.nl is veranderd of de pagina bestaat weer — opnieuw beoordelen of deze bron eigen materiaal kan leveren');
    }
  } catch (err) {
    bevindingen.push(`waaroverheid.nl niet bereikbaar (${err.name})`);
  }

  try {
    const resp = await fetch(ORI, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const json = await resp.json();
    const totaal = json?.hits?.total?.value ?? '?';
    bevindingen.push(`ORI-index ori_amersfoort*: ${totaal} documenten, wordt al gelezen door raadsinformatie-ori.js`);
  } catch (err) {
    bevindingen.push(`ORI-index niet bereikbaar (${err.name})`);
  }

  return bevindingen;
}

async function scrape() {
  const sourceId = await getOrCreateSource(db, {
    name: 'WaarOverheid — gemeente Amersfoort',
    url: SOURCE_URL,
    sourceType: 'scrape',
    reliability: 'secondary',
    category: 'government',
    scrapeFrequency: 'weekly',
  });

  for (const regel of await toetsAanname()) console.log(`  WaarOverheid: ${regel}`);
  console.log('  WaarOverheid: bewust niets opgeslagen — zie de kop van dit bestand. Wacht op besluit van Jasper.');

  await logResult(db, sourceId, 'WaarOverheid — gemeente Amersfoort (dubbel met ORI, wacht op besluit)', 0, 0, 0, 0);
}

scrape().catch(console.error);
