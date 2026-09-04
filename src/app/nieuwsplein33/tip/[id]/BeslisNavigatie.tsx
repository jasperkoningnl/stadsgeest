'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Actie = 'goedgekeurd' | 'geparkeerd' | 'afgekeurd' | 'wachtrij'

/**
 * Sticky beslisbalk bovenaan de detailpagina. Toont:
 * - ← link terug naar de wachtrij
 * - positie in de wachtrij ("tip X van Y") met ↑/↓-knoppen
 * - beslisknoppen (oppakken / parkeren / afwijzen / terugzetten)
 *
 * Navigatie met j/k door de wachtrij; de ids komen van de server.
 */
export default function BeslisNavigatie({
  tipId,
  status,
  wachtrijIds,
}: {
  tipId: number
  status: string
  wachtrijIds: number[]
}) {
  const router = useRouter()
  const idx = wachtrijIds.indexOf(tipId)
  const positie = idx >= 0 ? idx + 1 : null
  const totaal = wachtrijIds.length
  const vorigeId = idx > 0 ? wachtrijIds[idx - 1] : null
  const volgendeId = idx >= 0 && idx < wachtrijIds.length - 1 ? wachtrijIds[idx + 1] : null

  const gaVerder = useCallback((id: number) => {
    router.push(`/nieuwsplein33/tip/${id}`)
  }, [router])

  // Sneltoetsen: j = volgende tip, k = vorige tip
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'j' && volgendeId !== null) {
        e.preventDefault(); gaVerder(volgendeId)
      } else if (e.key === 'k' && vorigeId !== null) {
        e.preventDefault(); gaVerder(vorigeId)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [vorigeId, volgendeId, gaVerder])

  async function verstuur(actie: Actie) {
    const res = await fetch(`/api/tip/${tipId}/beslis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actie, reden_code: null, reden_tekst: null }),
    })
    if (!res.ok) return
    // Na een beslissing: ga naar de volgende tip of terug naar de wachtrij.
    if (volgendeId !== null) gaVerder(volgendeId)
    else router.push('/nieuwsplein33')
  }

  const isInWachtrij = status === 'wachtrij' || status === 'geparkeerd'

  return (
    <div className="np-beslisbalk">
      <div className="np-beslisbalk-rij">
        <Link href="/nieuwsplein33" className="np-terug" style={{ marginRight: 8 }}>← wachtrij</Link>

        {positie !== null && (
          <>
            <span className="np-beslisbalk-positie">tip {positie} van {totaal}</span>
            <button type="button" className="np-beslisbalk-nav" disabled={vorigeId === null}
              onClick={() => vorigeId !== null && gaVerder(vorigeId)} title="Vorige tip (k)">
              ↑
            </button>
            <button type="button" className="np-beslisbalk-nav" disabled={volgendeId === null}
              onClick={() => volgendeId !== null && gaVerder(volgendeId)} title="Volgende tip (j)">
              ↓
            </button>
          </>
        )}

        {isInWachtrij && (
          <div className="np-beslisbalk-acties">
            <button type="button" className="np-knop-klein np-knop-klein-ja"
              onClick={() => verstuur('goedgekeurd')}>Oppakken</button>
            <button type="button" className="np-knop-klein np-knop-klein-later"
              onClick={() => verstuur('geparkeerd')}>Parkeren</button>
            <button type="button" className="np-knop-klein np-knop-klein-nee"
              onClick={() => verstuur('afgekeurd')}>Afwijzen</button>
          </div>
        )}

        {!isInWachtrij && status !== 'gepubliceerd' && (
          <div className="np-beslisbalk-acties">
            <button type="button" className="np-knop-klein"
              onClick={() => verstuur('wachtrij')}>Terugzetten</button>
          </div>
        )}
      </div>
    </div>
  )
}
