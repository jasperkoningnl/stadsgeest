import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getFunnel24h, getLatestRuns, getAttentionItems, getSignalStatusBreakdown } from '@/lib/dashboard/queries'
import { formatDateTime, formatDuration, formatRelative, SIGNAL_STATUS_META } from '@/lib/dashboard/format'
import NoDatabase from './NoDatabase'

export const revalidate = 30

export default async function DashboardVandaagPage() {
  if (!hasTurso()) {
    return <NoDatabase />
  }

  const [funnel, runs, attention, statusBreakdown] = await Promise.all([
    getFunnel24h(),
    getLatestRuns(10),
    getAttentionItems(),
    getSignalStatusBreakdown(),
  ])

  const totalSignals = statusBreakdown.reduce((sum, s) => sum + s.count, 0)

  return (
    <div>
      <div className="dash-funnel mt8">
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{funnel.itemsScraped}</div>
          <div className="dash-funnel-label">Items gescraped (24u)</div>
        </div>
        <div className="dash-funnel-arrow">→</div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{funnel.itemsIntake}</div>
          <div className="dash-funnel-label">Door intake (24u)</div>
        </div>
        <div className="dash-funnel-arrow">→</div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{funnel.newSignals}</div>
          <div className="dash-funnel-label">Nieuwe signalen (24u)</div>
        </div>
        <div className="dash-funnel-arrow">→</div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{funnel.candidatesResearching}</div>
          <div className="dash-funnel-label">Kandidaten geworden (24u)</div>
        </div>
      </div>

      <div className="dash-grid mt24">
        <div className="dash-card">
          <div className="dash-card-title">Laatste runs</div>
          {runs.length === 0 ? (
            <div style={{ color: 'var(--t3)', fontSize: 14 }}>Nog geen runs gelogd.</div>
          ) : (
            <div>
              {runs.map((r) =>
                r.kind === 'intake' ? (
                  <Link key={`${r.kind}-${r.id}`} href={`/dashboard/intake/${r.id}`} className="dash-run-row">
                    <span className={`dash-run-kind dash-run-kind-${r.kind}`}>{r.kind}</span>
                    <span className="dash-run-main">
                      <span className="dash-run-label">{r.label}</span>
                      <span className="dash-run-meta">{formatDateTime(r.startedAt)} · {formatDuration(r.durationMs)}</span>
                    </span>
                    <span className="dash-run-outcome">{r.outcome}</span>
                  </Link>
                ) : (
                  <div key={`${r.kind}-${r.id}`} className="dash-run-row">
                    <span className={`dash-run-kind dash-run-kind-${r.kind}`}>{r.kind}</span>
                    <span className="dash-run-main">
                      <span className="dash-run-label">{r.label}</span>
                      <span className="dash-run-meta">{formatDateTime(r.startedAt)} · {formatDuration(r.durationMs)}</span>
                    </span>
                    <span className="dash-run-outcome">{r.outcome}</span>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Aandachtspunten</div>
          <div>
            <div className="dash-attn-row">
              <span className="dash-attn-label">Bronnen die &gt;14 dagen niets opleverden</span>
              {attention.staleSourceCount > 0 ? (
                <Link href="/dashboard/bronnen?health=grey" className="dash-attn-count">{attention.staleSourceCount}</Link>
              ) : (
                <span className="dash-attn-ok">0</span>
              )}
            </div>
            <div className="dash-attn-row">
              <span className="dash-attn-label">Scrapers met fout bij laatste run</span>
              {attention.failedScrapers.length > 0 ? (
                <Link href="/dashboard/bronnen?health=red" className="dash-attn-count">{attention.failedScrapers.length}</Link>
              ) : (
                <span className="dash-attn-ok">0</span>
              )}
            </div>
            <div className="dash-attn-row">
              <span className="dash-attn-label">Onverwerkte raw_items</span>
              {attention.unprocessedCount > 50 ? (
                <span className="dash-attn-count">{attention.unprocessedCount}</span>
              ) : (
                <span className="dash-attn-ok">{attention.unprocessedCount}</span>
              )}
            </div>
          </div>
          {attention.failedScrapers.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-s)' }}>
              {attention.failedScrapers.slice(0, 5).map((f) => (
                <div key={f.scraperFile} style={{ fontSize: 12.5, color: 'var(--t2)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--t1)' }}>{f.scraperFile}</strong> — {f.errorMessage || 'onbekende fout'}
                  <span style={{ color: 'var(--t3)' }}> ({formatRelative(f.startedAt)})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="dash-card mt24">
        <div className="dash-card-title">Signalen per status</div>
        <div className="dash-status-bar">
          {statusBreakdown.map((s) => (
            <div
              key={s.status}
              style={{
                width: `${totalSignals > 0 ? (s.count / totalSignals) * 100 : 0}%`,
                background: SIGNAL_STATUS_META[s.status]?.color || 'var(--t3)',
              }}
            />
          ))}
        </div>
        <div className="dash-status-legend">
          {statusBreakdown.map((s) => (
            <div key={s.status} className="dash-status-legend-item">
              <span className="dash-status-dot" style={{ background: SIGNAL_STATUS_META[s.status]?.color || 'var(--t3)' }} />
              {SIGNAL_STATUS_META[s.status]?.label || s.status}: <strong style={{ color: 'var(--t1)' }}>{s.count}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
