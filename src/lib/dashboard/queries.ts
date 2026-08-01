/* eslint-disable @typescript-eslint/no-explicit-any */
import { q, qOne, turso } from '@/lib/turso'
import { daysSince, formatDate } from './format'

// ── Vandaag ───────────────────────────────────────────────

export interface FunnelStats {
  itemsScraped: number
  itemsIntake: number
  newSignals: number
  candidatesResearching: number
}

export async function getFunnel24h(): Promise<FunnelStats> {
  const [scraped, intake, newSig, cand] = await Promise.all([
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM raw_items WHERE julianday(scraped_at) >= julianday('now','-1 day')`),
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM intake_decisions WHERE julianday(created_at) >= julianday('now','-1 day')`),
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM signals WHERE julianday(first_seen_at) >= julianday('now','-1 day')`),
    qOne<{ c: number }>(
      `SELECT COUNT(DISTINCT signal_id) c FROM signal_events
       WHERE event_type = 'status_change' AND status_to = 'researching'
       AND julianday(created_at) >= julianday('now','-1 day')`
    ),
  ])
  return {
    itemsScraped: scraped?.c ?? 0,
    itemsIntake: intake?.c ?? 0,
    newSignals: newSig?.c ?? 0,
    candidatesResearching: cand?.c ?? 0,
  }
}

export interface AttentionPoint {
  label: string
  detail: string
  href?: string
}

// Verwachte tijd (in dagen) tussen twee items van een bron, per scrape-ritme.
const FREQUENCY_DAYS: Record<string, number> = { hourly: 1 / 24, daily: 1, weekly: 7, monthly: 30 }
const FREQUENCY_LABEL: Record<string, string> = { hourly: 'ieder uur ververste', daily: 'dagelijkse', weekly: 'wekelijkse', monthly: 'maandelijkse' }

/**
 * Aandachtspunten die er echt toe doen: bronnen die, gegeven hun eigen scrape-ritme,
 * ongebruikelijk lang niets hebben opgeleverd (>5x hun verwachte interval, en niet langer
 * dan 120 dagen geleden voor het laatst actief — anders is het geen actuele storing meer
 * maar een verouderde eenmalige scrape), en scrapers die bij hun laatste run faalden.
 * Maximaal 3, alleen als ze echt afwijken.
 */
export async function getAttentionPoints(): Promise<AttentionPoint[]> {
  const [staleRows, failed] = await Promise.all([
    q<any>(`
      SELECT s.name, s.tier, s.scrape_frequency,
             MAX(REPLACE(REPLACE(r.scraped_at,'T',' '),'Z','')) as last_at,
             julianday('now') - julianday(MAX(REPLACE(REPLACE(r.scraped_at,'T',' '),'Z',''))) as days_ago
      FROM sources s JOIN raw_items r ON r.source_id = s.id
      GROUP BY s.id
      HAVING COUNT(r.id) >= 2
    `),
    q<any>(`
      SELECT scraper_file, error_message, started_at
      FROM scrape_runs sr
      WHERE scraper_file IS NOT NULL
        AND status IN ('error', 'timeout')
        AND started_at = (
          SELECT MAX(started_at) FROM scrape_runs sr2 WHERE sr2.scraper_file = sr.scraper_file
        )
      ORDER BY started_at DESC
    `),
  ])

  const stale = staleRows
    .map((r: any) => ({ ...r, ratio: r.days_ago / (FREQUENCY_DAYS[r.scrape_frequency] ?? 7) }))
    .filter((r: any) => r.ratio > 5 && r.days_ago <= 120)
    .sort((a: any, b: any) => (a.tier ?? 99) - (b.tier ?? 99) || b.ratio - a.ratio)

  const points: AttentionPoint[] = []

  for (const s of stale) {
    if (points.length >= 3) break
    const freqLabel = FREQUENCY_LABEL[s.scrape_frequency] ?? s.scrape_frequency
    points.push({
      label: `${s.name} is stil`,
      detail: `Laatste item op ${formatDate(s.last_at)} (${Math.round(s.days_ago)} dagen geleden) — ongebruikelijk voor een ${freqLabel} bron.`,
      href: '/dashboard/bronnen',
    })
  }

  if (points.length < 3 && failed.length > 0) {
    points.push({
      label: `${failed.length} scraper${failed.length === 1 ? '' : 's'} gaf een fout bij de laatste run`,
      detail: failed.slice(0, 3).map((f: any) => f.scraper_file).join(', '),
      href: '/dashboard/bronnen',
    })
  }

  return points.slice(0, 3)
}

// ── Opbrengst ─────────────────────────────────────────────

export interface OpbrengstTotals {
  totalSignals: number
  tier1Signals: number
  totalPublished: number
  tier1Published: number
}

export async function getOpbrengstTotals(): Promise<OpbrengstTotals> {
  const [totalSignals, tier1Signals, totalPublished, tier1Published] = await Promise.all([
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM signals`),
    qOne<{ c: number }>(`
      SELECT COUNT(DISTINCT si.signal_id) c FROM raw_items r
      JOIN signal_items si ON si.raw_item_id = r.id
      JOIN sources s ON s.id = r.source_id
      WHERE s.tier = 1
    `),
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM signals WHERE status = 'published'`),
    qOne<{ c: number }>(`
      SELECT COUNT(DISTINCT sig.id) c FROM signals sig
      JOIN signal_items si ON si.signal_id = sig.id
      JOIN raw_items r ON r.id = si.raw_item_id
      JOIN sources s ON s.id = r.source_id
      WHERE sig.status = 'published' AND s.tier = 1
    `),
  ])
  return {
    totalSignals: totalSignals?.c ?? 0,
    tier1Signals: tier1Signals?.c ?? 0,
    totalPublished: totalPublished?.c ?? 0,
    tier1Published: tier1Published?.c ?? 0,
  }
}

export interface LatestSignal {
  id: number
  title: string
  status: string
  sourceName: string | null
  lastSeenAt: string
}

export async function getLatestSignals(limit = 6): Promise<LatestSignal[]> {
  const rows = await q<any>(`
    SELECT sig.id, sig.title, sig.status, sig.last_seen_at, eff.source_name
    FROM signals sig
    LEFT JOIN (
      SELECT signal_id, source_name FROM (
        SELECT si.signal_id, s.name as source_name,
               ROW_NUMBER() OVER (PARTITION BY si.signal_id ORDER BY s.tier ASC, s.id ASC) as rn
        FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
      ) ranked WHERE rn = 1
    ) eff ON eff.signal_id = sig.id
    ORDER BY sig.last_seen_at DESC
    LIMIT ?
  `, [limit])
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, sourceName: r.source_name, lastSeenAt: r.last_seen_at }))
}

export interface LatestArticle {
  id: number
  title: string
  publishedAt: string | null
  sourceName: string | null
}

export async function getLatestPublishedArticles(limit = 6): Promise<LatestArticle[]> {
  const rows = await q<any>(`
    SELECT art.id, art.title, art.published_at, eff.source_name
    FROM articles art
    LEFT JOIN signals sig ON sig.sanity_signal_id = art.sanity_document_id
    LEFT JOIN (
      SELECT signal_id, source_name FROM (
        SELECT si.signal_id, s.name as source_name,
               ROW_NUMBER() OVER (PARTITION BY si.signal_id ORDER BY s.tier ASC, s.id ASC) as rn
        FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
      ) ranked WHERE rn = 1
    ) eff ON eff.signal_id = sig.id
    ORDER BY art.published_at DESC
    LIMIT ?
  `, [limit])
  return rows.map((r) => ({ id: r.id, title: r.title, publishedAt: r.published_at, sourceName: r.source_name }))
}

// ── Bronnenmonitor ────────────────────────────────────────

export interface SourceRow {
  id: number
  name: string
  url: string
  tier: number | null
  sourceType: string | null
  lastItemAt: string | null
  items7d: number
  items30d: number
  itemsTotal: number
  signalCount: number
  publishedCount: number
  topSignals: { id: number; title: string }[]
  lastErrorStatus: string | null
  lastErrorMessage: string | null
  daysSinceLast: number | null
  healthStatus: 'green' | 'grey' | 'red'
}

export interface TierAggregate {
  tier: number
  sourceCount: number
  items: number
  signals: number
  published: number
}

export async function getTierAggregates(): Promise<TierAggregate[]> {
  const [sourceCounts, items, signals, published] = await Promise.all([
    q<any>(`SELECT tier, COUNT(*) c FROM sources WHERE tier IS NOT NULL GROUP BY tier`),
    q<any>(`SELECT s.tier, COUNT(r.id) c FROM sources s LEFT JOIN raw_items r ON r.source_id = s.id WHERE s.tier IS NOT NULL GROUP BY s.tier`),
    q<any>(`
      SELECT s.tier, COUNT(DISTINCT si.signal_id) c
      FROM sources s JOIN raw_items r ON r.source_id = s.id JOIN signal_items si ON si.raw_item_id = r.id
      WHERE s.tier IS NOT NULL GROUP BY s.tier
    `),
    q<any>(`
      SELECT s.tier, COUNT(DISTINCT sig.id) c
      FROM sources s
      JOIN raw_items r ON r.source_id = s.id
      JOIN signal_items si ON si.raw_item_id = r.id
      JOIN signals sig ON sig.id = si.signal_id
      WHERE s.tier IS NOT NULL AND sig.status = 'published'
      GROUP BY s.tier
    `),
  ])

  const bySourceCount = new Map(sourceCounts.map((r: any) => [r.tier, r.c]))
  const byItems = new Map(items.map((r: any) => [r.tier, r.c]))
  const bySignals = new Map(signals.map((r: any) => [r.tier, r.c]))
  const byPublished = new Map(published.map((r: any) => [r.tier, r.c]))

  return [1, 2, 3].map((tier) => ({
    tier,
    sourceCount: (bySourceCount.get(tier) as number) ?? 0,
    items: (byItems.get(tier) as number) ?? 0,
    signals: (bySignals.get(tier) as number) ?? 0,
    published: (byPublished.get(tier) as number) ?? 0,
  }))
}

export async function getSourcesOverview(): Promise<SourceRow[]> {
  const [sources, errorsBySource, publishedBySource, topSignalRows] = await Promise.all([
    q<any>(`
      SELECT
        s.id, s.name, s.url, s.tier, s.source_type,
        MAX(REPLACE(REPLACE(r.scraped_at,'T',' '),'Z','')) as last_item_at,
        COUNT(DISTINCT CASE WHEN julianday(r.scraped_at) >= julianday('now','-7 days') THEN r.id END) as items_7d,
        COUNT(DISTINCT CASE WHEN julianday(r.scraped_at) >= julianday('now','-30 days') THEN r.id END) as items_30d,
        COUNT(DISTINCT r.id) as items_total,
        COUNT(DISTINCT si.signal_id) as signal_count
      FROM sources s
      LEFT JOIN raw_items r ON r.source_id = s.id
      LEFT JOIN signal_items si ON si.raw_item_id = r.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `),
    q<any>(`
      SELECT source_id, status, error_message, started_at
      FROM scrape_runs
      WHERE source_id IS NOT NULL
      ORDER BY started_at DESC
    `),
    q<any>(`
      SELECT r.source_id, COUNT(DISTINCT sig.id) c
      FROM raw_items r
      JOIN signal_items si ON si.raw_item_id = r.id
      JOIN signals sig ON sig.id = si.signal_id
      WHERE sig.status = 'published'
      GROUP BY r.source_id
    `),
    q<any>(`
      SELECT source_id, signal_id, title FROM (
        SELECT source_id, signal_id, title, last_seen_at,
               ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY last_seen_at DESC) as rn
        FROM (
          SELECT DISTINCT r.source_id as source_id, sig.id as signal_id, sig.title, sig.last_seen_at
          FROM raw_items r
          JOIN signal_items si ON si.raw_item_id = r.id
          JOIN signals sig ON sig.id = si.signal_id
        )
      ) WHERE rn <= 3
    `),
  ])

  const latestBySource = new Map<number, any>()
  for (const e of errorsBySource) {
    if (!latestBySource.has(e.source_id)) latestBySource.set(e.source_id, e)
  }

  const publishedCountBySource = new Map<number, number>(publishedBySource.map((p: any) => [p.source_id, p.c]))

  const topSignalsBySource = new Map<number, { id: number; title: string }[]>()
  for (const r of topSignalRows) {
    if (!topSignalsBySource.has(r.source_id)) topSignalsBySource.set(r.source_id, [])
    topSignalsBySource.get(r.source_id)!.push({ id: r.signal_id, title: r.title })
  }

  return sources.map((s): SourceRow => {
    const latest = latestBySource.get(s.id)
    const daysAgo = daysSince(s.last_item_at)
    const hadError = latest && (latest.status === 'error' || latest.status === 'timeout')

    let healthStatus: 'green' | 'grey' | 'red' = 'green'
    if (!s.last_item_at || hadError) healthStatus = 'red'
    else if (daysAgo !== null && daysAgo >= 14) healthStatus = 'grey'

    return {
      id: s.id,
      name: s.name,
      url: s.url,
      tier: s.tier,
      sourceType: s.source_type,
      lastItemAt: s.last_item_at,
      items7d: s.items_7d ?? 0,
      items30d: s.items_30d ?? 0,
      itemsTotal: s.items_total ?? 0,
      signalCount: s.signal_count ?? 0,
      publishedCount: publishedCountBySource.get(s.id) ?? 0,
      topSignals: topSignalsBySource.get(s.id) ?? [],
      lastErrorStatus: latest?.status ?? null,
      lastErrorMessage: latest?.error_message ?? null,
      daysSinceLast: daysAgo,
      healthStatus,
    }
  })
}

// ── Intake ────────────────────────────────────────────────

export async function getIntakeRuns(): Promise<any[]> {
  return q<any>(`
    SELECT id, trigger, started_at, finished_at, duration_ms, items_in, items_filtered, items_matched,
           signals_created, signals_historical, thresholds_reached, entities_created, status, error_message
    FROM intake_runs ORDER BY started_at DESC
  `)
}

export async function getIntakeRunDetail(runId: number) {
  const [run, decisions, reasonBreakdown] = await Promise.all([
    qOne<any>(`SELECT * FROM intake_runs WHERE id = ?`, [runId]),
    q<any>(`SELECT * FROM intake_decisions WHERE intake_run_id = ? ORDER BY id ASC`, [runId]),
    q<any>(`SELECT reason, COUNT(*) as count FROM intake_decisions WHERE intake_run_id = ? AND decision = 'filtered' GROUP BY reason ORDER BY count DESC`, [runId]),
  ])
  return { run, decisions, reasonBreakdown }
}

// ── Signalen archief ──────────────────────────────────────

export interface SignalFilters {
  status: string[]
  tier?: number
  bron?: string
  period?: '7d' | '30d' | '90d'
  q?: string
  page: number
}

const PAGE_SIZE = 50

export async function getSignalsArchive(filters: SignalFilters) {
  const page = Math.max(1, filters.page || 1)
  const offset = (page - 1) * PAGE_SIZE

  const where: string[] = []
  const args: any[] = []

  if (filters.status.length > 0) {
    where.push(`sig.status IN (${filters.status.map(() => '?').join(',')})`)
    args.push(...filters.status)
  }
  if (filters.q) {
    where.push(`(sig.title LIKE ? OR sig.summary LIKE ?)`)
    args.push(`%${filters.q}%`, `%${filters.q}%`)
  }
  if (filters.period) {
    const days = { '7d': 7, '30d': 30, '90d': 90 }[filters.period]
    where.push(`julianday(sig.last_seen_at) >= julianday('now', ?)`)
    args.push(`-${days} days`)
  }
  if (filters.tier) {
    where.push(`eff.tier = ?`)
    args.push(filters.tier)
  }
  if (filters.bron) {
    where.push(`eff.source_name = ?`)
    args.push(filters.bron)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const joinSql = `
    FROM signals sig
    LEFT JOIN (
      SELECT signal_id, source_name, tier FROM (
        SELECT si.signal_id, s.name as source_name, s.tier,
               ROW_NUMBER() OVER (PARTITION BY si.signal_id ORDER BY s.tier ASC, s.id ASC) as rn
        FROM signal_items si
        JOIN raw_items r ON r.id = si.raw_item_id
        JOIN sources s ON s.id = r.source_id
      ) ranked WHERE rn = 1
    ) eff ON eff.signal_id = sig.id
    LEFT JOIN articles art ON art.sanity_document_id = sig.sanity_signal_id
    ${whereSql}
  `

  const [rows, totalRow] = await Promise.all([
    q<any>(
      `SELECT sig.id, sig.title, sig.status, sig.confirmations, sig.first_seen_at, sig.last_seen_at,
              eff.tier as eff_tier, eff.source_name as eff_source, art.id as article_id
       ${joinSql}
       ORDER BY sig.last_seen_at DESC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      args
    ),
    qOne<{ c: number }>(`SELECT COUNT(*) c ${joinSql}`, args),
  ])

  return { rows, total: totalRow?.c ?? 0, page, pageSize: PAGE_SIZE }
}

