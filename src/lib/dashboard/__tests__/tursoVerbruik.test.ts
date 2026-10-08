import assert from 'node:assert/strict'
import test from 'node:test'
import { jobsOpUur } from '../tursoPlanning.ts'

test('benoemt de dagelijkse Stadsgeest-weger om 09.00 uur', () => {
  assert.equal(jobsOpUur(new Date('2026-10-07T07:00:00.000Z')), 'Stadsgeest-weger')
})

test('benoemt op donderdag zowel de weger als de supertip-run', () => {
  assert.equal(
    jobsOpUur(new Date('2026-10-08T07:00:00.000Z')),
    'Stadsgeest-weger, supertip-run (Codex)',
  )
})
