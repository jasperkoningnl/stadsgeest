/* eslint-disable @typescript-eslint/no-explicit-any */
// Queries voor de Beheer-tab: cijfers over de pipeline zelf (intake-runs,
// bronnengezondheid), niet over tips. Bewust een apart bestand van
// tipQueries.ts — andere doelgroep (Jasper, niet de redactie), andere schaal.
//
// Grotendeels teruggehaald uit de git-geschiedenis (src/lib/dashboard/queries.ts
// vóór de dashboard-migratie van 8 augustus 2026, verwijderd bij commit 3a7926f).
// Schema op 9 augustus 2026 rechtstreeks tegen Turso geverifieerd: intake_runs,
// sources en scrape_runs zijn ongewijzigd t.o.v. die oude versie.
//
// Uitgebreid op 28 augustus 2026 met intake-decisions en weging queries voor de
// nieuwe Intake- en Weging-tabs op de beheerpagina.
import { q } from '@/lib/turso'
import { daysSince } from './format'

async function getTableColumns(table: string): Promise<Set<string>> {
  const rows = await q<{ name: string }>(`PRAGMA table_info(${table})`)
  return new Set(rows.map((r) => r.name))
}

// ── Intake runs ──────────────────────────────────────────────────────────

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

// ── Bronnen ──────────────────────────────────────────────────────────────

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

/** Recente scrape-fouten: bronnen met een fout in de laatste run. */
export interface SourceError {
  sourceName: string
  status: string
  errorMessage: string | null
  startedAt: string
  countThisWeek: number
}

export async function getSourceErrors(): Promise<SourceError[]> {
  // Haal per bron de meest recente fout-run, en tel hoeveel fouten er deze week waren.
  const rows = await q<any>(`
    SELECT
      sr.source_name,
      sr.status,
      sr.error_message,
      sr.started_at,
      (SELECT COUNT(*) FROM scrape_runs sr2
       WHERE sr2.source_id = sr.source_id
         AND sr2.status IN ('error', 'timeout')
         AND julianday(sr2.started_at) >= julianday('now', '-7 days')
      ) as count_this_week
    FROM scrape_runs sr
    WHERE sr.status IN ('error', 'timeout')
      AND sr.started_at = (
        SELECT MAX(sr3.started_at) FROM scrape_runs sr3
        WHERE sr3.source_id = sr.source_id AND sr3.status IN ('error', 'timeout')
      )
      AND julianday(sr.started_at) >= julianday('now', '-7 days')
    ORDER BY sr.started_at DESC
  `)
  return rows.map((r: any) => ({
    sourceName: r.source_name ?? 'onbekend',
    status: r.status,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    countThisWeek: r.count_this_week ?? 1,
  }))
}

// ── Intake-beslissingen ──────────────────────────────────────────────────

export interface IntakeFunnel {
  totalIn: number
  filtered: number
  matched: number
  newSignal: number
  entitiesCreated: number
}

/** Trechtergetallen: opgeteld uit intake_runs binnen de gegeven periode. */
export async function getIntakeFunnel(dagen = 7): Promise<IntakeFunnel> {
  const row = await q<any>(`
    SELECT
      COALESCE(SUM(items_in), 0) as total_in,
      COALESCE(SUM(items_filtered), 0) as filtered,
      COALESCE(SUM(items_matched), 0) as matched,
      COALESCE(SUM(signals_created), 0) as new_signal,
      COALESCE(SUM(entities_created), 0) as entities_created
    FROM intake_runs
    WHERE julianday(started_at) >= julianday('now', '-' || ? || ' days')
  `, [dagen])
  const r = row[0]
  return {
    totalIn: r?.total_in ?? 0,
    filtered: r?.filtered ?? 0,
    matched: r?.matched ?? 0,
    newSignal: r?.new_signal ?? 0,
    entitiesCreated: r?.entities_created ?? 0,
  }
}

export interface IntakeDecision {
  itemTitle: string
  sourceName: string
  decision: string
  reason: string | null
  signalId: number | null
  signalTitle: string | null
  entitiesFound: string | null
  createdAt: string
}

/** Recente intake-beslissingen met optionele signaalinfo. */
export async function getIntakeDecisions(limiet = 50): Promise<IntakeDecision[]> {
  const rows = await q<any>(`
    SELECT
      id.item_title,
      id.source_name,
      id.decision,
      id.reason,
      id.signal_id,
      s.title as signal_title,
      id.entities_found,
      id.created_at
    FROM intake_decisions id
    LEFT JOIN signals s ON s.id = id.signal_id
    ORDER BY id.created_at DESC
    LIMIT ?
  `, [limiet])
  return rows.map((r: any) => ({
    itemTitle: r.item_title ?? '',
    sourceName: r.source_name ?? '',
    decision: r.decision ?? '',
    reason: r.reason ?? null,
    signalId: r.signal_id ?? null,
    signalTitle: r.signal_title ?? null,
    entitiesFound: r.entities_found ?? null,
    createdAt: r.created_at ?? '',
  }))
}

export interface FilterReason {
  reason: string
  count: number
}