export async function getAllSourceNames(): Promise<string[]> {
  const rows = await q<{ name: string }>(`SELECT name FROM sources ORDER BY name ASC`)
  return rows.map((r) => r.name)
}

// ── Signaaldossier ────────────────────────────────────────

export async function getSignalDossier(id: number) {
  const [signal, effective, rawItems, entities, events, decisions] = await Promise.all([
    qOne<any>(`SELECT * FROM signals WHERE id = ?`, [id]),
    q<any>(
      `SELECT s.name as source_name, s.tier
       FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
       WHERE si.signal_id = ? ORDER BY s.tier ASC, s.id ASC LIMIT 1`,
      [id]
    ),
    q<any>(
      `SELECT r.id, r.title, r.external_url, r.scraped_at, s.name as source_name, s.tier
       FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
       WHERE si.signal_id = ? ORDER BY REPLACE(REPLACE(r.scraped_at,'T',' '),'Z','') DESC`,
      [id]
    ),
    q<any>(
      `SELECT DISTINCT e.id, e.entity_type, e.name
       FROM entity_signals es JOIN entities e ON e.id = es.entity_id
       WHERE es.signal_id = ? ORDER BY e.entity_type ASC, e.name ASC`,
      [id]
    ),
    q<any>(`SELECT * FROM signal_events WHERE signal_id = ? ORDER BY created_at ASC`, [id]),
    q<any>(
      `SELECT id.*, ir.started_at as run_started_at
       FROM intake_decisions id JOIN intake_runs ir ON ir.id = id.intake_run_id
       WHERE id.signal_id = ? ORDER BY id.id ASC`,
      [id]
    ),
  ])

  if (!signal) return null

  let article: any = null
  if (signal.sanity_signal_id) {
    article = await qOne<any>(`SELECT * FROM articles WHERE sanity_document_id = ?`, [signal.sanity_signal_id])
  }

  const entitiesByType = new Map<string, { id: number; name: string }[]>()
  for (const e of entities) {
    if (!entitiesByType.has(e.entity_type)) entitiesByType.set(e.entity_type, [])
    entitiesByType.get(e.entity_type)!.push({ id: e.id, name: e.name })
  }

  return {
    signal,
    effectiveTier: effective[0]?.tier ?? null,
    effectiveSource: effective[0]?.source_name ?? null,
    rawItems,
    entitiesByType: Array.from(entitiesByType.entries()).map(([type, list]) => ({ type, entities: list })),
    events,
    decisions,
    article,
  }
}

