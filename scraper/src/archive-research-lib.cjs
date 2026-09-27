'use strict';

const crypto = require('node:crypto');
const { scanTekst } = require('./woo-scan-lib.cjs');

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

const WOO_TERM = {
  geldproblemen: {
    liquiditeit: 'liquiditeit', faillissement: 'faillissement', surseance: 'faillissement',
    exploitatietekort: 'exploitatietekort', 'extra voorschot': 'extra voorschot', 'aanvullend voorschot': 'extra voorschot',
  },
  juridisch_conflict: {
    aansprakelijk: 'aansprakelijkstelling', ingebrekestelling: 'ingebrekestelling', 'kort geding': 'kort geding',
    schikking: 'schikking', vaststellingsovereenkomst: 'vaststellingsovereenkomst', dwangsom: 'dwangsom',
  },
  integriteit_toezicht: {
    integriteit: 'integriteit', fraude: 'fraude', klokkenluider: 'klokkenluider', bibob: 'bibob',
    'verscherpt toezicht': 'verscherpt toezicht', ondermijning: 'ondermijning', aangifte: 'strafrechtelijk',
  },
};

function gevondenTermen(spoor, document) {
  const tekst = normaliseerTekst(`${document.title ?? ''} ${document.body ?? ''}`);
  const direct = spoor.terms.filter((term) => tekst.includes(normaliseerTekst(term)));
  const mapping = WOO_TERM[spoor.id];
  if (!mapping) return direct;
  const inhoudelijkeHits = new Set(scanTekst(tekst).map((hit) => hit.term));
  return direct.filter((term) => inhoudelijkeHits.has(mapping[term]));
}

function inhoudHash(value) {
  return crypto.createHash('sha256').update(normaliseerTekst(value)).digest('hex');
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
  const inhoudGezien = new Set();
  const uit = [];
  for (const kandidaat of kandidaten) {
    const sleutel = kandidaat.raw_item_id ? `item:${kandidaat.raw_item_id}` : kandidaat.doc_key;
    if (gezien.has(sleutel) || (kandidaat.inhoud_hash && inhoudGezien.has(kandidaat.inhoud_hash))) continue;
    gezien.add(sleutel);
    if (kandidaat.inhoud_hash) inhoudGezien.add(kandidaat.inhoud_hash);
    uit.push(kandidaat);
    if (uit.length >= maximum) break;
  }
  return uit;
}

module.exports = { SPOREN, gevondenTermen, inhoudHash, normaliseerTekst, scoreKandidaat, uniekOpDocument };