/** Top filterredenen binnen de gegeven periode. */
export async function getTopFilterReasons(dagen = 7, limiet = 10): Promise<FilterReason[]> {
  const rows = await q<any>(`
    SELECT reason, COUNT(*) as cnt
    FROM intake_decisions
    WHERE decision = 'filtered'
      AND julianday(created_at) >= julianday('now', '-' || ? || ' days')
    GROUP BY reason
    ORDER BY cnt DESC
    LIMIT ?
  `, [dagen, limiet])
  return rows.map((r: any) => ({
    reason: r.reason ?? 'onbekend',
    count: r.cnt ?? 0,
  }))
}

export interface TopEntity {
  name: string
  type: string
  count: number
}

/** Meest voorkomende entiteiten, gefilterd op recente raw_items. */
export async function getTopEntities(dagen = 7, limiet = 10): Promise<TopEntity[]> {
  const rows = await q<any>(`
    SELECT e.normalized_name, e.entity_type, COUNT(*) as cnt
    FROM entities e
    JOIN raw_items ri ON ri.id = e.raw_item_id
    WHERE julianday(ri.scraped_at) >= julianday('now', '-' || ? || ' days')
    GROUP BY e.normalized_name, e.entity_type
    ORDER BY cnt DESC
    LIMIT ?
  `, [dagen, limiet])
  return rows.map((r: any) => ({
    name: r.normalized_name ?? '',
    type: r.entity_type ?? '',
    count: r.cnt ?? 0,
  }))
}

// ── Weging (tips & signalen) ─────────────────────────────────────────────

export interface TipOverzicht {
  id: number
  titel: string
  kern: string | null
  soort: string | null
  score: number | null
  scoreMotivatie: string | null
  status: string | null
  createdAt: string
  signalen: TipSignaal[]
}

export interface TipSignaal {
  signalId: number
  signalTitle: string
  rol: string
}

/** Recente tips met hun gekoppelde signalen. */
export async function getRecentTips(dagen = 7, limiet = 20): Promise<TipOverzicht[]> {
  const tips = await q<any>(`
    SELECT id, titel, kern, soort, score, score_motivatie, status, created_at
    FROM tips
    WHERE julianday(created_at) >= julianday('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT ?
  `, [dagen, limiet])

  if (tips.length === 0) return []

  const tipIds = tips.map((t: any) => t.id)
  const placeholders = tipIds.map(() => '?').join(',')
  const signalen = await q<any>(`
    SELECT ts.tip_id, ts.signal_id, ts.rol, s.title as signal_title
    FROM tip_signals ts
    JOIN signals s ON s.id = ts.signal_id
    WHERE ts.tip_id IN (${placeholders})
  `, tipIds)

  const signaalMap = new Map<number, TipSignaal[]>()
  for (const s of signalen) {
    const arr = signaalMap.get(s.tip_id) ?? []
    arr.push({ signalId: s.signal_id, signalTitle: s.signal_title ?? '', rol: s.rol ?? '' })
    signaalMap.set(s.tip_id, arr)
  }

  return tips.map((t: any) => ({
    id: t.id,
    titel: t.titel ?? '',
    kern: t.kern ?? null,
    soort: t.soort ?? null,
    score: t.score ?? null,
    scoreMotivatie: t.score_motivatie ?? null,
    status: t.status ?? null,
    createdAt: t.created_at ?? '',
    signalen: signaalMap.get(t.id) ?? [],
  }))
}

export interface AfgewezenSignaal {
  id: number
  title: string
  decisionReason: string | null
  noveltyScore: number | null
  lastSeenAt: string | null
  confirmations: number
}

/** Signalen die door de weger zijn afgewezen (discarded). */
export async function getAfgewezenSignalen(dagen = 7, limiet = 20): Promise<AfgewezenSignaal[]> {
  const rows = await q<any>(`
    SELECT id, title, decision_reason, novelty_score, last_seen_at, confirmations
    FROM signals
    WHERE status = 'discarded'
      AND julianday(last_seen_at) >= julianday('now', '-' || ? || ' days')
    ORDER BY last_seen_at DESC
    LIMIT ?
  `, [dagen, limiet])
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title ?? '',
    decisionReason: r.decision_reason ?? null,
    noveltyScore: r.novelty_score ?? null,
    lastSeenAt: r.last_seen_at ?? null,
    confirmations: r.confirmations ?? 0,
  }))
}

/** Samenvattingscijfers van de weger over de gegeven periode. */
export interface WegingSamenvatting {
  signalenBeoordeeld: number
  tipsMade: number
  afgewezen: number
  watching: number
}

export async function getWegingSamenvatting(dagen = 7): Promise<WegingSamenvatting> {
  const [tips, afgewezen, watching] = await Promise.all([
    q<any>(`
      SELECT COUNT(*) as cnt FROM tips
      WHERE julianday(created_at) >= julianday('now', '-' || ? || ' days')
    `, [dagen]),
    q<any>(`
      SELECT COUNT(*) as cnt FROM signals
      WHERE status = 'discarded'
        AND julianday(last_seen_at) >= julianday('now', '-' || ? || ' days')
    `, [dagen]),
    q<any>(`
      SELECT COUNT(*) as cnt FROM signals WHERE status = 'watching'
    `),
  ])
  const tipCount = tips[0]?.cnt ?? 0
  const afgewezenCount = afgewezen[0]?.cnt ?? 0
  return {
    signalenBeoordeeld: tipCount + afgewezenCount,
    tipsMade: tipCount,
    afgewezen: afgewezenCount,
    watching: watching[0]?.cnt ?? 0,
  }
}
