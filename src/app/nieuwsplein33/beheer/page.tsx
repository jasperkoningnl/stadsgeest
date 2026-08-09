import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hasTurso } from '@/lib/turso'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import {
  getIntakeRuns, getTierAggregates, getSourcesOverview,
  type IntakeRun, type TierAggregate, type SourcesOverview,
} from '@/lib/dashboard/beheerQueries'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/dashboard/format'
import GeenDatabase from '../GeenDatabase'

export const metadata: Metadata = {
  title: 'Beheer — Nieuwsplein33',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const HEALTH_LABEL: Record<string, string> = {
  ok: 'gezond', verdacht: 'verdacht', dood: 'dood', uitgeschakeld: 'uitgeschakeld',
}

export default async function BeheerPagina() {
  // Los van de proxy: deze pagina is alleen voor Jasper, andere ingelogde
  // redactieleden mogen hem niet eens per ongeluk via de URL bereiken.
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)
  if (gebruiker !== 'jasper') redirect('/nieuwsplein33')

  if (!hasTurso()) return <GeenDatabase />

  const [runs, tiers, bronnen] = await Promise.all([
    getIntakeRuns(10),
    getTierAggregates(),
    getSourcesOverview(),
  ])

  const laatste = runs[0] ?? null

  return (
    <div>
      <p className="np-telling">Laatste intake</p>
      {laatste ? <IntakeKaart run={laatste} /> : <p className="np-leeg">Nog geen intake-runs gevonden.</p>}

      {runs.length > 1 && <RunGeschiedenis runs={runs.slice(1)} />}

      <p className="np-telling" style={{ marginTop: 32 }}>Bronnen per tier</p>
      <TierTabel tiers={tiers} />

      <p className="np-telling" style={{ marginTop: 32 }}>
        Alle bronnen ({bronnen.rows.length})
      </p>
      <BronnenTabel overzicht={bronnen} />
    </div>
  )
}

function IntakeKaart({ run }: { run: IntakeRun }) {
  const mislukt = run.status === 'error' || run.status === 'timeout'
  return (
    <div className="np-beheer-kaart">
      <div className="np-beheer-kaart-kop">
        <strong>{formatDateTime(run.started_at)}</strong>
        <span className={`np-badge${mislukt ? ' np-badge-rood' : ' np-badge-groen'}`}>
          {run.status ?? 'onbekend'}
        </span>
        <span className="np-bron">{run.trigger ?? 'trigger onbekend'}</span>
        <span className="np-bron-rest">duur {formatDuration(run.duration_ms)}</span>
      </div>
      <div className="np-beheer-trechter">
        <span>{run.items_in ?? 0} binnengekomen</span>
        <span>→</span>
        <span>{run.items_filtered ?? 0} gefilterd</span>
        <span>→</span>
        <span>{run.items_matched ?? 0} gematcht</span>
        <span>→</span>
        <span><strong>{run.signals_created ?? 0}</strong> nieuwe signalen</span>
        {Boolean(run.signals_historical) && <span>({run.signals_historical} historisch)</span>}
      </div>
      {run.error_message && <p className="np-beheer-fout">{run.error_message}</p>}
    </div>
  )
}

function RunGeschiedenis({ runs }: { runs: IntakeRun[] }) {
  return (
    <details className="np-beheer-history">
      <summary>Vorige {runs.length} runs</summary>
      <div className="np-beheer-tabel-wrap">
        <table className="np-tabel">
          <thead>
            <tr><th>Datum</th><th>Trigger</th><th>Status</th><th>Signalen</th><th>Duur</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.started_at)}</td>
                <td className="np-bron">{r.trigger ?? '—'}</td>
                <td>{r.status ?? '—'}</td>
                <td>{r.signals_created ?? 0}</td>
                <td className="np-bron-rest">{formatDuration(r.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function TierTabel({ tiers }: { tiers: TierAggregate[] }) {
  return (
    <div className="np-beheer-tabel-wrap">
      <table className="np-tabel">
        <thead>
          <tr><th>Tier</th><th>Bronnen</th><th>Items totaal</th></tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tier}>
              <td><span className="np-tier">tier {t.tier}</span></td>
              <td>{t.sourceCount}</td>
              <td>{t.items}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BronnenTabel({ overzicht }: { overzicht: SourcesOverview }) {
  return (
    <div className="np-beheer-tabel-wrap">
      <table className="np-tabel">
        <thead>
          <tr>
            <th>Bron</th><th>Tier</th><th>Actief</th>
            {overzicht.healthTracked && <th>Gezondheid</th>}
            <th>Laatste item</th><th>7d</th><th>30d</th><th>Totaal</th>
          </tr>
        </thead>
        <tbody>
          {overzicht.rows.map((s) => (
            <tr key={s.id} className={s.isActive ? undefined : 'np-beheer-rij-inactief'}>
              <td>{s.name}</td>
              <td>{s.tier ? <span className="np-tier">tier {s.tier}</span> : '—'}</td>
              <td className="np-bron-rest">{s.isActive ? 'ja' : 'nee'}</td>
              {overzicht.healthTracked && (
                <td>
                  {s.health && (
                    <span
                      className={`np-badge${s.health === 'ok' ? ' np-badge-groen' : s.health === 'verdacht' ? ' np-badge-amber' : ' np-badge-rood'}`}
                      title={s.healthNote ?? undefined}
                    >
                      {HEALTH_LABEL[s.health] ?? s.health}
                    </span>
                  )}
                </td>
              )}
              <td className="np-bron-rest">{formatRelative(s.lastItemAt)}</td>
              <td>{s.items7d}</td>
              <td>{s.items30d}</td>
              <td className="np-bron-rest">{s.itemsTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
