import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import {
  getFunnel24h,
  getOpbrengstTotals,
  getLatestSignals,
  getLatestPublishedArticles,
  getAttentionPoints,
  getRecentJobs,
} from '@/lib/dashboard/queries'
import { formatDate, formatRelative, formatTime, SIGNAL_STATUS_META, JOB_STATUS_META } from '@/lib/dashboard/format'
import NoDatabase from './NoDatabase'

export const revalidate = 30

export default async function DashboardVandaagPage() {
  if (!hasTurso()) {
    return <NoDatabase />
  }

  const [funnel, opbrengst, latestSignals, latestArticles, attentionPoints, recentJobs] = await Promise.all([
    getFunnel24h(),
    getOpbrengstTotals(),
    getLatestSignals(6),
    getLatestPublishedArticles(6),
    getAttentionPoints(),
    getRecentJobs(),
  ])

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

      <div className="dash-funnel mt16">
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{opbrengst.totalSignals}</div>
          <div className="dash-funnel-label">Signalen tot nu toe</div>
        </div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{opbrengst.tier1Signals}</div>
          <div className="dash-funnel-label">Waarvan uit tier 1</div>
        </div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{opbrengst.totalPublished}</div>
          <div className="dash-funnel-label">Gepubliceerde artikelen</div>
        </div>
        <div className="dash-funnel-step">
          <div className="dash-funnel-num">{opbrengst.tier1Published}</div>
          <div className="dash-funnel-label">Waarvan uit tier 1</div>
        </div>
      </div>

      <div className="dash-grid mt24">
        <div className="dash-card">
          <div className="dash-card-title">Laatste signalen</div>
          {latestSignals.length === 0 ? (
            <div style={{ color: 'var(--t3)', fontSize: 14 }}>Nog geen signalen.</div>
          ) : (
            <div>
              {latestSignals.map((s) => (
                <Link key={s.id} href={`/dashboard/signaal/${s.id}`} className="dash-run-row">
                  <span className="dash-run-main">
                    <span className="dash-run-label">{s.title}</span>
                    <span className="dash-run-meta">{s.sourceName || 'onbekende bron'} · {formatRelative(s.lastSeenAt)}</span>
                  </span>
                  <span className="dash-run-outcome">{SIGNAL_STATUS_META[s.status]?.label || s.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Laatste artikelen</div>
          {latestArticles.length === 0 ? (
            <div style={{ color: 'var(--t3)', fontSize: 14 }}>Nog geen artikelen gepubliceerd.</div>
          ) : (
            <div>
              {latestArticles.map((a) => (
                <div key={a.id} className="dash-run-row">
                  <span className="dash-run-main">
                    <span className="dash-run-label">{a.title}</span>
                    <span className="dash-run-meta">{a.sourceName || 'onbekende bron'} · {formatDate(a.publishedAt)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {attentionPoints.length > 0 && (
        <div className="dash-card mt24">
          <div className="dash-card-title">Aandachtspunten</div>
          <div>
            {attentionPoints.map((p) => (
              <div key={p.label} className="dash-attn-row">
                <span className="dash-attn-label">
                  {p.href ? <Link href={p.href} style={{ color: 'inherit' }}>{p.label}</Link> : p.label}
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--t3)', marginTop: 2 }}>{p.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentJobs.length > 0 && (
        <div className="dash-card mt24">
          <div className="dash-card-title">Aanvragen</div>
          <div>
            {recentJobs.map((j) => (
              <div key={j.id} className="dash-run-row">
                <span className="dash-run-main">
                  <Link href={`/dashboard/signaal/${j.signal_id}`} className="dash-run-label" style={{ color: 'inherit' }}>
                    {j.signal_title}
                  </Link>
                  <span className="dash-run-meta">Aangevraagd om {formatTime(j.requested_at)}</span>
                </span>
                <span className="dash-run-outcome">
                  {j.status === 'done' ? (
                    <Link href={`/dashboard/signaal/${j.signal_id}`} style={{ color: 'var(--accent)' }}>
                      {JOB_STATUS_META.done.label} →
                    </Link>
                  ) : (
                    JOB_STATUS_META[j.status]?.label || j.status
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
