/* eslint-disable @typescript-eslint/no-explicit-any */
import { q, qOne } from '@/lib/turso'
import { daysSince, formatDate, parseBriefing } from './format'

// ── Schema-introspectie (defensief tegen ontbrekende kolommen/tabellen) ──
//
// Sommige kolommen (sources.health, press_releases.type) en tabelinhoud
// (signals.crossref_briefing) zijn recent of stapsgewijs toegevoegd door de
// scraper-kant. PRAGMA table_info geeft een lege set terug voor een
// niet-bestaande tabel (geen fout), dus dit dient ook als bestaan-check.
async function getTableColumns(table: string): Promise<Set<string>> {
  const rows = await q<{ name: string }>(`PRAGMA table_info(${table})`)
  return new Set(rows.map((r) => r.name))
}

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
  /** sources.health — door bronnenwacht.cjs bepaald op basis van de laatste gelogde runs, nooit op kalenderdagen. null als de kolom nog niet bestaat. */
  health: 'ok' | 'verdacht' | 'dood' | 'uitgeschakeld' | null
  healthNote: string | null
  lastHealthCheckAt: string | null
  /** Resultaat van de laatste gelogde run uit scrape_runs, ongeacht of die goed ging. */
  lastRun: { itemsFound: number | null; status: string | null; startedAt: string | null } | null
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

export interface SourcesOverview {
  rows: SourceRow[]
  /** true als sources.health bestaat — bepaalt of de gezondheidsbadge getoond wordt. */
  healthTracked: boolean
}

