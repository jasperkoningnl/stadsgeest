'use strict';

// Journalistieke zoeksporen voor de lokale archiefindex. De termen zijn bewust
// breder dan de Woo-promotieregels: de uitkomst is een onderzoekskandidaat, nog
// geen feit of tip. Alle zware zoekopdrachten draaien lokaal via FTS5.
const SPOREN = [
  {
    id: 'geldproblemen',
    label: 'Financiële problemen en onverwachte kosten',
    query: 'liquiditeit* OR faillissement OR surseance OR exploitatietekort OR begrotingsoverschrijding OR "extra voorschot" OR "aanvullend voorschot"',
    terms: ['liquiditeit', 'faillissement', 'surseance', 'exploitatietekort', 'begrotingsoverschrijding', 'extra voorschot', 'aanvullend voorschot'],
  },
  {
    id: 'juridisch_conflict',
    label: 'Juridisch conflict of aansprakelijkheid',
    query: 'aansprakelijk* OR ingebrekestelling OR "kort geding" OR schikking OR vaststellingsovereenkomst OR dwangsom',
    terms: ['aansprakelijk', 'ingebrekestelling', 'kort geding', 'schikking', 'vaststellingsovereenkomst', 'dwangsom'],
  },
  {
    id: 'integriteit_toezicht',
    label: 'Integriteit, toezicht en handhaving',
    query: 'integriteit* OR fraude OR klokkenluider OR bibob OR "verscherpt toezicht" OR ondermijning OR aangifte',
    terms: ['integriteit', 'fraude', 'klokkenluider', 'bibob', 'verscherpt toezicht', 'ondermijning', 'aangifte'],
  },
  {
    id: 'vertraging_belofte',
    label: 'Vertraging, uitstel en niet-gehaalde afspraken',
    query: 'vertraging OR uitstel OR achterstand OR "niet gehaald" OR "niet nagekomen" OR overschrijding OR tekort',
    terms: ['vertraging', 'uitstel', 'achterstand', 'niet gehaald', 'niet nagekomen', 'overschrijding', 'tekort'],
  },
  {
    id: 'publiek_geld',
    label: 'Publiek geld, subsidies en aanbestedingen',
    query: 'subsidie OR aanbesteding OR meerkosten OR miljoenen OR kostenstijging OR krediet OR bevoorschotting',
    terms: ['subsidie', 'aanbesteding', 'meerkosten', 'miljoenen', 'kostenstijging', 'krediet', 'bevoorschotting'],
  },
];

function normaliseerTekst(value) {
  return String(value ?? '').toLocaleLowerCase('nl-NL').replace(/\s+/g, ' ').trim();
}

function gevondenTermen(spoor, document) {
  const tekst = normaliseerTekst(`${document.title ?? ''} ${document.body ?? ''}`);
  return spoor.terms.filter((term) => tekst.includes(normaliseerTekst(term)));
}

function scoreKandidaat(spoor, document) {
  const termen = gevondenTermen(spoor, document);
  const titel = normaliseerTekst(document.title);
  const titelTreffers = termen.filter((term) => titel.includes(normaliseerTekst(term))).length;
  const bijlageBonus = document.kind === 'attachment' ? 1 : 0;
  return {
    score: Math.min(10, 2 + termen.length + Math.min(2, titelTreffers) + bijlageBonus),
    termen,
  };
}

function uniekOpDocument(kandidaten, maximum) {
  const gezien = new Set();
  const uit = [];
  for (const kandidaat of kandidaten) {
    const sleutel = kandidaat.raw_item_id ? `item:${kandidaat.raw_item_id}` : kandidaat.doc_key;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    uit.push(kandidaat);
    if (uit.length >= maximum) break;
  }
  return uit;
}

module.exports = { SPOREN, gevondenTermen, normaliseerTekst, scoreKandidaat, uniekOpDocument };