// ── Persberichtqueue ──────────────────────────────────────
//
// job_requests is de wachtrij tussen dashboard en de redactieassistent (Cowork-agent
// op de notebook, draait elk half uur): het dashboard schrijft 'queued', de assistent
// zet 'm op 'running' en logt naar job_logs, en levert af in press_releases.

export interface JobRequestRow {
  id: number
  type: string
  signal_id: number
  params: string | null
  status: 'queued' | 'running' | 'done' | 'error' | string
  requested_by: string | null
  requested_at: string
  started_at: string | null
  finished_at: string | null
  result_id: number | null
  error_message: string | null
}

export interface JobLogRow {
  id: number
  job_id: number
  ts: string
  level: string | null
  message: string
}

export interface PressReleaseRow {
  id: number
  signal_id: number
  job_id: number | null
  headline: string | null
  lead: string | null
  body: string | null
  facts: string | null
  open_questions: string | null
  sources: string | null
  status: string | null
  created_at: string
}

/** Meest recente job van dit type voor een signaal, ongeacht status. */
export async function getLatestJobForSignal(signalId: number, type = 'persbericht'): Promise<JobRequestRow | null> {
  return qOne<JobRequestRow>(
    `SELECT * FROM job_requests WHERE signal_id = ? AND type = ? ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [signalId, type]
  )
}

/** Openstaande (queued/running) job van dit type voor een signaal — gebruikt om dubbele aanvragen te voorkomen. */
export async function getOpenJobForSignal(signalId: number, type = 'persbericht'): Promise<JobRequestRow | null> {
  return qOne<JobRequestRow>(
    `SELECT * FROM job_requests WHERE signal_id = ? AND type = ? AND status IN ('queued','running')
     ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [signalId, type]
  )
}

