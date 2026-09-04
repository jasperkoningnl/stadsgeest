'use client'

import { SOORT_LABEL } from './TipRegel'

/**
 * Filterbalk boven de wachtrij: pillen per soort.
 * Filtert client-side door np-lijst-items te tonen/verbergen op basis van
 * een data-attribuut, zodat de serverpagina ongewijzigd blijft.
 */
export default function WachtrijFilters({ soorten, totaal }: { soorten: string[]; totaal: number }) {
  if (soorten.length <= 1) return null

  function filter(soort: string | null) {
    const items = document.querySelectorAll<HTMLElement>('.np-lijst-item')
    const pillen = document.querySelectorAll<HTMLElement>('.np-wachtrij-filter-pil')

    pillen.forEach((p) => {
      const actief = soort === null ? p.dataset.soort === undefined : p.dataset.soort === soort
      p.classList.toggle('np-pil-actief', actief)
    })

    items.forEach((el) => {
      if (soort === null) { el.style.display = ''; return }
      const soortEl = el.querySelector('.np-soort')
      const match = soortEl?.textContent?.toLowerCase() === (SOORT_LABEL[soort] ?? soort).toLowerCase()
      el.style.display = match ? '' : 'none'
    })
  }

  return (
    <div className="np-wachtrij-filters">
      <button type="button" className="np-pil np-pil-actief np-wachtrij-filter-pil"
        onClick={() => filter(null)}>
        Alles ({totaal})
      </button>
      {soorten.map((s) => (
        <button key={s} type="button" className="np-pil np-wachtrij-filter-pil"
          data-soort={s} onClick={() => filter(s)}>
          {SOORT_LABEL[s] ?? s}
        </button>
      ))}
    </div>
  )
}
