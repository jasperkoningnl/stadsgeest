import test from 'node:test'
import assert from 'node:assert/strict'
import { GRENZEN, magProberen, sleutels } from '../inlogRegels.ts'

test('onder alle grenzen mag je proberen', () => {
  assert.equal(magProberen({}), true)
  assert.equal(magProberen({ combinatie: GRENZEN.combinatie - 1, adres: GRENZEN.adres - 1, gebruiker: GRENZEN.gebruiker - 1 }), true)
})

test('elke grens op zichzelf houdt de poging tegen', () => {
  assert.equal(magProberen({ combinatie: GRENZEN.combinatie }), false)
  assert.equal(magProberen({ adres: GRENZEN.adres }), false)
  assert.equal(magProberen({ gebruiker: GRENZEN.gebruiker }), false)
})

test('sleutels normaliseren de naam en houden adressen uit elkaar', () => {
  const a = sleutels('  Pien ', 'hash1')
  const b = sleutels('pien', 'hash2')
  assert.equal(a.gebruiker, 'g:pien')
  assert.equal(a.gebruiker, b.gebruiker)
  assert.notEqual(a.combinatie, b.combinatie)
  assert.equal(a.adres, 'a:hash1')
})
