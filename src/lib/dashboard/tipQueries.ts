/* eslint-disable @typescript-eslint/no-explicit-any */
// Queries voor het redactiedashboard van Nieuwsplein33.
//
// De redactie leest tips, niet signalen. Een tip verwijst via `tip_signals` naar
// een of meer signalen; daaronder hangen de documenten die de scrapers hebben
// opgehaald. Alles wat hier uitkomt is bedoeld om in redactietaal getoond te
// worden — 'bron' en 'document', nooit 'signaal' of 'raw_item'.
import { q, qOne } from '@/lib/turso'

export type TipStatus =
  | 'wachtrij' | 'goedgekeurd' | 'in_behandeling'
  | 'gepubliceerd' | 'niet_gebruikt' | 'geparkeerd' | 'afgekeurd'

export interface TipRij {
  id: number
  titel: string
  kern: string
  soort: string
  gemeente: string
  categorie: string | null
  score: number
  score_motivatie: string
  status: TipStatus
  dossier_naam: string | null
  created_at: string
  bronnen: { naam: string; tier: number | null; spiegel: boolean }[]
  aantal_documenten: number
}

export interface TipDetail extends TipRij {
  briefing: string | null
  vervolgvragen: string | null
  weging: string | null
  herkomst: string | null
  elders_gebracht: string | null
  toegevoegde_waarde: string | null
  dossier_id: number | null
  artikel_url: string | null
  eigen_vondst: number | null
  actor: string
  updated_at: string
}

export interface TipDocument {
  titel: string
  url: string | null
  gescrapet: string
  gepubliceerd: string | null
  bron: string
  tier: number | null
  bronrol: string | null
  rol: string
  signal_id: number
  signaal_titel: string | null
  fragment: string | null
}

export interface DossierFeit {
  id: number
  fact_type: string
  datum: string | null
  locatie: string | null
  titel: string
  details: string | null
  zekerheid: string
  primaire_bron_url: string | null
  tegenstrijdigheid: string | null
  superseded_by: number | null
}

export interface FeedbackRij {
  id: number
  gebruiker: string
  actie: string
  reden_code: string | null
  reden_tekst: string | null
  created_at: string
}

const BRON_SELECT = `
  SELECT DISTINCT ts.tip_id, src.name AS naam, src.tier, src.bronrol
  FROM tip_signals ts
  JOIN signal_items si ON si.signal_id = ts.signal_id
  JOIN raw_items ri ON ri.id = si.raw_item_id
  JOIN sources src ON src.id = ri.source_id
`

/** Hangt bronnen en documentaantallen aan een lijst tips. Eén query voor alles. */
async function verrijkMetBronnen(tips: any[]): Promise<TipRij[]> {
  if (tips.length === 0) return []
  const ids = tips.map((t) => t.id)
  const gaten = ids.map(() => '?').join(',')

  const bronRijen = await q<any>(`${BRON_SELECT} WHERE ts.tip_id IN (${gaten})`, ids)
  const telRijen = await q<any>(
    `SELECT ts.tip_id, COUNT(DISTINCT si.raw_item_id) AS n
     FROM tip_signals ts JOIN signal_items si ON si.signal_id = ts.signal_id
     WHERE ts.tip_id IN (${gaten}) GROUP BY ts.tip_id`,
    ids,
  )

  const perTip = new Map<number, TipRij['bronnen']>()
  for (const r of bronRijen) {
    const lijst = perTip.get(r.tip_id) ?? []
    lijst.push({ naam: r.naam, tier: r.tier ?? null, spiegel: r.bronrol === 'spiegel' })
    perTip.set(r.tip_id, lijst)
  }
  const tellingen = new Map<number, number>(telRijen.map((r) => [r.tip_id, Number(r.n)]))

  return tips.map((t) => ({
    ...t,
    // Dragende bronnen eerst: dat is waar de redacteur op moet letten.
    bronnen: (perTip.get(t.id) ?? []).sort((a, b) => {
      if (a.spiegel !== b.spiegel) return a.spiegel ? 1 : -1
      return (a.tier ?? 9) - (b.tier ?? 9)
    }),
    aantal_documenten: tellingen.get(t.id) ?? 0,
  }))
}

const TIP_KOLOMMEN = `
  t.id, t.titel, t.kern, t.soort, t.gemeente, t.categorie, t.score,
  t.score_motivatie, t.status, t.created_at, d.naam AS dossier_naam
`