export async function getSourcesOverview(): Promise<SourcesOverview> {
  const sourceCols = await getTableColumns('sources')
  const healthTracked = sourceCols.has('health')

  const [sources, errorsBySource, publishedBySource, topSignalRows] = await Promise.all([
    q<any>(`
      SELECT
        s.id, s.name, s.url, s.tier, s.source_type,
        ${healthTracked ? 's.health, s.health_note, s.last_health_check,' : ''}
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
      SELECT source_id, status, error_message, items_found, started_at
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

  const rows = sources.map((s): SourceRow => {
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
      health: healthTracked ? (s.health ?? 'ok') : null,
      healthNote: healthTracked ? (s.health_note ?? null) : null,
      lastHealthCheckAt: healthTracked ? (s.last_health_check ?? null) : null,
      lastRun: latest ? { itemsFound: latest.items_found ?? null, status: latest.status ?? null, startedAt: latest.started_at ?? null } : null,
    }
  })

  return { rows, healthTracked }
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

// ── Persberichten ─────────────────────────────────────────
//
// press_releases wordt eenmaal per dag (13:00) gevuld door de redactieassistent
// (Cowork-agent op de notebook), die maximaal drie signalen uitwerkt tot een
// persbureaubericht. Dit dashboard is puur lezend voor deze tabel — geen knoppen,
// geen wachtrij, geen schrijvende route.

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
  /** 'persbericht' (default) of 'tip' — kolom toegevoegd P5, kan ontbreken op oudere rijen/databases. */
  type: 'persbericht' | 'tip' | null
  /** 'laag' | 'middel' | 'hoog' — verplicht bij tips, optioneel bij persberichten. */
  betrouwbaarheid: 'laag' | 'middel' | 'hoog' | null
}

const EFFECTIVE_TIER_JOIN = `
  LEFT JOIN (
    SELECT signal_id, tier FROM (
      SELECT si.signal_id, s.tier,
             ROW_NUMBER() OVER (PARTITION BY si.signal_id ORDER BY s.tier ASC, s.id ASC) as rn
      FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
    ) ranked WHERE rn = 1
  ) eff ON eff.signal_id = pr.signal_id
`

export interface PressReleaseListRow extends PressReleaseRow {
  signal_title: string
  signal_category: string | null
  eff_tier: number | null
}

/** Alle persberichten, nieuwste eerst — voor /dashboard/persberichten. */
export async function getPressReleasesOverview(): Promise<PressReleaseListRow[]> {
  return q<PressReleaseListRow>(`
    SELECT pr.*, sig.title as signal_title, sig.category as signal_category, eff.tier as eff_tier
    FROM press_releases pr
    JOIN signals sig ON sig.id = pr.signal_id
    ${EFFECTIVE_TIER_JOIN}
    ORDER BY pr.created_at DESC
  `)
}

/** Eén persbericht met signaalcontext, voor /dashboard/persbericht/[id]. */
export async function getPressRelease(id: number): Promise<PressReleaseListRow | null> {
  return qOne<PressReleaseListRow>(
    `SELECT pr.*, sig.title as signal_title, sig.category as signal_category, eff.tier as eff_tier
     FROM press_releases pr
     JOIN signals sig ON sig.id = pr.signal_id
     ${EFFECTIVE_TIER_JOIN}
     WHERE pr.id = ?`,
    [id]
  )
}

/** Meest recente persbericht voor een signaal, indien aanwezig — voor de link op het signaaldossier. */
export async function getLatestPressReleaseForSignal(signalId: number): Promise<{ id: number } | null> {
  return qOne<{ id: number }>(
    `SELECT id FROM press_releases WHERE signal_id = ? ORDER BY created_at DESC LIMIT 1`,
    [signalId]
  )
}

/**
 * Persberichten van de afgelopen 24 uur, voor het blok op /dashboard — zelfde
 * rollende-24u-definitie van "vandaag" als de rest van deze pagina (zie getFunnel24h).
 */
export async function getTodaysPressReleases(): Promise<PressReleaseListRow[]> {
  return q<PressReleaseListRow>(`
    SELECT pr.*, sig.title as signal_title, sig.category as signal_category, eff.tier as eff_tier
    FROM press_releases pr
    JOIN signals sig ON sig.id = pr.signal_id
    ${EFFECTIVE_TIER_JOIN}
    WHERE julianday(REPLACE(REPLACE(pr.created_at,'T',' '),'Z','')) >= julianday('now','-1 day')
    ORDER BY pr.created_at DESC
  `)
}

// ── Dwarsverbanden ────────────────────────────────────────
//
// Twee bronnen voor hetzelfde soort signaal: (1) signalen die de speurder
// zelf als LABEL: DWARSVERBAND markeert in de briefingtekst (zelfde
// conventie als LABEL: WEEKANALYSE, zie parseBriefing), en (2) losse
// detecties die dwarsverbanden2.cjs (KRUISBRON/STAPELING/SUBSIDIE/
// ROLCONFLICT) in signals.crossref_briefing schrijft — één regel per
// detectie, cumulatief aangevuld, format:
// "[DET | betrouwbaarheid: X] entiteit: info. Journalistieke vraag: Y".
// item_ids van een detectie worden niet bewaard, dus "betrokken
// documenten/bronklassen" wordt hier afgeleid van de bronnen die aan het
// gekoppelde signaal hangen (signal_items → raw_items → sources).

export interface DwarsverbandItem {
  kind: 'label' | 'detectie'
  signalId: number
  signalTitle: string
  signalStatus: string
  /** KRUISBRON | STAPELING | SUBSIDIE | ROLCONFLICT — alleen bij kind 'detectie' met herkend format. */
  detector: string | null
  entity: string | null
  betrouwbaarheid: 'laag' | 'middel' | 'hoog' | null
  info: string
  vraag: string | null
  bronKlassen: string[]
  entities: string[]
  lastSeenAt: string
}

const BETROUWBAARHEID_RANK: Record<string, number> = { hoog: 3, middel: 2, laag: 1 }
const DETECTION_HEADER_RE = /^\[([A-Z]+)\s*\|\s*betrouwbaarheid:\s*(laag|middel|hoog)\]\s*(.+)$/i

function parseCrossrefLine(line: string): { detector: string | null; entity: string | null; betrouwbaarheid: 'laag' | 'middel' | 'hoog' | null; info: string; vraag: string | null } {
  const header = DETECTION_HEADER_RE.exec(line.trim())
  if (!header) return { detector: null, entity: null, betrouwbaarheid: null, info: line.trim(), vraag: null }

  const [, detector, betrouwbaarheid, rest] = header
  const colonIdx = rest.indexOf(': ')
  const entity = colonIdx >= 0 ? rest.slice(0, colonIdx).trim() : null
  const remainder = colonIdx >= 0 ? rest.slice(colonIdx + 2) : rest

  const vraagMarker = 'Journalistieke vraag:'
  const vraagIdx = remainder.indexOf(vraagMarker)
  const info = (vraagIdx >= 0 ? remainder.slice(0, vraagIdx) : remainder).replace(/\.\s*$/, '').trim()
  const vraag = vraagIdx >= 0 ? remainder.slice(vraagIdx + vraagMarker.length).trim() : null

  return { detector: detector.toUpperCase(), entity, betrouwbaarheid: betrouwbaarheid.toLowerCase() as 'laag' | 'middel' | 'hoog', info, vraag }
}

/**
 * Overzicht voor /dashboard/dwarsverbanden. Geeft supported: false terug als
 * signals.crossref_briefing nog niet bestaat op deze database — de pagina
 * verbergt de feature dan in plaats van te crashen.
 */
export async function getDwarsverbanden(): Promise<{ items: DwarsverbandItem[]; supported: boolean }> {
  const signalCols = await getTableColumns('signals')
  if (!signalCols.has('crossref_briefing')) return { items: [], supported: false }

  const rows = await q<any>(`
    SELECT id, title, status, summary, crossref_briefing, last_seen_at
    FROM signals
    WHERE crossref_briefing IS NOT NULL OR summary LIKE '%DWARSVERBAND%'
  `)
  if (rows.length === 0) return { items: [], supported: true }

  const ids = rows.map((r: any) => r.id)
  const placeholders = ids.map(() => '?').join(',')

  const [bronRows, entityRows] = await Promise.all([
    q<any>(
      `SELECT DISTINCT si.signal_id, s.name as source_name, s.category
       FROM signal_items si JOIN raw_items r ON r.id = si.raw_item_id JOIN sources s ON s.id = r.source_id
       WHERE si.signal_id IN (${placeholders})`,
      ids
    ),
    q<any>(
      `SELECT DISTINCT es.signal_id, e.name
       FROM entity_signals es JOIN entities e ON e.id = es.entity_id
       WHERE es.signal_id IN (${placeholders})`,
      ids
    ),
  ])

  const bronBySignal = new Map<number, Set<string>>()
  for (const r of bronRows) {
    if (!bronBySignal.has(r.signal_id)) bronBySignal.set(r.signal_id, new Set())
    bronBySignal.get(r.signal_id)!.add(r.category || r.source_name)
  }
  const entitiesBySignal = new Map<number, Set<string>>()
  for (const r of entityRows) {
    if (!entitiesBySignal.has(r.signal_id)) entitiesBySignal.set(r.signal_id, new Set())
    entitiesBySignal.get(r.signal_id)!.add(r.name)
  }

  const items: DwarsverbandItem[] = []

  for (const r of rows) {
    const bronKlassen = Array.from(bronBySignal.get(r.id) ?? [])
    const entities = Array.from(entitiesBySignal.get(r.id) ?? [])

    if (r.crossref_briefing) {
      const lines = String(r.crossref_briefing).split('\n').map((l: string) => l.trim()).filter(Boolean)
      for (const line of lines) {
        const parsed = parseCrossrefLine(line)
        items.push({
          kind: 'detectie',
          signalId: r.id,
          signalTitle: r.title,
          signalStatus: r.status,
          bronKlassen,
          entities,
          lastSeenAt: r.last_seen_at,
          ...parsed,
        })
      }
    }

    const hasDwarsLabel = parseBriefing(r.summary).tags.some((t) => /^label:/i.test(t.key) && /dwarsverband/i.test(t.label))
    if (hasDwarsLabel) {
      items.push({
        kind: 'label',
        signalId: r.id,
        signalTitle: r.title,
        signalStatus: r.status,
        detector: null,
        entity: entities[0] ?? null,
        betrouwbaarheid: null,
        info: 'Door de speurder gelabeld als dwarsverband.',
        vraag: null,
        bronKlassen,
        entities,
        lastSeenAt: r.last_seen_at,
      })
    }
  }

  items.sort((a, b) => {
    const rankA = a.betrouwbaarheid ? BETROUWBAARHEID_RANK[a.betrouwbaarheid] : 0
    const rankB = b.betrouwbaarheid ? BETROUWBAARHEID_RANK[b.betrouwbaarheid] : 0
    if (rankA !== rankB) return rankB - rankA
    return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '')
  })

  return { items, supported: true }
}
