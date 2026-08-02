import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getIntakeRuns } from '@/lib/dashboard/queries'
import { formatDateTime, formatDuration } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

export default async function IntakePage() {
  if (!hasTurso()) return <NoDatabase />

  const runs = await getIntakeRuns()

  return (
    <div>
      {runs.length === 0 ? (
        <div className="empty-state mt8">Nog geen intake-runs gelogd.</div>
      ) : (
        <div className="dash-runlist mt8">
          <div className="dash-runlist-grid">
            <div className="dash-runlist-head">Tijdstip</div>
            <div className="dash-runlist-head">Trigger</div>
            <div className="dash-runlist-head">Duur</div>
            <div className="dash-runlist-head">Binnen</div>
            <div className="dash-runlist-head">Gefilterd</div>
            <div className="dash-runlist-head">Gekoppeld</div>
            <div className="dash-runlist-head">Nieuw</div>
            <div className="dash-runlist-head">Historisch</div>
            <div className="dash-runlist-head">Status</div>
          </div>
          {runs.map((r) => (
            <Link key={r.id} href={`/dashboard/intake/${r.id}`} className="dash-runlist-grid dash-runlist-row" style={{ display: 'grid' }}>
              <div>{formatDateTime(r.started_at)}</div>
              <div>{r.trigger || '—'}</div>
              <div>{formatDuration(r.duration_ms)}</div>
              <div>{r.items_in}</div>
              <div>{r.items_filtered}</div>
              <div>{r.items_matched}</div>
              <div>{r.signals_created}</div>
              <div>{r.signals_historical}</div>
              <div style={{ color: r.status === 'error' ? 'var(--error)' : '#5fd97a' }}>
                {r.status === 'error' ? 'fout' : 'ok'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
