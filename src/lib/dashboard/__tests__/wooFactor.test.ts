import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createClient } from '@libsql/client'
import { mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { valideerWooAnalyse, wooBewerking, veiligeWooUrl, zelfdeWooHerkomst } from '../wooFactor.ts'
import { bewerkWooZaak, leesWooZaken, WooConflict } from '../wooFactorStore.ts'
import type { WooAnalyse } from '../wooFactor.ts'

const require = createRequire(import.meta.url)
const { migrate } = require('../../../../scraper/src/woo-factor-schema.cjs')
const { importAnalyses } = require('../../../../scraper/src/woo-factor-store.cjs')
const { selecteerVermoedens, main: prepare } = require('../../../../scraper/src/woo-factor-prepare.cjs')
const pilots: WooAnalyse[] = require('../../../../scraper/research/woo-factor-pilot.json')
const kandidaat = () => structuredClone(pilots[0])

function testDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'stadsgeest-woo-test-'))
  const file = join(dir, 'test.db')
  const db = createClient({ url: pathToFileURL(file).href.replace(/^file:\/\//, 'file:') })
  return { db, close() {
    db.close()
    // Libsql houdt transactieverbindingen tot GC vast. Windows kan het tijdelijke
    // bestand daardoor pas na procesafsluiting vrijgeven.
    try {
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix)
      rmdirSync(dir)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error }
  } }
}

test('de drie proefgevallen voldoen aan het controlecontract', () => {
  pilots.forEach(a => assert.equal(valideerWooAnalyse(a), a))
  assert.deepEqual(pilots.map(a => a.uitkomst), ['informatieleemte', 'document_gevonden', 'onvoldoende_aanwijzingen'])
})

test('voorbereiding maakt alleen ontdubbelde leesaanwijzingen en weigert een externe database', async () => {
  const feit = { id: 1, dossier_id: 1, slug: 'test-dossier', naam: 'Test', titel: 'Onderzoek naar capaciteit', details: 'Een evaluatie wordt genoemd.', primaire_bron_url: 'https://example.org/bron' }
  const vermoedens = selecteerVermoedens([feit, { ...feit, id: 2 }, { ...feit, id: 3, primaire_bron_url: null }])
  assert.equal(vermoedens.length, 1)
  assert.equal(vermoedens[0].status, 'vermoeden_te_onderzoeken')
  assert.equal(vermoedens[0].concept, undefined)
  await assert.rejects(prepare(['--kopie','libsql://example.org','--uit','uit.json']), /bestaande lokale db/)
})

test('onvolledige technische of online controle blokkeert concept en goedkeuring', () => {
  for (const tak of ['technisch','online'] as const) {
    const a = kandidaat()
    a.controle[tak][0].status = 'onvolledig'
    assert.throws(() => valideerWooAnalyse(a), /Rond beide/)
    assert.throws(() => wooBewerking(a, 'goedkeuren', a.concept, a.concept), /Rond beide/)
    a.uitkomst = 'in_onderzoek'; a.concept = ''
    assert.doesNotThrow(() => valideerWooAnalyse(a))
  }
})

test('gevonden documenten, technische problemen en onvoldoende bewijs mogen geen concept krijgen', () => {
  for (const uitkomst of ['document_gevonden','technisch_probleem','onvoldoende_aanwijzingen'] as const) {
    const a = kandidaat(); a.uitkomst = uitkomst
    assert.throws(() => valideerWooAnalyse(a), /Alleen een onderbouwde/)
    a.concept = ''
    assert.throws(() => wooBewerking(a, 'goedkeuren', 'verzoek', ''), /staat geen concept/)
  }
  const a = kandidaat(); a.ontstaansgrond = 'onvoldoende'
  assert.throws(() => valideerWooAnalyse(a), /bewijs voor bestaan/)
})

test('alleen de opgeslagen tekst kan worden goedgekeurd; opslaan trekt goedkeuring in', () => {
  const a = kandidaat()
  assert.throws(() => wooBewerking(a, 'goedkeuren', a.concept + ' wijziging', a.concept), /eerst op/)
  assert.equal(wooBewerking(a, 'goedkeuren', a.concept, a.concept).besluit, 'goedgekeurd')
  assert.equal(wooBewerking(a, 'opslaan', 'Gewijzigde tekst', a.concept).besluit, 'te_beoordelen')
  assert.throws(() => wooBewerking(a, 'verzenden', a.concept, a.concept), /Ongeldige/)
})

test('ongeldige bronlinks, datums en codes worden geweigerd', () => {
  assert.equal(veiligeWooUrl('javascript:alert(1)'), false)
  assert.equal(veiligeWooUrl('https://user:password@example.com'), false)
  for (const change of [
    (a: WooAnalyse) => { a.bronnen[0].url = 'javascript:alert(1)' },
    (a: WooAnalyse) => { a.controle.online[0].datum = '2026-02-30' },
    (a: WooAnalyse) => { a.periode.van = '2027-01-01' },
    (a: WooAnalyse) => { a.controle.technisch = [] },
  ]) {
    const a = kandidaat(); change(a)
    assert.throws(() => valideerWooAnalyse(a))
  }
})

test('herkomstcontrole volgt de bezochte host en poort, ook achter Next', () => {
  assert.equal(zelfdeWooHerkomst('http://127.0.0.1:3117', '127.0.0.1:3117'), true)
  assert.equal(zelfdeWooHerkomst('https://stadsgeest.nl', 'stadsgeest.nl'), true)
  assert.equal(zelfdeWooHerkomst('https://example.org', 'stadsgeest.nl'), false)
  assert.equal(zelfdeWooHerkomst('http://localhost:3118', 'localhost:3117'), false)
  assert.equal(zelfdeWooHerkomst(null, 'stadsgeest.nl'), false)
  assert.equal(zelfdeWooHerkomst('null', 'stadsgeest.nl'), false)
  assert.equal(zelfdeWooHerkomst('https://stadsgeest.nl/ander-pad', 'stadsgeest.nl'), false)
})

test('database bewaart versies en redactieoordelen; herimport overschrijft niets', async () => {
  const fixture = testDatabase(), { db } = fixture
  try {
    await db.execute('CREATE TABLE dossiers(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,naam TEXT)')
    await db.execute("INSERT INTO dossiers VALUES (1,'gemeentefinancien-amersfoort','Financiën')")
    await migrate(db); await migrate(db)
    const a = kandidaat()
    assert.deepEqual(await importAnalyses(db, [a], valideerWooAnalyse), { inserted: 1, unchanged: 0 })
    await bewerkWooZaak(db, a.id, 1, 'pien', 'goedkeuren', a.concept)
    assert.deepEqual(await importAnalyses(db, [a], valideerWooAnalyse), { inserted: 0, unchanged: 1 })
    assert.equal((await leesWooZaken(db))[0].besluit, 'goedgekeurd')
    await assert.rejects(bewerkWooZaak(db, a.id, 1, 'jasper', 'afwijzen', ''), WooConflict)
    assert.equal((await db.execute('SELECT * FROM woo_factor_events')).rows.length, 2)
    await bewerkWooZaak(db, a.id, 2, 'pien', 'opslaan', 'Nieuw afgebakend concept')
    const row = (await leesWooZaken(db))[0]
    assert.equal(row.besluit, 'te_beoordelen'); assert.equal(row.decided_by, null); assert.equal(row.revision, 3)
    const changed = kandidaat(); changed.vraag = 'Andere onderzoeksvraag'
    await assert.rejects(importAnalyses(db, [changed], valideerWooAnalyse), /andere inhoud/)
    const events = (await db.execute('SELECT actor,action,snapshot_json FROM woo_factor_events ORDER BY revision')).rows
    assert.deepEqual(events.map(e => e.actor), ['ai','pien','pien'])
    assert.equal(JSON.parse(String(events[1].snapshot_json)).concept, a.concept)
    assert.equal(JSON.parse(String(events[2].snapshot_json)).besluit, 'te_beoordelen')
  } finally { fixture.close() }
})

test('mislukte batchimport laat geen halve analyses achter', async () => {
  const fixture = testDatabase(), { db } = fixture
  try {
    await db.execute('CREATE TABLE dossiers(id INTEGER PRIMARY KEY,slug TEXT UNIQUE,naam TEXT)')
    await db.execute("INSERT INTO dossiers VALUES (1,'gemeentefinancien-amersfoort','Financiën')")
    await migrate(db)
    await assert.rejects(importAnalyses(db, [kandidaat(), pilots[1]], valideerWooAnalyse), /Onbekend dossier/)
    assert.equal((await db.execute('SELECT * FROM woo_factor_cases')).rows.length, 0)
    assert.equal((await db.execute('SELECT * FROM woo_factor_events')).rows.length, 0)
  } finally { fixture.close() }
})
