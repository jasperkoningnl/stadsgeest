import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import {
  getFunnel24h,
  getOpbrengstTotals,
  getLatestSignals,
  getLatestPublishedArticles,
  getAttentionPoints,
  getTodaysPressReleases,
} from '@/lib/dashboard/queries'
import { formatDate, formatRelative, SIGNAL_STATUS_META, TIER_META } from '@/lib/dashboard/format'
import NoDatabase from './NoDatabase'

export const revalidate = 30

export default async function DashboardVandaagPage() {
  if (!hasTurso()) {
    return <NoDatabase />
  }

  const [funnel, opbrengst, latestSignals, latestArticles, attentionPoints, todaysPressReleases] = await Promise.all([
    getFunnel24h(),
    getOpbrengstTotals(),
    getLatestSignals(6),
    getLatestPublishedArticles(6),
    getAttentionPoints(),
    getTodaysPressReleases(),
  ])

  return (
    <div>
      {todaysPressReleases.length > 0 && (
        <div className="dash-card mt8">
          <div className="dash-card-title">Persberichten van vandaag</div>
          <div className="dash-pr-list dash-pr-list-compact">
            {todaysPressReleases.map((r) => (
              <Link key={r.id} href={`/dashboard/persbericht/${r.id}`} className="dash-pr-card">
                <div className="dash-pr-card-headline">{r.headline || r.signal_title}</div>
                <div className="dash-pr-card-tags">
                  {r.eff_tier ? (
                    <span className="dash-tier-pill" title={TIER_META[r.eff_tier]?.desc}>T{r.eff_tier}</span>
                  ) : null}
                  <span className="dash-pr-card-category">{r.signal_category || 'Geen categorie'}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`dash-funnel ${todaysPressReleases.length > 0 ? 'mt24' : 'mt8'}`}>
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
    </div>
  )
}
