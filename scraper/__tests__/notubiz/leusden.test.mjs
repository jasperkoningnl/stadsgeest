import test from 'node:test';
import assert from 'node:assert/strict';
import { attribuut, startdatum, documentId, verzamelDocumenten, itemTitel, isHistorisch } from '../../src/notubiz-lib.js';
import { isBruikbaarLeusden, titelLeusden, inhoudskop } from '../../src/raadkijker.mjs';

// Ingekort uit api.notubiz.nl/events/meetings/1523946 (raad Leusden, 24-9-2026).
const MEETING = {
  organisation: { id: 2090 },
  attributes: [{ id: 1, value: 'Raadsvergadering' }, { id: 50, value: 'Huis van Leusden' }],
  plannings: [{ start_date: '2026-09-24 20:00:00' }],
  documents: [{ id: 1, url: 'https://api.notubiz.nl/document/17000001/1', title: 'Agenda raad', types: [{ value: 'Agenda' }], versions: [{ mime_type: 'application/pdf' }] }],
  agenda_items: [
    { type_data: { title_prefix: '3', attributes: [{ id: 1, value: 'Vaststellen lijsten ingekomen stukken' }] },
      documents: [{ url: 'https://api.notubiz.nl/document/17286647/2', title: 'RB Lijst ingekomen stukken', types: [{ value: 'Raadsbesluit' }], publication_date: '2026-09-24', versions: [{ mime_type: 'application/pdf' }] }],
      agenda_items: [{ type_data: { title_prefix: '3a', attributes: [{ id: 1, value: 'Brief college' }] },
        documents: [{ url: 'https://api.notubiz.nl/document/17286648/1', title: 'Brief', versions: [] }] }] },
    { type_data: { title_prefix: '4', attributes: [{ id: 1, value: 'Besluitenlijst' }] },
      documents: [{ url: 'https://api.notubiz.nl/document/17286647/2', title: 'RB Lijst ingekomen stukken (dubbel)' }] },
  ],
};

test('attribuut, startdatum en document-id', () => {
  assert.equal(attribuut(MEETING, 1), 'Raadsvergadering');
  assert.equal(attribuut(MEETING, 99), '');
  assert.equal(startdatum(MEETING), '2026-09-24');
  assert.equal(documentId('https://api.notubiz.nl/document/17286647/2'), '17286647');
  assert.equal(documentId('https://gemeentebestuur.leusden.nl/api/v1/meetings/4392/documents/52668'), null);
});

test('verzamelDocumenten: hele boom, agendapunt erbij, elk document één keer', () => {
  const docs = verzamelDocumenten(MEETING);
  assert.equal(docs.length, 3);
  const lijst = docs.find((d) => d.id === '17286647');
  assert.equal(lijst.agendapunt, '3 Vaststellen lijsten ingekomen stukken');
  assert.equal(lijst.soort, 'Raadsbesluit');
  assert.equal(lijst.pdf, true);
  assert.equal(docs.find((d) => d.id === '17286648').agendapunt, '3a Brief college');
  assert.equal(docs.find((d) => d.id === '17000001').agendapunt, null);
});

test('itemTitel en isHistorisch', () => {
  const [doc] = verzamelDocumenten(MEETING).filter((d) => d.id === '17286647');
  assert.equal(itemTitel('Raadsvergadering', '2026-09-24', doc),
    'Raad Leusden: Raadsvergadering 2026-09-24: 3 Vaststellen lijsten ingekomen stukken — RB Lijst ingekomen stukken');
  const nu = new Date('2026-09-24T12:00:00Z');
  assert.equal(isHistorisch('2026-09-10', nu), true);
  assert.equal(isHistorisch('2026-09-20', nu), false);
  assert.equal(isHistorisch(null, nu), false);
});

test('RaadKijker Leusden: bijlagen vallen af, titel met partij', () => {
  assert.equal(isBruikbaarLeusden({ titel: 'Mv.1 Motie vreemd - Bijlage RIB Beslissing DUMAVA', bron_document_url: 'x' }), false);
  assert.equal(isBruikbaarLeusden({ titel: 'Geef Leusdense boeren toekomstperspectief', bron_document_url: 'x' }), true);
  assert.equal(isBruikbaarLeusden({ titel: 'Zonder document' }), false);
  assert.equal(titelLeusden({ type: 'motie', titel: 'Geef Leusdense boeren toekomstperspectief ', indiener_partij: 'Pro-Leusden' }),
    'Motie gemeenteraad Leusden (Pro-Leusden): Geef Leusdense boeren toekomstperspectief');
  assert.match(inhoudskop({ type: 'motie', gemeente_naam: 'Leusden', titel: 'x' }), /^Motie gemeenteraad Leusden/);
  assert.match(inhoudskop({ type: 'motie', titel: 'x' }), /^Motie gemeenteraad Amersfoort/);
});
