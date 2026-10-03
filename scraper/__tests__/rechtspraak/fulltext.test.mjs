import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haalRechtspraakTekst,
  rechtspraakContentUrl,
  rechtspraakEcli,
  uitspraakTekst,
} from '../../src/rechtspraak-fulltext.mjs';

// Vorm van het open-data-XML van data.rechtspraak.nl (3 oktober 2026), ingekort.
const RDF = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/">
  <rdf:Description><dcterms:identifier>ECLI:NL:RBMNE:2026:6359</dcterms:identifier>
  <dcterms:subject>Bestuursrecht; Belastingrecht</dcterms:subject></rdf:Description></rdf:RDF>`;
const lichaam = 'De rechtbank verklaart het beroep ongegrond. '.repeat(8).trim();
const metTekst = `<?xml version="1.0" encoding="utf-8"?><open-rechtspraak>${RDF}
  <inhoudsindicatie id="x"><para>WOZ-waarde woning; beroep ongegrond.</para></inhoudsindicatie>
  <uitspraak id="y" xml:space="preserve"><uitspraak.info><para>RECHTBANK MIDDEN-NEDERLAND</para></uitspraak.info>
  <section><para>${lichaam}</para><para>Eiser &amp; de heffingsambtenaar van &#233;&#233;n gemeente.</para></section></uitspraak>
</open-rechtspraak>`;
const alleenMetadata = `<?xml version="1.0" encoding="utf-8"?><open-rechtspraak>${RDF}</open-rechtspraak>`;

const antwoord = (xml, status = 200) => ({ ok: status === 200, status, text: async () => xml });

test('haalt de ECLI uit de bekende URL-vormen van rechtspraak.nl', () => {
  assert.equal(rechtspraakEcli('https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBMNE:2026:2416'), 'ECLI:NL:RBMNE:2026:2416');
  assert.equal(rechtspraakEcli('https://data.rechtspraak.nl/uitspraken/content?id=ECLI%3ANL%3ARBMNE%3A2026%3A6727'), 'ECLI:NL:RBMNE:2026:6727');
  assert.equal(rechtspraakEcli('https://uitspraken.rechtspraak.nl/inziendocument?id=ECLI:NL:GHARL:2026:1234'), 'ECLI:NL:GHARL:2026:1234');
  assert.equal(rechtspraakEcli('https://data.rechtspraak.nl/uitspraken/zoeken?q=Amersfoort'), null);
  assert.equal(rechtspraakEcli('https://example.nl/details?id=ECLI:NL:RBMNE:2026:2416'), null);
  assert.equal(rechtspraakContentUrl('ECLI:NL:RBMNE:2026:6727'), 'https://data.rechtspraak.nl/uitspraken/content?id=ECLI%3ANL%3ARBMNE%3A2026%3A6727');
});

test('neemt inhoudsindicatie en uitspraak, niet de RDF-metadata', () => {
  const tekst = uitspraakTekst(metTekst);
  assert.ok(tekst.startsWith('WOZ-waarde woning; beroep ongegrond. RECHTBANK MIDDEN-NEDERLAND'));
  assert.ok(tekst.includes('Eiser & de heffingsambtenaar van één gemeente.'));
  assert.equal(tekst.includes('Belastingrecht'), false);
});

test('een ECLI met alleen metadata levert geen tekst', () => {
  assert.equal(uitspraakTekst(alleenMetadata), '');
});

test('haalt de tekst altijd bij data.rechtspraak.nl, ook voor een details-URL', async () => {
  const gevraagd = [];
  const fetchFn = async (url) => { gevraagd.push(url); return antwoord(metTekst); };
  const uit = await haalRechtspraakTekst('https://uitspraken.rechtspraak.nl/details?id=ECLI:NL:RBMNE:2026:6359', { fetchFn });
  assert.equal(uit.reason, null);
  assert.ok(uit.text.includes('beroep ongegrond'));
  assert.deepEqual(gevraagd, ['https://data.rechtspraak.nl/uitspraken/content?id=ECLI%3ANL%3ARBMNE%3A2026%3A6359']);
});

test('meldt alleen metadata, een HTTP-fout en een netwerkfout als reden', async () => {
  const url = 'https://data.rechtspraak.nl/uitspraken/content?id=ECLI%3ANL%3ARBMNE%3A2026%3A6727';
  const leeg = await haalRechtspraakTekst(url, { fetchFn: async () => antwoord(alleenMetadata) });
  assert.deepEqual(leeg, { text: null, reason: 'alleen metadata (tekst nog niet gepubliceerd)' });
  const dicht = await haalRechtspraakTekst(url, { fetchFn: async () => antwoord('', 503) });
  assert.equal(dicht.reason, 'http_503');
  const stuk = await haalRechtspraakTekst(url, { fetchFn: async () => { throw new Error('timeout'); } });
  assert.equal(stuk.reason, 'fout: timeout');
});
