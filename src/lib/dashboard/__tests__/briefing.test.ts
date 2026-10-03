import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBriefing, ontstreep, verkennerTerm } from '../briefing.ts'

// Een briefing in het vaste format van de weger (zie briefing.ts). Fictieve
// inhoud, zelfde structuur als productie: zes of zeven koppen op een eigen
// regel, genummerde feiten met " — bron, tier, URL, datum" achteraan,
// betrokkenen als "- naam — rol — toelichting".
const BRIEFING = `WAT WE WETEN
1. De gemeente verleent een omgevingsvergunning voor een loods van 1.200 m² aan de Voorbeeldweg 12 — Gemeenteblad, tier 1, https://zoek.officielebekendmakingen.nl/gmb-2026-123456.html, 12 september 2026
2. Dezelfde aanvrager kreeg in 2024 een vergunning voor 800 m² op hetzelfde perceel — Gemeenteblad, tier 1, https://zoek.officielebekendmakingen.nl/gmb-2024-98765.html en https://zoek.officielebekendmakingen.nl/gmb-2024-98766.html, 3 mei 2024
3. Het bedrijf staat in het Handelsregister met twee bestuurders — tier 1

CONTEXT EN ACHTERGROND
Het bedrijventerrein wordt sinds 2023 herontwikkeld; de raad vroeg om
terughoudendheid met nieuwe loodsen.

BETROKKEN PERSONEN EN ORGANISATIES
- Voorbeeld Logistiek B.V. — aanvrager — eigenaar van het perceel sinds 2021
- J. de Vries — directeur — ook bestuurder van Voorbeeld Holding B.V.
- Gemeente Amersfoort — vergunningverlener

HOE DIT IS GEVONDEN
Twee vergunningen op hetzelfde BAG-adres binnen drie jaar (R1).

WAT WE NIET WETEN
- Of de uitbreiding al in gebruik is
- Of er bezwaar is ingediend

WAT HIER NIET IN MAG
- Het woonadres van de directeur

ELDERS GEBRACHT
Nee.`

test('parseBriefing: alle koppen, feiten met bron en links', () => {
  const b = parseBriefing(BRIEFING)
  assert.equal(b.volledig, true)
  assert.equal(b.weten.length, 3)
  assert.equal(b.weten[0].tekst, 'De gemeente verleent een omgevingsvergunning voor een loods van 1.200 m² aan de Voorbeeldweg 12')
  assert.equal(b.weten[0].url, 'https://zoek.officielebekendmakingen.nl/gmb-2026-123456.html')
  assert.match(b.weten[0].bron ?? '', /^Gemeenteblad, tier 1/)
  // Twee documenten in één bronregel worden twee links; "en" verdwijnt uit het label.
  assert.equal(b.weten[1].urls.length, 2)
  assert.doesNotMatch(b.weten[1].bron ?? '', /\ben\b\s*$/)
  // Een bronregel zonder URL blijft bron zonder link.
  assert.equal(b.weten[2].url, null)
  assert.equal(b.weten[2].bron, 'tier 1')
  assert.match(b.context ?? '', /^Het bedrijventerrein wordt sinds 2023 herontwikkeld; de raad vroeg om terughoudendheid/)
  assert.equal(b.betrokkenen.length, 3)
  assert.deepEqual(b.betrokkenen[1], { naam: 'J. de Vries', rol: 'directeur', toelichting: 'ook bestuurder van Voorbeeld Holding B.V.' })
  assert.equal(b.betrokkenen[2].toelichting, null)
  assert.match(b.gevonden ?? '', /R1/)
  assert.deepEqual(b.nietWeten, ['Of de uitbreiding al in gebruik is', 'Of er bezwaar is ingediend'])
  assert.deepEqual(b.nietInMag, ['Het woonadres van de directeur'])
  assert.equal(b.elders, 'Nee.')
})

test('parseBriefing: oudere briefing met los koppelteken en zonder context', () => {
  const b = parseBriefing(`WAT WE WETEN
1. Feit één - Raad Amersfoort, tier 1, https://amersfoort.raadsinformatie.nl/document/1, 1 augustus 2026

BETROKKEN PERSONEN EN ORGANISATIES
- Stichting Voorbeeld - subsidieontvanger - kreeg 40.000 euro in 2025

WAT WE NIET WETEN
Of de subsidie is uitbetaald.`)
  assert.equal(b.volledig, true)
  // Een los koppelteken is geen bronscheiding: de hele regel is feittekst.
  assert.equal(b.weten[0].url, null)
  assert.match(b.weten[0].tekst, /^Feit één - Raad Amersfoort/)
  assert.deepEqual(b.betrokkenen[0], { naam: 'Stichting Voorbeeld', rol: 'subsidieontvanger', toelichting: 'kreeg 40.000 euro in 2025' })
  assert.equal(b.context, null)
  // Een lijst zonder streepjes wordt één punt.
  assert.deepEqual(b.nietWeten, ['Of de subsidie is uitbetaald.'])
})

test('parseBriefing: platte tekst zonder koppen valt terug', () => {
  const b = parseBriefing('Gewoon een lap tekst zonder structuur.')
  assert.equal(b.volledig, false)
  assert.equal(b.weten.length, 0)
  assert.equal(b.betrokkenen.length, 0)
})

test('ontstreep en verkennerTerm', () => {
  assert.equal(ontstreep('Raad Amersfoort — Moties — 2026', ' · '), 'Raad Amersfoort · Moties · 2026')
  assert.equal(ontstreep('een zin — met streepje'), 'een zin, met streepje')
  assert.equal(ontstreep('woord—woord'), 'woord-woord')
  assert.equal(verkennerTerm('W. Stegeman'), 'Stegeman')
  assert.equal(verkennerTerm('J.A. de Vries'), 'de Vries')
  assert.equal(verkennerTerm('Voorbeeld Logistiek B.V.'), 'Voorbeeld Logistiek')
  assert.equal(verkennerTerm('Gemeente Amersfoort'), 'Gemeente Amersfoort')
})
