/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { getIntakeRunDetail } from '@/lib/dashboard/queries'
import { formatDateTime, formatDuration, DECISION_META } from '@/lib/dashboard/format'
import NoDatabase from '../../NoDatabase'

export const revalidate = 30

interface Props {
  params: Promise<{ runId: string }>
  searchParams: Promise<{ decision?: string }>
}

const DECISION_ORDER = ['new_signal', 'historical_signal', 'matched', 'filtered']

export default async function IntakeRunPage({ params, searchParams }: Props) {
  if (!hasTurso()) return <NoDatabase />

  const { runId } = await params
  const { decision: decisionFilter } = await searchParams
  const id = parseInt(runId, 10)
  if (Number.isNaN(id)) notFound()

  const { run, decisions, reasonBreakdown } = await getIntakeRunDetail(id)
  if (!run) notFound()

  const counts: Record<string, number> = {}
  for (const d of decisions) counts[d.decision] = (counts[d.decision] || 0) + 1

  const visible = decisionFilter ? decisions.filter((d: any) => d.decision === decisionFilter) : decisions

  return (
    <div>
      <div className="crumb mt8">
        <Link href="/dashboard/intake" className="crumb-link">Intake</Link>
        <span>›</span>
        <span>Run #{run.id}</span>
      </div>

      <div className="dash-card mt16">
        <p style={{ fontSize: 16, fontFamily: 'var(--f-b)', color: 'var(--t1)', lineHeight: 1.6 }}>
          <strong>{run.items_in}</strong> items binnengekomen, <strong>{run.items_filtered}</strong> gefilterd,{' '}
          <strong>{run.items_matched}</strong> gekoppeld aan bestaande signalen, <strong>{run.signals_created}</strong> nieuwe signalen
          {run.signals_historical > 0 ? <>, <strong>{run.signals_historical}</strong> historische signalen</> : null}.
        </p>
        <div style={{ fontSize: 13, color: 'var(--t3)', marginTop: 8 }}>
          {formatDateTime(run.started_at)} · trigger: {run.trigger || '—'} · duur: {formatDuration(run.duration_ms)} ·{' '}
          {run.status === 'error' ? <span style={{ color: 'var(--error)' }}>fout: {run.error_message}</span> : 'status: ok'}
        </div>

        {reasonBreakdown.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-s)' }}>
            <div className="dash-card-title" style={{ marginBottom: 10 }}>Filterredenen</div>
            {reasonBreakdown.map((r: any) => (
              <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', color: 'var(--t2)' }}>
                <span>{r.reason}</span>
                <strong style={{ color: 'var(--t1)' }}>{r.count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="dash-filters mt24">
        <Link href={`/dashboard/intake/${id}`} className={`dash-filter-chip${!decisionFilter ? ' dash-filter-chip-active' : ''}`}>
          Alle ({decisions.length})
        </Link>
        {DECISION_ORDER.filter((d) => counts[d]).map((d) => (
          <Link key={d} href={`/dashboard/intake/${id}?decision=${d}`} className={`dash-filter-chip${decisionFilter === d ? ' dash-filter-chip-active' : ''}`}>
            {DECISION_META[d]?.label || d} ({counts[d]})
          </Link>
        ))}
      </div>

      <div className="dash-table-wrap mt16">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Bron</th>
              <th>Titel</th>
              <th>Beslissing</th>
              <th>Reden</th>
              <th>Entiteiten</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d: any) => {
              let entities: { type: string; name: string }[] = []
              try { entities = d.entities_found ? JSON.parse(d.entities_found) : [] } catch { /* niet json */ }
              return (
                <tr key={d.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{d.source_name || '—'}</td>
                  <td style={{ maxWidth: 360 }}>{d.item_title || '(geen titel)'}</td>
                  <td>
                    <span className="dash-pill" style={{ background: `${DECISION_META[d.decision]?.color || 'var(--t3)'}22`, color: DECISION_META[d.decision]?.color || 'var(--t3)' }}>
                      {DECISION_META[d.decision]?.label || d.decision}
                    </span>
                    {d.signal_id && (
                      <div style={{ marginTop: 4 }}>
                        <Link href={`/dashboard/signaal/${d.signal_id}`} style={{ fontSize: 12, color: 'var(--accent)' }}>
                          → signaal #{d.signal_id}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--t2)', maxWidth: 320 }}>{d.reason}</td>
                  <td>
                    {entities.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {entities.slice(0, 4).map((e, i) => (
                          <span key={i} className="ent-chip" style={{ cursor: 'default', fontSize: 11 }}>{e.name}</span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
