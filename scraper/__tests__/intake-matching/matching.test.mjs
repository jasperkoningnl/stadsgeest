import test from 'node:test';
import assert from 'node:assert/strict';

import {
  documentSoort,
  entiteitMatchToegestaan,
  woordMatchScore,
} from '../../src/intake-matching.mjs';

const item = (title, source_name = '') => ({ title, source_name });
const signal = (title, seed_source_name = '') => ({ title, seed_title: title, seed_source_name });

test('herkent de documentsoorten die in de foutclusters terugkomen', () => {
  assert.equal(documentSoort(item('Schriftelijke vragen 2026-106 KeiHart inzet Mosquitos')), 'schriftelijke_vraag');
  assert.equal(documentSoort(item('Verkeersbesluit gemeente Amersfoort wijk Liendert')), 'verkeersbesluit');
  assert.equal(documentSoort(item('ECLI:NL:RBMNE:2026:6248, Rechtbank Midden-Nederland')), 'rechtspraak');
  assert.equal(documentSoort(item('3. Bedrijvigheid 419 Programmering Stadsfestival', 'Raad — Ingekomen stukken')), 'ingekomen_stuk');
});

test('verschillende nummers schriftelijke vragen clusteren niet op partijnaam', () => {
  const a = item('Schriftelijke vragen 2026-106 KeiHart voor Amersfoort inzet van Mosquitos bij overlast', 'Raad Amersfoort — Schriftelijke vragen');
  const b = signal('Schriftelijke vragen 2026-089 KeiHart voor Amersfoort Welzijnsactiviteiten', 'Raad Amersfoort — Schriftelijke vragen');
  assert.equal(woordMatchScore(a, b), 0);
  assert.equal(entiteitMatchToegestaan(a, b, { strongMatches: 2 }), false);
});

test('verschillende verkeersbesluiten clusteren niet via gemeente en politie', () => {
  const a = item('Verkeersbesluit gemeente Amersfoort wijk Liendert: gehandicaptenparkeerplaats Zwaluwenstraat nummer 12', 'Officiële Bekendmakingen — Verkeersbesluiten Amersfoort');
  const b = signal('Verkeersbesluit gemeente Amersfoort wijk Leusderkwartier: onverplicht fietspad op de Bosweg', 'Officiële Bekendmakingen — Verkeersbesluiten Amersfoort');
  assert.equal(woordMatchScore(a, b), 0);
  assert.equal(entiteitMatchToegestaan(a, b, { strongMatches: 2 }), false);
});

test('verschillende ECLI-nummers clusteren niet door rechtbank-sjabloontekst', () => {
  const a = item('ECLI:NL:RBMNE:2026:6248, Rechtbank Midden-Nederland, 10-09-2026, UTR 25/7477', 'Rechtspraak — Amersfoort');
  const b = signal('ECLI:NL:RBMNE:2026:5425, Rechtbank Midden-Nederland, 11-08-2026, UTR 25/6414', 'Rechtspraak — Amersfoort');
  assert.equal(woordMatchScore(a, b), 0);
});

test('verschillende vergunningadressen clusteren niet op proceduretaal of dezelfde straat', () => {
  const a = item('Ontvangen aanvraag omgevingsvergunning voor het kappen van een boom op het perceel Sint Ansfridusstraat 33, 3817 BE Amersfoort', 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort');
  const b = signal('Ontvangen aanvraag omgevingsvergunning voor het kappen van een boom op het perceel Sint Ansfridusstraat 23, 3817 BE Amersfoort', 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort');
  assert.equal(woordMatchScore(a, b), 0);
});

test('aanvraag en verlening op exact hetzelfde adres mogen wel samen', () => {
  const a = item('Verleende omgevingsvergunning voor een dakkapel op het perceel Verhoevenstraat 74, 3818 PN Amersfoort', 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort');
  const b = signal('Ontvangen aanvraag omgevingsvergunning voor een dakkapel op het perceel Verhoevenstraat 74, 3818 PN Amersfoort', 'Officiële Bekendmakingen — Omgevingsvergunningen Amersfoort');
  assert.ok(woordMatchScore(a, b) >= 3);
  assert.equal(entiteitMatchToegestaan(a, b, { locationMatches: 1 }), true);
});

test('ingekomen stukken met andere registratienummers blijven los', () => {
  const a = item('3. Bedrijvigheid 419 Programmering Stadsfestival Amersfoort Inwoner 27-08-2026 Kennisnemen Bekijken Programma 3', 'Raad Amersfoort — Ingekomen stukken');
  const b = signal('3. Bedrijvigheid 259 Windmolen locatie Inwoner 07-05-2026 Kennisnemen Bekijken Programma 3', 'Raad Amersfoort — Ingekomen stukken');
  assert.equal(woordMatchScore(a, b), 0);
});

test('een vervuild cluster geeft zijn later aangehechte persoon niet meer door', () => {
  const a = item('4. Bestuur 431 Neerleggen functie Joost Storm', 'Raad Amersfoort — Ingekomen stukken');
  const b = signal('Feitelijke vragen en beantwoording bij De Nieuwe Poort', 'Raad Amersfoort — Vergaderingen en overig');
  assert.equal(entiteitMatchToegestaan(a, b, { strongMatches: 1 }), false);
});

test('RIB en schriftelijke vragen over exact hetzelfde inhoudelijke onderwerp kunnen koppelen', () => {
  const a = item('Schriftelijke vragen 2026-102 CDA vervroegd aanvragen van transportcapaciteit voor woningbouw en scholen', 'Raad Amersfoort — Schriftelijke vragen');
  const b = signal('Raadsinformatiebrief 2026-069 Aanpak vervroegd aanvragen transportcapaciteit woningbouw en scholen', 'Raad Amersfoort — Raadsinformatiebrieven');
  assert.ok(woordMatchScore(a, b) >= 4);
});

test('inhoud uit summary of content veroorzaakt geen titelmatch meer', () => {
  const a = {
    title: '[Beestenmarkt] Alles wordt duurder maar misschien kun je besparen',
    summary: 'Gratis energiescan helpt ondernemers energie en kosten besparen',
    content: 'Gratis energiescan helpt ondernemers energie en kosten besparen',
    source_name: 'Nextdoor — Amersfoort buurtberichten',
  };
  const b = signal('Gratis energiescan helpt Leusdense ondernemers energie en kosten besparen');
  assert.equal(woordMatchScore(a, b), 0);
});

test('twee gewone titels over hetzelfde concrete evenement kunnen nog koppelen', () => {
  const a = item('CDA Amersfoort bij Wereld Suïcide Preventie Dag: samen Walk into the Light');
  const b = signal('Eerste Walk into the Light in Amersfoort op Wereld Suïcide Preventie Dag');
  assert.ok(woordMatchScore(a, b) >= 3);
});
