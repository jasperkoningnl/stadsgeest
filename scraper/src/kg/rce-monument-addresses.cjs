'use strict';

const { fetchBuffer } = require('./phase3-core.cjs');
const RCE_SPARQL = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/cho/services/cho/sparql';
const QUERY = `PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
  SELECT DISTINCT ?nr ?pc ?adres WHERE {
    VALUES ?g { "Amersfoort" "Leusden" }
    ?b ceo:gemeentenaam ?g .
    ?m ceo:rijksmonumentnummer ?nr ; ceo:heeftBasisregistratieRelatie ?b .
    ?b ceo:heeftBAGRelatie ?r . ?r ceo:postcode ?pc ; ceo:volledigAdres ?adres . }`;

async function loadMonumentAddresses({ fetchImpl = fetch } = {}) {
  const url = new URL(RCE_SPARQL);
  url.searchParams.set('query', QUERY);
  // Zelfde retry/backoff als de adapters: maximaal drie pogingen.
  const { buffer } = await fetchBuffer(url, { fetchImpl, attempts: 3, timeoutMs: 60_000,
    accept: 'application/sparql-results+json', label: 'RCE SPARQL' });
  const rows = JSON.parse(buffer.toString('utf8'))?.results?.bindings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('RCE SPARQL: monumentadressen ontbreken');
  return rows.map((b) => {
    const nr = b.nr?.value, postcode = b.pc?.value, line = b.adres?.value;
    if (typeof nr !== 'string' || !/^\d+$/.test(nr) || typeof postcode !== 'string'
      || !/^\d{4}\s?[A-Z]{2}$/.test(postcode) || typeof line !== 'string' || !line.trim()) {
      throw new Error('RCE SPARQL: ongeldige monumentadresrij');
    }
    return { sourceId: 154, ref: `monument:${nr}#${line}`, role: 'monument',
      label: `Rijksmonument ${nr}`, line, postcode };
  });
}

module.exports = { loadMonumentAddresses };
