import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocumentFeiten } from '../documentUittreksels.ts'

test('dashboard toont zekere feiten en laat onzekere extractie weg', () => {
  const feiten = parseDocumentFeiten(JSON.stringify([
    { soort: 'bedrag', zin: 'Direct feit.', bewijsstatus: 'direct', citaten: [{ tekst: 'bewijs', plek: 'p. 1' }] },
    { soort: 'risico', zin: 'Onzeker feit.', bewijsstatus: 'extractie_onzeker', citaten: [{ tekst: 'ruis', plek: 'tabel' }] },
  ]))
  assert.deepEqual(feiten.map((f) => f.zin), ['Direct feit.'])
  assert.deepEqual(parseDocumentFeiten('{stuk'), [])
})
