'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Wrapper die sneltoetsen voor de wachtrij registreert:
 *   j / k  — volgende / vorige tipkaart selecteren
 *   a      — oppakken (goedgekeurd)
 *   p      — parkeren (geparkeerd)
 *   x      — afwijzen (afgekeurd)
 *   Enter  — open de geselecteerde tip
 *
 * De actieve kaart krijgt de klasse `np-regel-actief` zodat de CSS-outline
 * verschijnt. De sneltoetsen werken alleen als er geen textarea of input
 * focus heeft.
 */
export default function WachtrijSneltoetsen({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const indexRef = useRef(-1)

  const getKaarten = useCallback(() => {
    if (!ref.current) return []
    return Array.from(ref.current.querySelectorAll<HTMLElement>('.np-regel'))
  }, [])

  const markeer = useCallback((idx: number) => {
    const kaarten = getKaarten()
    kaarten.forEach((k, i) => k.classList.toggle('np-regel-actief', i === idx))
    if (kaarten[idx]) kaarten[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    indexRef.current = idx
  }, [getKaarten])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Niet ingrijpen als de gebruiker in een invoerveld typt.
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      // Niet ingrijpen bij modifier-toetsen (ctrl+j is iets anders).
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const kaarten = getKaarten()
      if (kaarten.length === 0) return

      switch (e.key) {
        case 'j': {
          e.preventDefault()
          const next = Math.min(indexRef.current + 1, kaarten.length - 1)
          markeer(next)
          break
        }
        case 'k': {
          e.preventDefault()
          const prev = Math.max(indexRef.current - 1, 0)
          markeer(prev)
          break
        }
        case 'Enter': {
          e.preventDefault()
          const actief = kaarten[indexRef.current]
          if (actief) {
            const href = actief.getAttribute('href')
            if (href) router.push(href)
          }
          break
        }
        case 'a':
        case 'p':
        case 'x': {
          e.preventDefault()
          const actief = kaarten[indexRef.current]
          if (!actief) break
          // Zoek de bijbehorende inline-triage-knop in de kaart.
          const klasseMap: Record<string, string> = {
            a: 'np-knop-inline-ja',
            p: 'np-knop-inline-later',
            x: 'np-knop-inline-nee',
          }
          // De knoppen zitten in een sibling-div (InlineTriage) die na de Link
          // staat, maar wel binnen dezelfde wrapper. We zoeken in het
          // parentElement van de kaart.
          const wrapper = actief.closest('.np-lijst-item') ?? actief.parentElement
          if (!wrapper) break
          const knop = wrapper.querySelector<HTMLButtonElement>(`.${klasseMap[e.key]}`)
          if (knop) knop.click()
          break
        }
        default:
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [getKaarten, markeer, router])

  return <div ref={ref}>{children}</div>
}
