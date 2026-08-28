'use client'

import { useMemo, useState } from 'react'
import type {
  IntakeRun, IntakeFunnel, IntakeDecision, FilterReason, TopEntity,
} from '@/lib/dashboard/beheerQueries'
import { formatDateTime, formatDuration, formatRelative } from '@/lib/dashboard/format'

const BESLISSING_OPTIES = ['filtered', 'matched', 'new_signal'] as const
const BESLISSING_LABEL: Record<string, string> = {
  filtered: 'gefilterd',
  matched: 'gematcht',
  new_signal: 'nieuw signaal',
}
const BESLISSING_KLEUR: Record<string, string> = {
  filtered: 'np-badge-rood',
  matched: 'np-badge-blauw',
  new_signal: 'np-badge-groen',
}

interface IntakeTabProps {
  funnel: IntakeFunnel
  decisions: IntakeDecision[]
  filterReasons: FilterReason[]
  topEntities: TopEntity[]
  laatsteRun: IntakeRun | null
  periodeLabel: string
}

export default function IntakeTab({
  funnel,
  decisions,
  filterReasons,
  topEntities,
  laatsteRun,
  periodeLabel,
}: IntakeTabProps) {
  const [filters, setFilters] = useState<Set<string>>(new Set())
  const [openRij, setOpenRij] = useState<number | null>(null)

  function toggleFilter(f: string) {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  const gefilterdeDecisions = useMemo(() => {
    if (filters.size === 0) return decisions
    return decisions.filter((d) => filters.has(d.decision))
  }, [decisions, filters])

  const maxReason = filterReasons[0]?.count ?? 1
  const pctFiltered = funnel.totalIn > 0 ? Math.round((funnel.filtered / funnel.totalIn) * 100) : 0
  const pctMatched = funnel.totalIn > 0 ? Math.round((funnel.matched / funnel.totalIn) * 100) : 0
  const pctNew = funnel.totalIn > 0 ? Math.round((funnel.newSignal / funnel.totalIn) * 100) : 0

  return (
    <div>
      {/* Laatste run indicator */}
      {laatsteRun && (
        <div className="np-beheer-kaart" style={{ marginBottom: 20 }}>
          <div className="np-beheer-kaart-kop">
            <strong>Laatste intake: {formatDateTime(laatsteRun.started_at)}</strong>
            <span className={`np-badge${laatsteRun.status === 'error' || laatsteRun.status === 'timeout' ? ' np-badge-rood' : ' np-badge-groen'}`}>
              {laatsteRun.status ?? 'onbekend'}
            </span>
            <span className="np-bron-rest">duur {formatDuration(laatsteRun.duration_ms)}</span>
          </div>
        </div>
      )}

      {/* Trechter */}
      <div className="np-beheer-kaart">
        <p className="np-beheer-trechter-titel">Intake-trechter ({periodeLabel})</p>
        <div className="np-beheer-trechter-groot">
          <div className="np-trechter-stap">
            <span className="np-trechter-getal">{funnel.totalIn}</span>
            <span className="np-trechter-label">Binnengekomen</span>
            <span className="np-trechter-pct">100%</span>
          </div>
          <span className="np-trechter-pijl">→</span>
          <div className="np-trechter-stap np-trechter-stap-rood">
            <span className="np-trechter-getal">{funnel.filtered}</span>
            <span className="np-trechter-label">Gefilterd</span>
            <span className="np-trechter-pct">{pctFiltered}%</span>
          </div>
          <span className="np-trechter-pijl">→</span>
          <div className="np-trechter-stap np-trechter-stap-blauw">
            <span className="np-trechter-getal">{funnel.matched}</span>
            <span className="np-trechter-label">Gematcht</span>
            <span className="np-trechter-pct">{pctMatched}%</span>
          </div>
          <span className="np-trechter-pijl">→</span>
          <div className="np-trechter-stap np-trechter-stap-groen">
            <span className="np-trechter-getal">{funnel.newSignal}</span>
            <span className="np-trechter-label">Nieuw signaal</span>
            <span className="np-trechter-pct">{pctNew}%</span>
          </div>
          <span className="np-trechter-pijl">→</span>
          <div className="np-trechter-stap np-trechter-stap-accent">
            <span className="np-trechter-getal">{funnel.entitiesCreated}</span>
            <span className="np-trechter-label">Entiteiten</span>
            <span className="np-trechter-pct">&nbsp;</span>
          </div>
        </div>

        {/* Proportionele balk */}
        <div className="np-trechter-balk-wrap">
          <div className="np-trechter-balk">
            {pctFiltered > 0 && <div className="np-trechter-balk-rood" style={{ width: `${pctFiltered}%` }} />}
            {pctMatched > 0 && <div className="np-trechter-balk-blauw" style={{ width: `${pctMatched}%` }} />}
            {pctNew > 0 && <div className="np-trechter-balk-groen" style={{ width: `${pctNew}%` }} />}
          </div>
          <div className="np-trechter-legenda">
            <span><span className="np-trechter-dot" style={{ background: 'var(--np-rood)' }} /> Gefilterd</span>
            <span><span className="np-trechter-dot" style={{ background: 'var(--np-blauw)' }} /> Gematcht</span>
            <span><span className="np-trechter-dot" style={{ background: 'var(--np-groen)' }} /> Nieuw signaal</span>
          </div>
        </div>
      </div>

      {/* Twee kolommen: beslissingen + redenen */}
      <div className="np-intake-tweekolom">
        {/* Linkerkolom: beslissingen */}
        <div>
          <p className="np-telling" style={{ marginTop: 24 }}>Recente beslissingen</p>

          <div className="np-filterbalk">
            <div className="np-filtergroep">
              <span className="np-filterlabel">Beslissing</span>
              {BESLISSING_OPTIES.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`np-pil${filters.has(b) ? ` np-pil-actief np-pil-${b === 'filtered' ? 'dood' : b === 'matched' ? 'blauw' : 'ok'}` : ''}`}
                  onClick={() => toggleFilter(b)}
                >
                  {BESLISSING_LABEL[b]}
                </button>
              ))}
            </div>
            <span className="np-filter-telling">
              {gefilterdeDecisions.length} van {decisions.length}
            </span>
          </div>

          <div className="np-intake-lijst">
            {gefilterdeDecisions.slice(0, 50).map((d, i) => (
              <div key={i} className="np-intake-rij-wrap">
                <button
                  type="button"
                  className={`np-intake-rij${openRij === i ? ' np-intake-rij-open' : ''}`}
                  onClick={() => setOpenRij(openRij === i ? null : i)}
                  aria-expanded={openRij === i}
                >
                  <span className="np-intake-rij-titel">{d.itemTitle}</span>
                  <span className={`np-badge ${BESLISSING_KLEUR[d.decision] ?? ''}`}>
                    {BESLISSING_LABEL[d.decision] ?? d.decision}
                  </span>
                  <span className="np-intake-rij-bron">{d.sourceName}</span>
                  <span className="np-weging-chevron">{openRij === i ? '▾' : '▸'}</span>
                </button>
                {openRij === i && (
                  <div className="np-intake-detail">
                    {d.reason && (
                      <span><strong>Reden:</strong> {d.reason}</span>
                    )}
                    {d.signalTitle && (
                      <span><strong>Signaal:</strong> #{d.signalId} {d.signalTitle}</span>
                    )}
                    {d.entitiesFound && (
                      <span><strong>Entiteiten:</strong> {d.entitiesFound}</span>
                    )}
                    <span><strong>Tijdstip:</strong> {formatRelative(d.createdAt)}</span>
                  </div>
                )}
              </div>
            ))}
            {gefilterdeDecisions.length === 0 && (
              <p className="np-leeg" style={{ marginTop: 12 }}>Geen beslissingen bij deze filters.</p>
            )}
          </div>
        </div>

        {/* Rechterkolom: filterredenen + entiteiten */}
        <div>
          {/* Filterredenen */}
          <div className="np-beheer-kaart" style={{ marginTop: 24 }}>
            <p className="np-beheer-trechter-titel">Top filterredenen ({periodeLabel})</p>
            {filterReasons.map((r, i) => (
              <div key={i}>
                <div className="np-reden-item">
                  <span className="np-reden-naam">{r.reason}</span>
                  <span className="np-reden-aantal">{r.count}</span>
                </div>
                <div className="np-reden-balk">
                  <div
                    className="np-reden-balk-vul"
                    style={{ width: `${Math.round((r.count / maxReason) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {filterReasons.length === 0 && (
              <p className="np-bron-rest" style={{ padding: '8px 0' }}>Geen filterredenen gevonden.</p>
            )}
          </div>

          {/* Top entiteiten */}
          <div className="np-beheer-kaart" style={{ marginTop: 16 }}>
            <p className="np-beheer-trechter-titel">Top entiteiten ({periodeLabel})</p>
            {topEntities.map((e, i) => (
              <div key={i} className="np-reden-item">
                <span className="np-reden-naam">{e.name}</span>
                <span className="np-reden-aantal">{e.count}</span>
              </div>
            ))}
            {topEntities.length === 0 && (
              <p className="np-bron-rest" style={{ padding: '8px 0' }}>Geen entiteiten gevonden.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