export async function createJobRequest(signalId: number, type: string, requestedBy: string): Promise<JobRequestRow> {
  if (!turso) throw new Error('Geen databaseverbinding')
  const res = await turso.execute({
    sql: `INSERT INTO job_requests (type, signal_id, status, requested_by) VALUES (?, ?, 'queued', ?)`,
    args: [type, signalId, requestedBy],
  })
  const id = Number(res.lastInsertRowid)
  const job = await qOne<JobRequestRow>(`SELECT * FROM job_requests WHERE id = ?`, [id])
  if (!job) throw new Error('Job kon niet worden aangemaakt')
  return job
}

export async function getJob(id: number): Promise<JobRequestRow | null> {
  return qOne<JobRequestRow>(`SELECT * FROM job_requests WHERE id = ?`, [id])
}

export async function getJobLogs(jobId: number): Promise<JobLogRow[]> {
  return q<JobLogRow>(`SELECT * FROM job_logs WHERE job_id = ? ORDER BY ts ASC, id ASC`, [jobId])
}

export async function getPressReleaseForJob(job: Pick<JobRequestRow, 'id' | 'result_id'>): Promise<PressReleaseRow | null> {
  if (job.result_id) {
    const byResult = await qOne<PressReleaseRow>(`SELECT * FROM press_releases WHERE id = ?`, [job.result_id])
    if (byResult) return byResult
  }
  return qOne<PressReleaseRow>(`SELECT * FROM press_releases WHERE job_id = ? ORDER BY id DESC LIMIT 1`, [job.id])
}

export interface RecentJobRow {
  id: number
  signal_id: number
  signal_title: string
  status: string
  requested_at: string
  finished_at: string | null
  result_id: number | null
}

/** Openstaande jobs plus recent afgeronde (laatste 48u), voor het "Aanvragen"-blok op /dashboard. */
export async function getRecentJobs(limit = 20): Promise<RecentJobRow[]> {
  return q<RecentJobRow>(
    `SELECT jr.id, jr.signal_id, sig.title as signal_title, jr.status, jr.requested_at, jr.finished_at, jr.result_id
     FROM job_requests jr
     JOIN signals sig ON sig.id = jr.signal_id
     WHERE jr.status IN ('queued','running')
        OR (jr.finished_at IS NOT NULL AND julianday('now') - julianday(REPLACE(REPLACE(jr.finished_at,'T',' '),'Z','')) <= 2)
     ORDER BY jr.requested_at DESC
     LIMIT ?`,
    [limit]
  )
}
