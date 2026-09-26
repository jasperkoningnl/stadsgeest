// Leesverbruik van Turso, opgehaald via de Platform-API (api.turso.tech).
//
// Waarom via de API en niet uit de database: deze meting moet ook werken als
// Turso de database blokkeert omdat het quotum op is — dan is het dashboard
// het enige wat je nog wilt zien. De API-aanroepen kosten zelf geen reads.
//
// Hoe Turso telt (docs.turso.tech/help/usage-and-billing): elke rij die de
// database bekijkt, niet elke rij die terugkomt. Een query zonder passende
// index leest de hele tabel; count/sum/min/max tellen elke meegenomen rij;
// joins tellen de bekeken rijen van alle tabellen; een index aanmaken kost één
// keer de hele tabel. Het quotum geldt voor het hele account, alle databases.
//
// Nodig in de omgeving: TURSO_PLATFORM_TOKEN (Platform-API-token, niet de
// databasetoken), TURSO_ORG en TURSO_DB. Optioneel TURSO_LEESLIMIET: de grens
// waarop we waarschuwen. Standaard 500 miljoen, het gratis quotum — ook als er
// tijdelijk een betaald plan loopt, want daar willen we onder blijven.

import { unstable_cache } from 'next/cache'

const API = 'https://api.turso.tech/v1/organizations'
const TIJDZONE = 'Europe/Amsterdam'

export const LEESLIMIET = Number(process.env.TURSO_LEESLIMIET) || 500_000_000
export const SCHRIJFLIMIET = 10_000_000
export const OPSLAGLIMIET = 5 * 1024 ** 3

// Drempels voor de waarschuwing, als fractie van LEESLIMIET.
export const DREMPEL_LET_OP = 0.75
export const DREMPEL_KRITIEK = 0.9

// Geplande jobs op de notebook, in Nederlandse tijd: de PM2-jobs (`pm2 jlist`),
// de Windows-taken Stadsgeest Intake en Detection en de supertip-run. Stand van
// 26-09-2026; pas dit aan als de tijden veranderen. De Windows-taak NDW draait
// elk kwartier en staat hier niet per uur in. Cowork-routines en het dashboard
// zelf draaien op wisselende momenten.
const JOBS: { uur: number; naam: string; dagen?: string }[] = [
  { uur: 1, naam: 'scrape-browser' },
  { uur: 2, naam: 'scrape-dagelijks, scrape-ob' },
  { uur: 3, naam: 'scrape-wekelijks' },
  { uur: 3, naam: 'scrape-nieuw', dagen: 'ma' },
  { uur: 3, naam: 'scrape-subsidies', dagen: 'zo' },
  { uur: 4, naam: 'fetch-fulltext' },
  { uur: 5, naam: 'extract-entities, Intake (05:30)' },
  { uur: 6, naam: 'dwarsverbanden2-nacht, Detection (06:15)' },
  { uur: 9, naam: 'supertip-run (Cowork)', dagen: 'do' },
  { uur: 11, naam: 'scrape-dagelijks-middag1' },
  { uur: 21, naam: 'scrape-dagelijks-avond' },
]

// 'boven-gratis': er loopt een betaald plan en we zitten boven het gratis
// quotum. Geen blokkade, wel iets om volgende maand onder te blijven.
export type VerbruikStatus = 'ok' | 'let-op' | 'boven-gratis' | 'kritiek' | 'geblokkeerd'

interface Gebruik { rows_read: number; rows_written: number; storage_bytes: number }

export interface VerbruikSamenvatting {
  beschikbaar: true
  gemeten: string
  plan: string
  // Leeslimiet van het huidige plan volgens /plans; null als onbekend.
  planLimiet: number | null
  bijbetalen: boolean
  leesBlok: boolean
  schrijfBlok: boolean
  periodeEinde: string | null
  gelezen: number
  geschreven: number
  opslag: number
  perDatabase: { naam: string; gelezen: number; geschreven: number; opslag: number }[]
  gemiddeldPerDag: number
  prognose: number
  dagbudget: number
  restDagen: number
  status: VerbruikStatus
  redenen: string[]
}

export interface VerbruikDetail extends VerbruikSamenvatting {
  dagen: { dag: string; gelezen: number }[]
  uren: { van: string; label: string; gelezen: number; jobs: string }[]
  hoofdDb: string
}

export type Onbeschikbaar = { beschikbaar: false; reden: string }

function config() {
  const token = process.env.TURSO_PLATFORM_TOKEN
  const org = process.env.TURSO_ORG
  const db = process.env.TURSO_DB || 'amersfoort-lokaal'
  return token && org ? { token, org, db } : null
}

