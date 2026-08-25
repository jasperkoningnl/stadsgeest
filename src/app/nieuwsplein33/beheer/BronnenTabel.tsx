'use client'

import { useMemo, useState } from 'react'
import type { SourcesOverview } from '@/lib/dashboard/beheerQueries'
import { formatRelative } from '@/lib/dashboard/format'

const HEALTH_LABEL: Record<string, string> = {
  ok: 'gezond', verdacht: 'verdacht', dood: 'dood', uitgeschakeld: 'uitgeschakeld',
}
const HEALTH_OPTIES = ['ok', 'verdacht', 'dood', 'uitgeschakeld'] as const
const TIER_OPTIES = [1, 2, 3] as const

type SorteerVeld = 'naam' | 'tier' | 'laatsteItem' | 'items7d' | 'items30d' | 'itemsTotaal'

const KOLOMMEN: { veld: SorteerVeld; label: string }[] = [
  { veld: 'naam', label: 'Bron' },
  { veld: 'tier', label: 'Tier' },
  { veld: 'laatsteItem', label: 'Laatste item' },
  { veld: 'items7d', label: '7d' },
  { veld: 'items30d', label: '30d' },
  { veld: 'itemsTotaal', label: 'Totaal' },
]

function metToggle<T>(set: Set<T>, waarde: T): Set<T> {
  const next = new Set(set)
  if (next.has(waarde)) next.delete(waarde)
  else next.add(waarde)
  return next
}

export default function BronnenTabel({ overzicht }: { overzicht: SourcesOverview }) {
  // Leeg = geen filter, dus alles zichtbaar. Zodra er iets is aangeklikt, wordt
  // dat een insluitfilter: alleen bronnen die aan een van de aangevinkte pillen
  // voldoen blijven over. Zo kun je pillen uit verschillende groepen combineren
  // (bijv. "verdacht" + "tier 1") zonder dat je eerst alles hoeft uit te zetten.
  const [tiers, setTiers] = useState<Set<number>>(new Set())
  const [healths, setHealths] = useState<Set<string>>(new Set())
  const [sorteerVeld, setSorteerVeld] = useState<SorteerVeld>('tier')
  const [oplopend, setOplopend] = useState(true)

  function sorteerOp(veld: SorteerVeld) {
    if (veld === sorteerVeld) setOplopend((o) => !o)
    else {
      setSorteerVeld(veld)
      setOplopend(true)
    }
  }

  const rijen = useMemo(() => {
    let r = overzicht.rows
    if (tiers.size > 0) r = r.filter((s) => s.tier !== null && tiers.has(s.tier))
    if (overzicht.healthTracked && healths.size > 0) {
      r = r.filter((s) => s.health !== null && healths.has(s.health))
    }
    const factor = oplopend ? 1 : -1
    return [...r].sort((a, b) => {
      switch (sorteerVeld) {
        case 'naam': return factor * a.name.localeCompare(b.name)
        case 'tier': return factor * ((a.tier ?? 99) - (b.tier ?? 99))
        case 'laatsteItem': return factor * (a.lastItemAt ?? '').localeCompare(b.lastItemAt ?? '')
        case 'items7d': return factor * (a.items7d - b.items7d)
        case 'items30d': return factor * (a.items30d - b.items30d)
        case 'itemsTotaal': return factor * (a.itemsTotal - b.itemsTotal)
        default: return 0
      }
    })
  }, [overzicht, tiers, healths, sorteerVeld, oplopend])

  return (
    <div>
      <div className="np-filterbalk">
        <div className="np-filtergroep">
          <span className="np-filterlabel">Tier</span>
          {TIER_OPTIES.map((t) => (
            <button
              key={t}
              type="button"
              className={`np-pil${tiers.has(t) ? ' np-pil-actief' : ''}`}
              onClick={() => setTiers((prev) => metToggle(prev, t))}
            >
              Tier {t}
            </button>
          ))}
        </div>

        {overzicht.healthTracked && (
          <div className="np-filtergroep">
            <span className="np-filterlabel">Gezondheid</span>
            {HEALTH_OPTIES.map((h) => (
              <button
                key={h}
                type="button"
                className={`np-pil np-pil-${h}${healths.has(h) ? ' np-pil-actief' : ''}`}
                onClick={() => setHealths((prev) => metToggle(prev, h))}
              >
                {HEALTH_LABEL[h]}
              </button>
            ))}
          </div>
        )}

        <span className="np-filter-telling">{rijen.length} van {overzicht.rows.length}</span>
      </div>

      <div className="np-beheer-tabel-wrap">
        <table className="np-tabel">
          <thead>
            <tr>
              {KOLOMMEN.map((k) => (
                <th key={k.veld}>
                  <button type="button" className="np-th-knop" onClick={() => sorteerOp(k.veld)}>
                    {k.label}
                    {sorteerVeld === k.veld && <span className="np-th-pijl">{oplopend ? ' ▲' : ' ▼'}</span>}
                  </button>
                </th>
              ))}
              <th>Actief</th>
              {overzicht.healthTracked && <th>Gezondheid</th>}
            </tr>
          </thead>
          <tbody>
            {rijen.map((s) => (
              <tr key={s.id} className={s.isActive ? undefined : 'np-beheer-rij-inactief'}>
                <td>{s.name}</td>
                <td>{s.tier ? <span className="np-tier">tier {s.tier}</span> : '—'}</td>
                <td className="np-bron-rest">{formatRelative(s.lastItemAt)}</td>
                <td>{s.items7d}</td>
                <td>{s.items30d}</td>
                <td className="np-bron-rest">{s.itemsTotal}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
        {rijen.length === 0 && <p className="np-leeg" style={{ marginTop: 12 }}>Geen bronnen bij deze filters.</p>}
      </div>
    </div>
  )
}
