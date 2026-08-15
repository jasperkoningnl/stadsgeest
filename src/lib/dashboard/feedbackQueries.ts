import { q } from '@/lib/turso'

export interface DashboardFeedback {
  id: number
  gebruiker: string
  soort: string | null
  tekst: string
  pagina: string | null
  aanleiding: string | null
  created_at: string
}

/**
 * Alle algemene feedback op het dashboard, nieuwste bovenaan. Alleen zichtbaar
 * voor jasper — de pagina bepaalt dat, niet deze functie.
 */
export async function getDashboardFeedback(limiet = 100): Promise<DashboardFeedback[]> {
  return q<DashboardFeedback>(
    `SELECT id, gebruiker, soort, tekst, pagina, aanleiding, created_at
       FROM dashboard_feedback
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [limiet],
  )
}