async function api<T>(pad: string): Promise<T> {
  const c = config()
  if (!c) throw new Error('geen token')
  const res = await fetch(`${API}/${c.org}${pad}`, {
    headers: { Authorization: `Bearer ${c.token}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Turso-API ${res.status} op ${pad.split('?')[0]}`)
  return res.json() as Promise<T>
}

async function dbGebruik(db: string, van: Date, tot: Date): Promise<Gebruik> {
  const qs = `from=${encodeURIComponent(van.toISOString())}&to=${encodeURIComponent(tot.toISOString())}`
  const r = await api<{ total?: Gebruik }>(`/databases/${db}/usage?${qs}`)
  return { rows_read: r.total?.rows_read ?? 0, rows_written: r.total?.rows_written ?? 0, storage_bytes: r.total?.storage_bytes ?? 0 }
}

// Beperkt aantal gelijktijdige aanroepen, zodat we de API niet bestoken.
async function inReeks<T, U>(lijst: T[], n: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const uit: U[] = new Array(lijst.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, lijst.length) }, async () => {
    while (i < lijst.length) { const k = i++; uit[k] = await fn(lijst[k]) }
  }))
  return uit
}

// Turso rekent per kalendermaand in UTC.
function maandStart(nu: Date) { return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), 1)) }
function volgendeMaand(nu: Date) { return new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 1)) }

async function samenvattingOphalen(nu: Date): Promise<VerbruikSamenvatting> {
  const [org, sub, lijst, plannen] = await Promise.all([
    api<{ organization: { plan_id?: string; overages?: boolean; blocked_reads?: boolean; blocked_writes?: boolean } }>(''),
    api<{ subscription?: { current_billing_period_end?: string } }>('/subscription').catch(() => ({ subscription: undefined })),
    api<{ databases: { Name: string }[] }>('/databases'),
    api<{ plans: { name: string; quotas?: { rowsRead?: number } }[] }>('/plans').catch(() => ({ plans: [] })),
  ])
  const planNaam = org.organization.plan_id ?? 'onbekend'
  const planLimiet = plannen.plans.find(p => p.name === planNaam)?.quotas?.rowsRead ?? null
  const betaald = planLimiet !== null && planLimiet > LEESLIMIET
  const start = maandStart(nu)
  const namen = lijst.databases.map(d => d.Name)
  const [perDb, recent] = await Promise.all([
    inReeks(namen, 4, async naam => ({ naam, g: await dbGebruik(naam, start, nu) })),
    // Gemiddelde over de laatste 72 uur, alle databases samen.
    inReeks(namen, 4, naam => dbGebruik(naam, new Date(nu.getTime() - 72 * 3600_000), nu)),
  ])
  const gelezen = perDb.reduce((s, d) => s + d.g.rows_read, 0)
  const geschreven = perDb.reduce((s, d) => s + d.g.rows_written, 0)
  const opslag = perDb.reduce((s, d) => s + d.g.storage_bytes, 0)
  const gemiddeldPerDag = recent.reduce((s, g) => s + g.rows_read, 0) / 3
  const restDagen = Math.max((volgendeMaand(nu).getTime() - nu.getTime()) / 86400_000, 0.01)
  const prognose = gelezen + gemiddeldPerDag * restDagen
  const dagbudget = Math.max(0, LEESLIMIET - gelezen) / restDagen

  const redenen: string[] = []
  let status: VerbruikStatus = 'ok'
  if (org.organization.blocked_reads) { status = 'geblokkeerd'; redenen.push('Turso blokkeert leesopdrachten') }
  else if (betaald) {
    // Blokkaderisico meten we tegen de planlimiet, de gratis grens blijft het doel.
    if (gelezen >= planLimiet! * DREMPEL_KRITIEK) { status = 'kritiek'; redenen.push(`${pct(gelezen, planLimiet!)} van de limiet van ${planNaam} gebruikt`) }
    else if (prognose >= planLimiet!) { status = 'kritiek'; redenen.push(`prognose ${mln(prognose)} komt boven de limiet van ${planNaam} (${mln(planLimiet!)})`) }
    else {
      if (gelezen >= LEESLIMIET * DREMPEL_LET_OP) { status = 'boven-gratis'; redenen.push(`${pct(gelezen)} van het gratis quotum gebruikt`) }
      if (prognose >= LEESLIMIET) { status = 'boven-gratis'; redenen.push(`prognose ${mln(prognose)} aan het eind van de maand, boven het gratis quotum`) }
    }
  }
  else if (gelezen >= LEESLIMIET * DREMPEL_KRITIEK) { status = 'kritiek'; redenen.push(`${pct(gelezen)} van het leesquotum gebruikt`) }
  else {
    if (gelezen >= LEESLIMIET * DREMPEL_LET_OP) { status = 'let-op'; redenen.push(`${pct(gelezen)} van het leesquotum gebruikt`) }
    if (prognose >= LEESLIMIET) { status = 'let-op'; redenen.push(`prognose ${mln(prognose)} aan het eind van de maand`) }
  }
  if (org.organization.blocked_writes) { status = 'geblokkeerd'; redenen.push('Turso blokkeert schrijfopdrachten') }

  return {
    beschikbaar: true,
    gemeten: nu.toISOString(),
    plan: planNaam,
    planLimiet,
    bijbetalen: !!org.organization.overages,
    leesBlok: !!org.organization.blocked_reads,
    schrijfBlok: !!org.organization.blocked_writes,
    periodeEinde: sub.subscription?.current_billing_period_end ?? null,
    gelezen, geschreven, opslag,
    perDatabase: perDb.map(d => ({ naam: d.naam, gelezen: d.g.rows_read, geschreven: d.g.rows_written, opslag: d.g.storage_bytes }))
      .sort((a, b) => b.gelezen - a.gelezen),
    gemiddeldPerDag, prognose, dagbudget, restDagen, status, redenen,
  }
}