export async function getTips(statussen: TipStatus[]): Promise<TipRij[]> {
  if (statussen.length === 0) return []
  const gaten = statussen.map(() => '?').join(',')
  const rijen = await q<any>(
    `SELECT ${TIP_KOLOMMEN}
     FROM tips t LEFT JOIN dossiers d ON d.id = t.dossier_id
     WHERE t.status IN (${gaten})
     -- Chronologisch: nieuwste dag bovenaan. Binnen één dag (de weger schrijft
     -- zijn tips in één run weg) staat de sterkste eerst.
     ORDER BY substr(t.created_at, 1, 10) DESC, t.score DESC, t.created_at DESC`,
    statussen,
  )
  return verrijkMetBronnen(rijen)
}

export async function getTipDetail(id: number): Promise<TipDetail | null> {
  const rij = await qOne<any>(
    `SELECT t.*, d.naam AS dossier_naam
     FROM tips t LEFT JOIN dossiers d ON d.id = t.dossier_id
     WHERE t.id = ?`,
    [id],
  )
  if (!rij) return null
  const [verrijkt] = await verrijkMetBronnen([rij])
  return { ...rij, ...verrijkt } as TipDetail
}

/**
 * De documenten onder een tip, gegroepeerd op signaal (dragend eerst) en
 * binnen een signaal oudste eerst — de redacteur moet de ontwikkeling zien.
 * `gepubliceerd` is de publicatiedatum van het document zelf (gevuld sinds
 * 15 augustus); `gescrapet` blijft de terugval.
 */
export async function getTipDocumenten(tipId: number): Promise<TipDocument[]> {
  return q<TipDocument>(
    `SELECT ri.title AS titel, ri.external_url AS url, ri.scraped_at AS gescrapet,
            ri.published_at AS gepubliceerd,
            src.name AS bron, src.tier, src.bronrol, ts.rol,
            si.signal_id, sig.title AS signaal_titel,
            substr(COALESCE(NULLIF(ri.summary,''), ri.content), 1, 320) AS fragment
     FROM tip_signals ts
     JOIN signals sig ON sig.id = ts.signal_id
     JOIN signal_items si ON si.signal_id = ts.signal_id
     JOIN raw_items ri ON ri.id = si.raw_item_id
     JOIN sources src ON src.id = ri.source_id
     WHERE ts.tip_id = ?
     ORDER BY CASE ts.rol WHEN 'dragend' THEN 0 WHEN 'bevestigend' THEN 1 ELSE 2 END,
              si.signal_id,
              COALESCE(ri.published_at, ri.scraped_at) ASC`,
    [tipId],
  )
}

/** De tijdlijn van het dossier waar deze tip bij hoort. Dit is de dwarsverbandenkant. */
export async function getDossierTijdlijn(dossierId: number): Promise<DossierFeit[]> {
  return q<DossierFeit>(
    `SELECT id, fact_type, datum, locatie, titel, details, zekerheid,
            primaire_bron_url, tegenstrijdigheid, superseded_by
     FROM dossier_facts
     WHERE dossier_id = ?
     ORDER BY COALESCE(datum, created_at) ASC`,
    [dossierId],
  )
}

export async function getTipFeedback(tipId: number): Promise<FeedbackRij[]> {
  return q<FeedbackRij>(
    `SELECT id, gebruiker, actie, reden_code, reden_tekst, created_at
     FROM tip_feedback WHERE tip_id = ? ORDER BY created_at ASC`,
    [tipId],
  )
}

export async function getStatusTellingen(): Promise<Record<string, number>> {
  const rijen = await q<any>(`SELECT status, COUNT(*) AS n FROM tips GROUP BY status`)
  const uit: Record<string, number> = {}
  for (const r of rijen) uit[r.status] = Number(r.n)
  return uit
}

/** Hoeveel er deze week is geparkeerd — de wekelijkse herinnering uit de blauwdruk. */
export async function getGeparkeerdDezeWeek(): Promise<number> {
  const rij = await qOne<any>(
    `SELECT COUNT(*) AS n FROM tips
     WHERE status = 'geparkeerd' AND updated_at > datetime('now','-7 days')`,
  )
  return Number(rij?.n ?? 0)
}

/** De meetknop: hoeveel tips leidden tot een artikel dat er anders niet was geweest. */
export async function getMeetstand(): Promise<{ gepubliceerd: number; eigenVondst: number }> {
  const rij = await qOne<any>(
    `SELECT COUNT(*) AS gepubliceerd,
            SUM(CASE WHEN eigen_vondst = 1 THEN 1 ELSE 0 END) AS eigen
     FROM tips WHERE status = 'gepubliceerd'`,
  )
  return { gepubliceerd: Number(rij?.gepubliceerd ?? 0), eigenVondst: Number(rij?.eigen ?? 0) }
}
