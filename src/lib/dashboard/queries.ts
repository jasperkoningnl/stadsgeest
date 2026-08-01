/* eslint-disable @typescript-eslint/no-explicit-any */
import { q, qOne } from '@/lib/turso'
import { daysSince } from './format'

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

export interface RunEntry {
  kind: 'scrape' | 'intake'
  id: number | string
  label: string
  startedAt: string
  durationMs: number | null
  outcome: string
}

export async function getLatestRuns(limit = 8): Promise<RunEntry[]> {
  const [scrapeBatches, intakeRuns] = await Promise.all([
    q<any>(`
      SELECT
        job_name,
        strftime('%Y-%m-%d %H:%M', started_at) as batch_key,
        MIN(started_at) as started_at,
        COUNT(*) as file_count,
        SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as ok_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout_count,
        SUM(COALESCE(duration_ms, 0)) as total_duration_ms
      FROM scrape_runs
      WHERE scraper_file IS NOT NULL
      GROUP BY job_name, batch_key
      ORDER BY started_at DESC
      LIMIT ?
    `, [limit]),
    q<any>(`
      SELECT id, trigger, started_at, duration_ms, items_in, items_filtered, signals_created, status
      FROM intake_runs ORDER BY started_at DESC LIMIT ?
    `, [limit]),
  ])

  const entries: RunEntry[] = []

  for (const b of scrapeBatches) {
    const problems = (b.error_count || 0) + (b.timeout_count || 0)
    entries.push({
      kind: 'scrape',
      id: `${b.job_name}-${b.batch_key}`,
      label: `${b.job_name} — ${b.file_count} scrapers`,
      startedAt: b.started_at,
      durationMs: b.total_duration_ms ?? null,
      outcome: problems > 0 ? `${b.ok_count} ok, ${problems} met fout` : `${b.ok_count} ok`,
    })
  }

  for (const r of intakeRuns) {
    entries.push({
      kind: 'intake',
      id: r.id,
      label: `Intake (${r.trigger || 'onbekend'})`,
      startedAt: r.started_at,
      durationMs: r.duration_ms ?? null,
      outcome:
        r.status === 'error'
          ? 'fout'
          : `${r.items_in ?? 0} items, ${r.signals_created ?? 0} nieuwe signalen`,
    })
  }

  entries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
  return entries.slice(0, limit)
}

export interface AttentionItems {
  staleSourceCount: number
  failedScrapers: { scraperFile: string; errorMessage: string | null; startedAt: string }[]
  unprocessedCount: number
}

export async function getAttentionItems(): Promise<AttentionItems> {
  const [stale, failed, unprocessed] = await Promise.all([
    qOne<{ c: number }>(`
      SELECT COUNT(*) c FROM (
        SELECT s.id, MAX(r.scraped_at) as last_at
        FROM sources s JOIN raw_items r ON r.source_id = s.id
        GROUP BY s.id
        HAVING julianday('now') - julianday(MAX(r.scraped_at)) > 14
      )
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
    qOne<{ c: number }>(`SELECT COUNT(*) c FROM raw_items WHERE is_processed = 0`),
  ])

  return {
    staleSourceCount: stale?.c ?? 0,
    failedScrapers: failed.map((f) => ({ scraperFile: f.scraper_file, errorMessage: f.error_message, startedAt: f.started_at })),
    unprocessedCount: unprocessed?.c ?? 0,
  }
}

export async function getSignalStatusBreakdown(): Promise<{ status: string; count: number }[]> {
  const rows = await q<{ status: string; count: number }>(`SELECT status, COUNT(*) as count FROM signals GROUP BY status ORDER BY count DESC`)
  return rows
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
  lastErrorStatus: string | null
  lastErrorMessage: string | null
  daysSinceLast: number | null
  healthStatus: 'green' | 'grey' | 'red'
}

export async function getSourcesOverview(): Promise<SourceRow[]> {
  const [sources, errorsBySource] = await Promise.all([
    q<any>(`
      SELECT
        s.id, s.name, s.url, s.tier, s.source_type,
        MAX(r.scraped_at) as last_item_at,
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
  ])

  const latestBySource = new Map<number, any>()
  for (const e of errorsBySource) {
    if (!latestBySource.has(e.source_id)) latestBySource.set(e.source_id, e)
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
       WHERE si.signal_id = ? ORDER BY r.scraped_at DESC`,
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
