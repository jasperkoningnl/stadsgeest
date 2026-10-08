import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBronPeriode } from '../format.ts'

test('toont één brondatum compact', () => {
  assert.equal(formatBronPeriode('2026-10-06 08:00:00', '2026-10-06 12:00:00'), 'Bron 6 okt 2026')
})

test('toont de hele bronperiode als documenten uiteenlopen', () => {
  assert.equal(formatBronPeriode('2026-09-09', '2026-10-06'), 'Bronnen 9 sep 2026 – 6 okt 2026')
})
