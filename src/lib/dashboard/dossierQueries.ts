/* eslint-disable @typescript-eslint/no-explicit-any */
// Queries voor de dossierpagina's van het redactiedashboard.
//
// Een dossier is een terugkerend onderwerp met een feitenregister
// (`dossier_facts`) dat de weger bijhoudt, ook als een los feit geen tip wordt.
// De tabellen zijn klein (tientallen dossiers, honderden feiten); alle queries
// hier lopen via de index op dossier_id of tellen de feitentabel één keer.
import { q, qOne } from '@/lib/turso'
import type { TipStatus } from './tipQueries'

/** Statussen waarbij een tip nog bij de redactie ligt. */
export const OPEN_STATUSSEN: TipStatus[] = ['wachtrij', 'goedgekeurd', 'in_behandeling', 'geparkeerd']

export interface DossierOverzichtRij {
  id: number
  naam: string
  slug: string
  omschrijving: string | null
  feiten: number
  /** Vroegste feitdatum. */
  van: string | null
  /** Laatste feitdatum tot en met vandaag; geplande feiten tellen niet mee. */
  laatste_datum: string | null
  /** Wanneer Stadsgeest voor het laatst iets aan het dossier toevoegde. */
  laatst_toegevoegd: string | null
  /** Feiten die de afgelopen zeven dagen zijn vastgelegd. */
  nieuw_week: number
  tips: number
  open_tips: number
  /** Aantal feiten per maand, oudste eerst, over de laatste twaalf maanden. */
  per_maand: number[]
}

export interface Dossier {
  id: number
  naam: string
  slug: string
  trefwoorden: string
  omschrijving: string | null
  created_at: string
}

export interface DossierFeitVolledig {
  id: number
  fact_type: string
  datum: string | null
  locatie: string | null
  titel: string
  details: string | null
  classificatie: string | null
  zekerheid: string
  primaire_bron_url: string | null
  secundaire_bronnen: string | null
  signal_id: number | null
  tegenstrijdigheid: string | null
  superseded_by: number | null
  actor: string | null
  created_at: string
}

export interface DossierTip {
  id: number
  titel: string
  soort: string
  status: TipStatus
  score: number
  created_at: string
}

/** De twaalf maanden tot en met de huidige, als 'jjjj-mm', oudste eerst. */
export function laatsteTwaalfMaanden(nu = new Date()): string[] {
  const maanden: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - i, 1))
    maanden.push(d.toISOString().slice(0, 7))
  }
  return maanden
}

export async function getDossierOverzicht(): Promise<DossierOverzichtRij[]> {
  const maanden = laatsteTwaalfMaanden()
  const [dossiers, tips, perMaand] = await Promise.all([
    q<any>(
      `SELECT d.id, d.naam, d.slug, d.omschrijving,
              COUNT(f.id) AS feiten,
              MIN(f.datum) AS van,
              MAX(CASE WHEN f.datum <= date('now') THEN f.datum END) AS laatste_datum,
              MAX(f.created_at) AS laatst_toegevoegd,
              COALESCE(SUM(f.created_at >= datetime('now', '-7 days')), 0) AS nieuw_week
       FROM dossiers d
       LEFT JOIN dossier_facts f ON f.dossier_id = d.id
       GROUP BY d.id`,
    ),
    q<any>(
      `SELECT dossier_id, COUNT(*) AS n,
              SUM(status IN (${OPEN_STATUSSEN.map(() => '?').join(',')})) AS open
       FROM tips WHERE dossier_id IS NOT NULL GROUP BY dossier_id`,
      OPEN_STATUSSEN,
    ),
    q<any>(
      `SELECT dossier_id, substr(datum, 1, 7) AS maand, COUNT(*) AS n
       FROM dossier_facts WHERE datum >= ? GROUP BY dossier_id, maand`,
      [`${maanden[0]}-01`],
    ),
  ])

  const tipTelling = new Map<number, { n: number; open: number }>(
    tips.map((r) => [Number(r.dossier_id), { n: Number(r.n), open: Number(r.open ?? 0) }]),
  )
  const maandTelling = new Map<number, number[]>()
  for (const r of perMaand) {
    const index = maanden.indexOf(r.maand)
    if (index < 0) continue // feiten na de huidige maand (gepland)
    const id = Number(r.dossier_id)
    const reeks = maandTelling.get(id) ?? new Array(12).fill(0)
    reeks[index] = Number(r.n)
    maandTelling.set(id, reeks)
  }

  return dossiers
    .map((d) => ({
      id: Number(d.id),
      naam: d.naam,
      slug: d.slug,
      omschrijving: d.omschrijving ?? null,
      feiten: Number(d.feiten),
      van: d.van ?? null,
      laatste_datum: d.laatste_datum ?? null,
      laatst_toegevoegd: d.laatst_toegevoegd ?? null,
      nieuw_week: Number(d.nieuw_week ?? 0),
      tips: tipTelling.get(Number(d.id))?.n ?? 0,
      open_tips: tipTelling.get(Number(d.id))?.open ?? 0,
      per_maand: maandTelling.get(Number(d.id)) ?? new Array(12).fill(0),
    }))
    // Wat het laatst is aangevuld staat bovenaan: daar gebeurt iets.
    .sort((a, b) => (b.laatst_toegevoegd ?? '').localeCompare(a.laatst_toegevoegd ?? ''))
}

export async function getDossierBySlug(slug: string): Promise<Dossier | null> {
  return qOne<Dossier>(
    `SELECT id, naam, slug, trefwoorden, omschrijving, created_at FROM dossiers WHERE slug = ?`,
    [slug],
  )
}

export async function getDossierFeiten(dossierId: number): Promise<DossierFeitVolledig[]> {
  return q<DossierFeitVolledig>(
    `SELECT id, fact_type, datum, locatie, titel, details, classificatie, zekerheid,
            primaire_bron_url, secundaire_bronnen, signal_id, tegenstrijdigheid,
            superseded_by, actor, created_at
     FROM dossier_facts WHERE dossier_id = ?
     ORDER BY COALESCE(datum, created_at) ASC, id ASC`,
    [dossierId],
  )
}

export async function getDossierTips(dossierId: number): Promise<DossierTip[]> {
  return q<DossierTip>(
    `SELECT id, titel, soort, status, score, created_at
     FROM tips WHERE dossier_id = ? ORDER BY created_at DESC`,
    [dossierId],
  )
}

/**
 * Welke tips (uit dit dossier) op welk signaal leunen. Daarmee krijgt een
 * dossierfeit met een signal_id een verwijzing naar de tip die erover ging.
 * Leest alleen via de primaire sleutel van tip_signals.
 */
export async function getTipsPerSignaal(tipIds: number[]): Promise<Map<number, number[]>> {
  const uit = new Map<number, number[]>()
  if (tipIds.length === 0) return uit
  const rijen = await q<any>(
    `SELECT tip_id, signal_id FROM tip_signals WHERE tip_id IN (${tipIds.map(() => '?').join(',')})`,
    tipIds,
  )
  for (const r of rijen) {
    const sid = Number(r.signal_id)
    const lijst = uit.get(sid) ?? []
    lijst.push(Number(r.tip_id))
    uit.set(sid, lijst)
  }
  return uit
}
