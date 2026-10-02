import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  lokaleTreffers, isLokaal, drempel, venster, documentenVanVergadering, itemTitel, itemKop,
  isHistorisch, teBeoordelen, vergaderDatum,
} from '../../src/stateninformatie-lib.mjs';

// Ingekort uit /api/v1/meetings?date_from=…&date_to=… (2 oktober 2026): de
// Statencommissie Bereikbaarheid en Energietransitie van 9 september (TenneT,
// Amersfoort-Noord), Praten met de Staten van 23 september (inspraak Leusden)
// en een vergadering zonder stukken.
const MEETINGS = JSON.parse(readFileSync(new URL('../fixtures/stateninformatie/meetings.json', import.meta.url), 'utf8'));

test('lokaleTreffers: plaatsnamen tellen, straatnamen elders niet', () => {
  assert.equal(lokaleTreffers('Netuitbreiding Amersfoort Noord en Amersfoortse ondernemers').aantal, 2);
  assert.equal(lokaleTreffers('Amersfoortseweg 12 in Soesterberg en de Amersfoortsestraatweg in Maarn').aantal, 0);
  assert.deepEqual(lokaleTreffers('Leusden, Leusden-Zuid en Hoevelaken').termen, ['leusden', 'hoevelaken']);
  assert.equal(lokaleTreffers(null).aantal, 0);
});

test('isLokaal: titel is genoeg, tekst vraagt twee treffers', () => {
  assert.equal(isLokaal({ titel: 'SB Voortgang netuitbreiding Amersfoort Noord TenneT', tekst: '' }).lokaal, true);
  assert.equal(isLokaal({ titel: 'Kadernota 2027-2030', tekst: 'De gemeenten Amersfoort, Utrecht en Veenendaal.' }).lokaal, false);
  const twee = isLokaal({ titel: 'Statenbrief', tekst: 'In Amersfoort ... en in Vathorst ...' });
  assert.equal(twee.lokaal, true);
  assert.match(twee.reden, /tekst 2×/);
  assert.equal(isLokaal({ titel: 'Verslag', tekst: null }).reden, 'geen treffer');
  // Lange stukken vragen meer: drie keer Amersfoort in 200.000 tekens is een opsomming.
  const lang = `${'x '.repeat(100000)} Amersfoort, Amersfoort en Amersfoort.`;
  assert.equal(drempel(lang.length), 5);
  const lange = isLokaal({ titel: 'Omgevingsverordening', tekst: lang });
  assert.equal(lange.lokaal, false);
  assert.match(lange.reden, /3× van 5 nodig/);
  assert.equal(isLokaal({ titel: 'Omgevingsverordening', tekst: lang }, 3).lokaal, true);
});

test('venster in Unix-seconden', () => {
  const nu = new Date('2026-10-02T12:00:00Z');
  const v = venster(nu, 30, 21);
  assert.equal(v.van, Math.floor(nu.getTime() / 1000) - 30 * 86400);
  assert.equal(v.tot, Math.floor(nu.getTime() / 1000) + 21 * 86400);
});

test('documentenVanVergadering: agendapunt erbij, url naar de API, elk stuk één keer', () => {
  const tennet = MEETINGS.find((m) => m.id === 11138);
  const docs = documentenVanVergadering(tennet);
  assert.equal(docs.length, 3);
  const eerste = docs[0];
  assert.equal(eerste.agendapunt, '8 SB Voortgang netuitbreiding Amersfoort Noord TenneT');
  assert.equal(eerste.url, `https://www.stateninformatie.provincie-utrecht.nl/api/v1/meetings/11138/documents/${eerste.id}`);
  assert.equal(eerste.pdf, true);
  assert.equal(documentenVanVergadering(MEETINGS.find((m) => m.id === 11352)).length, 0);
  assert.equal(documentenVanVergadering({ ...tennet, confidential: true }).length, 0);
  assert.equal(documentenVanVergadering(null).length, 0);
});

test('itemTitel en itemKop', () => {
  const tennet = MEETINGS.find((m) => m.id === 11138);
  const [doc] = documentenVanVergadering(tennet);
  assert.equal(vergaderDatum(tennet), '2026-09-09');
  const titel = itemTitel(tennet, doc);
  assert.match(titel, /^Provinciale Staten Utrecht: Statencommissie Bereikbaarheid en Energietransitie 2026-09-09: /);
  assert.ok(titel.length <= 300);
  // Het agendapunt wordt niet herhaald als de documenttitel het al bevat.
  assert.doesNotMatch(titel, /8 SB Voortgang.*8 SB Voortgang/);
  assert.match(itemKop(tennet, doc), /^Provincie Utrecht — Statencommissie Bereikbaarheid en Energietransitie\nVergaderdatum: 2026-09-09\nAgendapunt: 8 /);
});

test('isHistorisch: veertien dagen voor de Staten', () => {
  const nu = new Date('2026-10-02T12:00:00Z');
  assert.equal(isHistorisch('2026-09-09', nu), true);
  assert.equal(isHistorisch('2026-09-30', nu), false);
  assert.equal(isHistorisch(null, nu), false);
});

test('teBeoordelen: nieuwste eerst, beoordeeld overslaan, fout hoogstens drie keer', () => {
  const alles = teBeoordelen(MEETINGS, {});
  assert.equal(alles.length, 7); // 3 bij TenneT, 1 vergaderstuk plus 3 agendastukken bij Praten met de Staten
  assert.equal(alles[0].meeting.id, 11331); // 23 september vóór 9 september
  const [a, b] = alles.map((x) => String(x.doc.id));
  const staat = { [a]: { besluit: 'niet-lokaal' }, [b]: { besluit: 'fout', pogingen: 3 } };
  const rest = teBeoordelen(MEETINGS, staat);
  assert.equal(rest.length, 5);
  const nogEens = teBeoordelen(MEETINGS, { [b]: { besluit: 'fout', pogingen: 1 } });
  assert.equal(nogEens.find((x) => String(x.doc.id) === b).pogingen, 1);
});
