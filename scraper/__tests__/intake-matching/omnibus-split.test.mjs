// Splitsing van B&W-besluitenlijsten: elk stuk een eigen URL, en een gesplitst
// stuk mag niet opnieuw als besluitenlijst worden behandeld.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isGesplitstStuk, isOmnibus, splitsOmnibus, stukUrl, STUK_KENMERK } from '../../src/omnibus-split-lib.mjs';

const LIJST_URL = 'https://amersfoort.raadsinformatie.nl/besluitenlijst/1544779/Besluitenlijst%3A%20College%20van%20B.%20%26%20W.';
const lang = (tekst) => `${tekst} `.repeat(20);
const lijst = {
  id: 100,
  source_name: 'B&W besluitenlijsten gemeente Amersfoort',
  title: 'Besluitenlijst: College van B. & W. 29-09-2026',
  external_url: LIJST_URL,
  content: [
    'Besluitenlijst: College van B. & W. 29-09-2026',
    '=== DOCUMENTEN ===',
    '--- 607649 - Programmabegroting 2027 en meerjarenraming 2028-2030 ---',
    lang('Het college stelt de programmabegroting vast.'),
    '--- Bijlage Meerjarenbegroting 2027-2030 ---',
    lang('De prognose van het aantal woningen is naar beneden bijgesteld.'),
    '--- Besluitenlijst B. en W. d.d. 22 september 2026 ---',
    lang('Procedureel stuk.'),
    '--- Invitaties 29 september 2026 ---',
    lang('Procedureel stuk.'),
    '--- Te kort stuk ---',
    'kort',
  ].join('\n'),
};

test('besluitenlijst wordt gesplitst in inhoudelijke stukken met elk een eigen URL', () => {
  const uit = splitsOmnibus(lijst);
  assert.equal(uit.stukken.length, 2);
  assert.equal(uit.procedureel, 2);
  assert.equal(uit.stukken[0].title, '[B&W] Programmabegroting 2027 en meerjarenraming 2028-2030');
  assert.equal(uit.stukken[1].title, '[B&W] Bijlage Meerjarenbegroting 2027-2030');
  const urls = uit.stukken.map((s) => s.external_url);
  assert.equal(new Set(urls).size, 2);
  for (const url of urls) {
    assert.ok(url.startsWith(LIJST_URL + STUK_KENMERK));
    assert.notEqual(url, LIJST_URL); // anders gooit het URL-duplicaatfilter het stuk weg
  }
  assert.match(uit.stukken[0].summary, /^Gesplitst uit besluitenlijst \(item #100\)/);
});

test('stuk-URL is herhaalbaar en stapelt geen kenmerken', () => {
  const eerste = stukUrl(LIJST_URL, 'Bijlage  Meerjarenbegroting 2027-2030');
  assert.equal(eerste, stukUrl(LIJST_URL, 'bijlage meerjarenbegroting 2027-2030'));
  assert.equal(stukUrl(eerste, 'Bijlage Meerjarenbegroting 2027-2030'), eerste);
  assert.notEqual(eerste, stukUrl(LIJST_URL, 'Bijlage Kaderbrief'));
});

test('twee stukken met dezelfde titel in één lijst krijgen verschillende URLs', () => {
  const dubbel = { ...lijst, content: ['=== DOCUMENTEN ===', '--- Bijlage ---', lang('Eerste bijlage.'), '--- Bijlage ---', lang('Tweede bijlage.')].join('\n') };
  const urls = splitsOmnibus(dubbel).stukken.map((s) => s.external_url);
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0], urls[1]);
});

test('een gesplitst stuk is geen besluitenlijst meer', () => {
  const stuk = { ...splitsOmnibus(lijst).stukken[0], source_name: lijst.source_name };
  assert.equal(isOmnibus(lijst), true);
  assert.equal(isGesplitstStuk(stuk), true);
  assert.equal(isOmnibus(stuk), false);
  // oude stukken van vóór de reparatie hebben nog de lijst-URL maar wel de vaste samenvatting
  const oud = { source_name: lijst.source_name, title: '[B&W] 2r - 607649 Programmabegroting', external_url: LIJST_URL, summary: 'Gesplitst uit besluitenlijst (item #99): Programmabegroting' };
  assert.equal(isOmnibus(oud), false);
});

test('lijst zonder documentensectie geeft null', () => {
  assert.equal(splitsOmnibus({ ...lijst, content: 'Alleen een agenda.' }), null);
});
