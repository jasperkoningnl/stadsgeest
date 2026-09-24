'use client'

import { useState } from 'react'
import { SOORT_LABEL } from './TipRegel'

/**
 * Soortfilter boven de wachtrij, als één gesegmenteerde knop met aantallen.
 * Filtert client-side door np-lijst-items te tonen/verbergen, zodat de
 * serverpagina ongewijzigd blijft. Dagkopjes zonder zichtbare tips gaan mee
 * dicht, anders blijft er een leeg "Gisteren" staan.
 */
export default function WachtrijFilters({
  soorten,
  totaal,
}: {
  soorten: { soort: string; aantal: number }[]
  totaal: number
}) {
  const [actief, setActief] = useState<string | null>(null)
  if (soorten.length <= 1) return null

  function filter(soort: string | null) {
    setActief(soort)
    const label = soort === null ? null : (SOORT_LABEL[soort] ?? soort).toLowerCase()

    document.querySelectorAll<HTMLElement>('.np-lijst-item').forEach((el) => {
      if (label === null) { el.style.display = ''; return }
      const soortEl = el.querySelector('.np-soort')
      el.style.display = soortEl?.textContent?.toLowerCase() === label ? '' : 'none'
    })

    document.querySelectorAll<HTMLElement>('.np-daggroep').forEach((groep) => {
      const zichtbaar = [...groep.querySelectorAll<HTMLElement>('.np-lijst-item')]
        .filter((el) => el.style.display !== 'none').length
      groep.style.display = zichtbaar > 0 ? '' : 'none'
      // Het getal in het dagkopje telt mee met het filter.
      const tel = groep.querySelector<HTMLElement>('.np-daggroep-tel')
      if (tel) tel.textContent = String(zichtbaar)
    })
  }

  const knoppen = [
    { soort: null as string | null, label: 'Alles', aantal: totaal },
    ...soorten.map((s) => ({ soort: s.soort as string | null, label: SOORT_LABEL[s.soort] ?? s.soort, aantal: s.aantal })),
  ]

  return (
    <div className="np-segment" role="group" aria-label="Filter op soort">
      {knoppen.map((k) => (
        <button
          key={k.soort ?? 'alles'}
          type="button"
          className={`np-segment-knop${actief === k.soort ? ' np-segment-knop-actief' : ''}`}
          aria-pressed={actief === k.soort}
          onClick={() => filter(k.soort)}
        >
          {k.label}
          <span className="np-segment-tel">{k.aantal}</span>
        </button>
      ))}
    </div>
  )
}
