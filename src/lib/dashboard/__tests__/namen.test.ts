import test from 'node:test'
import assert from 'node:assert/strict'
import { splitBuiten, lijktNaam, ontleedNaam, hostLabel, chipTekst, lijktDatum } from '../namen.ts'

test('splitBuiten: komma binnen haakjes splitst niet', () => {
  assert.deepEqual(splitBuiten('A (x, y), B'), ['A (x, y)', 'B'])
  assert.deepEqual(splitBuiten('  enkel  '), ['enkel'])
})

test('lijktNaam: hoofdletter of cijfer, kort, geen haakjes', () => {
  assert.equal(lijktNaam('MetMaya'), true)
  assert.equal(lijktNaam('112 Amersfoort'), true)
  assert.equal(lijktNaam('een halve zin die begint met kleine letter'), false)
  assert.equal(lijktNaam('Naam (met haakjes)'), false)
  assert.equal(lijktNaam('X'.repeat(61)), false)
})

test('ontleedNaam: organisatie met personen tussen haakjes', () => {
  const delen = ontleedNaam('MetMaya (directeur Leoniek Kroneman, eerder Joris Buningh)')
  assert.deepEqual(delen, [
    { soort: 'naam', naam: 'MetMaya', prefix: null, klein: false },
    { soort: 'naam', naam: 'Leoniek Kroneman', prefix: 'directeur', klein: true },
    { soort: 'naam', naam: 'Joris Buningh', prefix: 'eerder', klein: true },
  ])
})

test('ontleedNaam: twee organisaties met toevoeging, en een naam met komma zonder haakjes', () => {
  const twee = ontleedNaam('Stichting A (voorzitter P. Jansen) en Vereniging B (secretaris K. de Boer)')
  assert.equal(twee.filter((d) => d.soort === 'naam' && !d.klein).length, 2)
  assert.equal(twee.filter((d) => d.soort === 'naam' && d.klein).length, 2)
  assert.deepEqual(ontleedNaam('Staatssecretaris van Onderwijs, Cultuur en Wetenschap'), [
    { soort: 'naam', naam: 'Staatssecretaris van Onderwijs, Cultuur en Wetenschap', prefix: null, klein: false },
  ])
  // Een halve zin blijft tekst.
  assert.deepEqual(ontleedNaam('de eigenaar van het pand'), [{ soort: 'tekst', tekst: 'de eigenaar van het pand' }])
})

test('hostLabel: host plus documentnummer', () => {
  assert.equal(hostLabel('https://zoek.officielebekendmakingen.nl/gmb-2026-123456.html'), 'zoek.officielebekendmakingen.nl · 123456')
  assert.equal(hostLabel('https://www.amersfoort.nl/nieuws'), 'amersfoort.nl')
  assert.equal(hostLabel('geen url'), 'brondocument')
})

test('chipTekst: tier en voegwoorden weg, kale datum krijgt de site ervoor', () => {
  assert.equal(chipTekst('Gemeenteblad, tier 1, 12 september 2026', 'https://x.nl/1'), 'Gemeenteblad, 12 september 2026')
  assert.equal(chipTekst('en https://zoek.officielebekendmakingen.nl/gmb-2024-98766.html', 'https://zoek.officielebekendmakingen.nl/gmb-2024-98766.html'), 'zoek.officielebekendmakingen.nl · 98766')
  assert.equal(chipTekst('3 mei 2024', 'https://x.nl/doc/12345'), 'x.nl · 12345, 3 mei 2024')
  assert.equal(chipTekst('03-05-2024', 'https://x.nl/doc/12345'), 'x.nl · 12345, 03-05-2024')
  assert.equal(lijktDatum('september 2026'), true)
  assert.equal(lijktDatum('Gemeenteblad 2026'), false)
  assert.equal(chipTekst(null, null), '')
  assert.equal(chipTekst('Brondocument', null), 'Brondocument')
})