function jobsOpUur(van: Date): string {
  const uur = Number(van.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TIJDZONE }))
  const dag = van.toLocaleDateString('nl-NL', { weekday: 'short', timeZone: TIJDZONE }).slice(0, 2)
  return JOBS.filter(j => j.uur === uur && (!j.dagen || j.dagen === dag)).map(j => j.naam).join(', ')
}

async function detailOphalen(nu: Date): Promise<VerbruikDetail> {
  const c = config()!
  const basis = await samenvattingOphalen(nu)
  const start = maandStart(nu)
  const dagStarts: Date[] = []
  for (let d = new Date(start); d < nu; d = new Date(d.getTime() + 86400_000)) dagStarts.push(d)
  const uurNu = new Date(Math.floor(nu.getTime() / 3600_000) * 3600_000)
  const uurStarts = Array.from({ length: 24 }, (_, k) => new Date(uurNu.getTime() - (23 - k) * 3600_000))

  const [dagen, uren] = await Promise.all([
    inReeks(dagStarts, 6, async van => {
      const tot = new Date(Math.min(van.getTime() + 86400_000, nu.getTime()))
      return { dag: van.toISOString().slice(0, 10), gelezen: (await dbGebruik(c.db, van, tot)).rows_read }
    }),
    inReeks(uurStarts, 6, async van => {
      const tot = new Date(Math.min(van.getTime() + 3600_000, nu.getTime()))
      return {
        van: van.toISOString(),
        label: van.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TIJDZONE }),
        gelezen: (await dbGebruik(c.db, van, tot)).rows_read,
        jobs: jobsOpUur(van),
      }
    }),
  ])
  return { ...basis, dagen, uren, hoofdDb: c.db }
}

// Tien minuten bewaren: vaak genoeg om een weglopende job te zien, zonder bij
// elke paginaweergave zestig API-aanroepen te doen.
const samenvattingCache = unstable_cache(async () => samenvattingOphalen(new Date()), ['turso-verbruik-samenvatting'], { revalidate: 600 })
const detailCache = unstable_cache(async () => detailOphalen(new Date()), ['turso-verbruik-detail'], { revalidate: 600 })

function reden(e: unknown) { return e instanceof Error ? e.message : 'onbekende fout' }
const GEEN_TOKEN: Onbeschikbaar = {
  beschikbaar: false,
  reden: 'TURSO_PLATFORM_TOKEN of TURSO_ORG ontbreekt in de omgevingsvariabelen. Zet ze in Vercel (Production en Preview) en deploy opnieuw.',
}

export async function getVerbruikSamenvatting(): Promise<VerbruikSamenvatting | Onbeschikbaar> {
  if (!config()) return GEEN_TOKEN
  try { return await samenvattingCache() } catch (e) { return { beschikbaar: false, reden: `Meting mislukt: ${reden(e)}` } }
}

export async function getVerbruikDetail(): Promise<VerbruikDetail | Onbeschikbaar> {
  if (!config()) return GEEN_TOKEN
  try { return await detailCache() } catch (e) { return { beschikbaar: false, reden: `Meting mislukt: ${reden(e)}` } }
}

// ── Weergave ────────────────────────────────────────────────────────────

/** 717.179.620 → "717,2 mln"; kleine getallen voluit. */
export function mln(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} mld`
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mln`
  return Math.round(n).toLocaleString('nl-NL')
}

export function pct(n: number, limiet = LEESLIMIET): string {
  return `${Math.round((n / limiet) * 100)}%`
}

/** Is een fout van libsql een quotumblokkade? */
export function isQuotumBlokkade(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  const tekst = e instanceof Error ? e.message : String(e)
  return code === 'BLOCKED' || /operation was blocked|upgrade your plan/i.test(tekst)
}
