/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getSignalsArchive, getAllSourceNames } from '@/lib/dashboard/queries'
import { formatDate, SIGNAL_STATUS_META, TIER_META } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

interface Props {
  searchParams: Promise<{
    status?: string
    tier?: string
    bron?: string
    period?: string
    q?: string
    page?: string
  }>
}

const ALL_STATUSES = ['new', 'watching', 'researching', 'published', 'discarded']

function buildQuery(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const merged = { ...base, ...overrides }
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(merged)) {
    if (v) sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export default async function SignalenPage({ searchParams }: Props) {
  if (!hasTurso()) return <NoDatabase />

  const params = await searchParams
  const activeStatuses = params.status ? params.status.split(',').filter(Boolean) : []
  const tier = params.tier ? parseInt(params.tier, 10) : undefined
  const bron = params.bron || undefined
  const period = (params.period as '7d' | '30d' | '90d' | undefined) || undefined
  const q = params.q || undefined
  const page = params.page ? parseInt(params.page, 10) : 1

  const [{ rows, total, pageSize }, sourceNames] = await Promise.all([
    getSignalsArchive({ status: activeStatuses, tier, bron, period, q, page }),
    getAllSourceNames(),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const baseParams = { status: params.status, tier: params.tier, bron: params.bron, period: params.period, q: params.q }

  function toggleStatus(status: string): string {
    const set = new Set(activeStatuses)
    if (set.has(status)) set.delete(status)
    else set.add(status)
    return buildQuery(baseParams, { status: Array.from(set).join(',') || undefined, page: undefined })
  }

  return (
    <div>
      <form action="/dashboard/signalen" method="GET" className="dash-filters mt8" style={{ alignItems: 'stretch' }}>
        <input type="search" name="q" defaultValue={q} placeholder="Zoek op titel of summary…" className="dash-search-input" style={{ minWidth: 240 }} />
        <input type="hidden" name="status" value={activeStatuses.join(',')} />
        <select name="tier" defaultValue={tier || ''} className="dash-select">
          <option value="">Alle tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <select name="bron" defaultValue={bron || ''} className="dash-select">
          <option value="">Alle bronnen</option>
          {sourceNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select name="period" defaultValue={period || ''} className="dash-select">
          <option value="">Alle periodes</option>
          <option value="7d">Laatste 7 dagen</option>
          <option value="30d">Laatste 30 dagen</option>
          <option value="90d">Laatste 90 dagen</option>
        </select>
        <button type="submit" className="btn btn-primary">Filteren</button>
      </form>

      <div className="dash-filters mt16">
        {ALL_STATUSES.map((s) => (
          <Link
            key={s}
            href={toggleStatus(s)}
            className={`dash-filter-chip${activeStatuses.includes(s) ? ' dash-filter-chip-active' : ''}`}
          >
            {SIGNAL_STATUS_META[s]?.label || s}
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 13, color: 'var(--t3)', margin: '4px 0 16px' }}>{total} signalen gevonden.</p>

      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Titel</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Bron</th>
              <th>Bevestigingen</th>
              <th>Eerst gezien</th>
              <th>Laatst gezien</th>
              <th>Artikel</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/dashboard/signaal/${r.id}`} className="dash-row-link" style={{ color: 'var(--accent)' }}>#{r.id}</Link>
                </td>
                <td style={{ maxWidth: 340 }}>
                  <Link href={`/dashboard/signaal/${r.id}`} style={{ color: 'inherit' }}>{r.title}</Link>
                </td>
                <td>
                  <span className="dash-pill" style={{ background: `${SIGNAL_STATUS_META[r.status]?.color || 'var(--t3)'}22`, color: SIGNAL_STATUS_META[r.status]?.color || 'var(--t3)' }}>
                    {SIGNAL_STATUS_META[r.status]?.label || r.status}
                  </span>
                </td>
                <td>{r.eff_tier ? <span className="dash-tier-pill" title={TIER_META[r.eff_tier]?.desc}>T{r.eff_tier}</span> : '—'}</td>
                <td style={{ fontSize: 13 }}>{r.eff_source || '—'}</td>
                <td>{r.confirmations}</td>
                <td>{formatDate(r.first_seen_at)}</td>
                <td>{formatDate(r.last_seen_at)}</td>
                <td>{r.article_id ? <span style={{ color: '#5fd97a' }}>ja</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty-state">Geen signalen gevonden met deze filters.</div>}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
          {page > 1 ? (
            <Link href={buildQuery(baseParams, { page: String(page - 1) })} style={{ fontSize: 14, color: 'var(--accent)' }}>← Vorige</Link>
          ) : <span />}
          <span style={{ fontSize: 13, color: 'var(--t3)' }}>Pagina {page} van {totalPages}</span>
          {page < totalPages ? (
            <Link href={buildQuery(baseParams, { page: String(page + 1) })} style={{ fontSize: 14, color: 'var(--accent)' }}>Volgende →</Link>
          ) : <span />}
        </div>
      )}

      <div className="dash-legend mt24">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="dash-legend-item"><strong>{SIGNAL_STATUS_META[s]?.label}</strong> — {SIGNAL_STATUS_META[s]?.desc}</div>
        ))}
      </div>
    </div>
  )
}
