/* eslint-disable @typescript-eslint/no-explicit-any */
// Queries voor de Beheer-tab: cijfers over de pipeline zelf (intake-runs,
// bronnengezondheid), niet over tips. Bewust een apart bestand van
// tipQueries.ts — andere doelgroep (Jasper, niet de redactie), andere schaal.
//
// Grotendeels teruggehaald uit de git-geschiedenis (src/lib/dashboard/queries.ts
// vóór de dashboard-migratie van 8 augustus 2026, verwijderd bij commit 3a7926f).
// Schema op 9 augustus 2026 rechtstreeks tegen Turso geverifieerd: intake_runs,
// sources en scrape_runs zijn ongewijzigd t.o.v. die oude versie.
import { q } from '@/lib/turso'
import { daysSince } from './format'

async function getTableColumns(table: string): Promise<Set<string>> {
  const rows = await q<{ name: string }>(`PRAGMA table_info(${table})`)
  return new Set(rows.map((r) => r.name))
}

export interface IntakeRun {
  id: number
  trigger: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  items_in: number | null
  items_filtered: number | null
  items_matched: number | null
  signals_created: number | null
  signals_historical: number | null
  thresholds_reached: number | null
  entities_created: number | null
  status: string | null
  error_message: string | null
}

/** Meest recente runs eerst — de aanroeper bepaalt hoeveel er getoond worden. */
export async function getIntakeRuns(limiet = 10): Promise<IntakeRun[]> {
  return q<IntakeRun>(
    `SELECT id, trigger, started_at, finished_at, duration_ms, items_in, items_filtered,
            items_matched, signals_created, signals_historical, thresholds_reached,
            entities_created, status, error_message
     FROM intake_runs ORDER BY started_at DESC LIMIT ?`,
    [limiet],
  )
}

export interface TierAggregate {
  tier: number
  sourceCount: number
  items: number
}

export async function getTierAggregates(): Promise<TierAggregate[]> {
  const [sourceCounts, items] = await Promise.all([
    q<any>(`SELECT tier, COUNT(*) c FROM sources WHERE tier IS NOT NULL GROUP BY tier`),
    q<any>(
      `SELECT s.tier, COUNT(r.id) c FROM sources s LEFT JOIN raw_items r ON r.source_id = s.id
       WHERE s.tier IS NOT NULL GROUP BY s.tier`,
    ),
  ])
  const bySourceCount = new Map(sourceCounts.map((r: any) => [r.tier, r.c]))
  const byItems = new Map(items.map((r: any) => [r.tier, r.c]))
  return [1, 2, 3].map((tier) => ({
    tier,
    sourceCount: (bySourceCount.get(tier) as number) ?? 0,
    items: (byItems.get(tier) as number) ?? 0,
  }))
}

export interface SourceRow {
  id: number
  name: string
  tier: number | null
  isActive: number
  lastItemAt: string | null
  items7d: number
  items30d: number
  itemsTotal: number
  daysSinceLast: number | null
  lastErrorStatus: string | null
  health: 'ok' | 'verdacht' | 'dood' | 'uitgeschakeld' | null
  healthNote: string | null
}

export interface SourcesOverview {
  rows: SourceRow[]
  /** true als sources.health bestaat — bepaalt of de gezondheidsbadge getoond wordt. */
  healthTracked: boolean
}

export async function getSourcesOverview(): Promise<SourcesOverview> {
  const sourceCols = await getTableColumns('sources')
  const healthTracked = sourceCols.has('health')

  const [sources, errorsBySource] = await Promise.all([
    q<any>(`
      SELECT
        s.id, s.name, s.tier, s.is_active,
        ${healthTracked ? 's.health, s.health_note,' : ''}
        MAX(REPLACE(REPLACE(r.scraped_at,'T',' '),'Z','')) as last_item_at,
        COUNT(DISTINCT CASE WHEN julianday(r.scraped_at) >= julianday('now','-7 days') THEN r.id END) as items_7d,
        COUNT(DISTINCT CASE WHEN julianday(r.scraped_at) >= julianday('now','-30 days') THEN r.id END) as items_30d,
        COUNT(DISTINCT r.id) as items_total
      FROM sources s
      LEFT JOIN raw_items r ON r.source_id = s.id
      GROUP BY s.id
      ORDER BY s.tier ASC, s.name ASC
    `),
    q<any>(`
      SELECT source_id, status, started_at
      FROM scrape_runs
      WHERE source_id IS NOT NULL
      ORDER BY started_at DESC
    `),
  ])

  const latestBySource = new Map<number, any>()
  for (const e of errorsBySource) {
    if (!latestBySource.has(e.source_id)) latestBySource.set(e.source_id, e)
  }

  const rows: SourceRow[] = sources.map((s: any) => {
    const latest = latestBySource.get(s.id)
    return {
      id: s.id,
      name: s.name,
      tier: s.tier,
      isActive: s.is_active,
      lastItemAt: s.last_item_at,
      items7d: s.items_7d ?? 0,
      items30d: s.items_30d ?? 0,
      itemsTotal: s.items_total ?? 0,
      daysSinceLast: daysSince(s.last_item_at),
      lastErrorStatus: latest?.status ?? null,
      health: healthTracked ? (s.health ?? 'ok') : null,
      healthNote: healthTracked ? (s.health_note ?? null) : null,
    }
  })

  return { rows, healthTracked }
}
