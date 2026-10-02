'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { OPEN_REDEN_GEBEURTENIS, GESLOTEN_GEBEURTENIS, type BeslisActie } from './TipActies'

/**
 * Sticky beslisbalk bovenaan de detailpagina. Toont:
 * - ← link terug naar de wachtrij
 * - positie in de wachtrij ("tip X van Y") met ↑/↓-knoppen
 * - beslisknoppen (oppakken / parkeren / afwijzen), of terugzetten
 *
 * De drie beslisknoppen openen het redenpaneel direct onder de balk
 * (TipActies); dat paneel legt vast en gaat door naar de volgende tip. Zo is
 * er één beslisflow en vraagt afwijzen altijd een reden. Terugzetten gaat
 * direct, zonder reden.
 *
 * Toetsen (niet in een tekstveld): 1, 2, 3 kiezen de actie; ↓ of j en ↑ of k
 * bladeren; Esc sluit het paneel.
 *
 * Tot 2 oktober 2026 stuurde deze balk geen request_id mee; de beslisroute
 * weigerde dat met 400 en de balk slikte die fout in.
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
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [open, setOpen] = useState<BeslisActie | null>(null)
  const requestId = useRef<string | null>(null)

  const idx = wachtrijIds.indexOf(tipId)
  const positie = idx >= 0 ? idx + 1 : null
  const totaal = wachtrijIds.length
  const vorigeId = idx > 0 ? wachtrijIds[idx - 1] : null
  const volgendeId = idx >= 0 && idx < wachtrijIds.length - 1 ? wachtrijIds[idx + 1] : null
  const isInWachtrij = status === 'wachtrij' || status === 'geparkeerd'

  function gaVerder(id: number) {
    router.push(`/nieuwsplein33/tip/${id}`)
  }

  function kies(actie: BeslisActie) {
    setFout(null)
    setOpen(actie)
    window.dispatchEvent(new CustomEvent(OPEN_REDEN_GEBEURTENIS, { detail: actie }))
  }

  function sluit() {
    window.dispatchEvent(new CustomEvent(OPEN_REDEN_GEBEURTENIS, { detail: null }))
  }

  // Het paneel meldt terug wanneer het dichtgaat (annuleren, vastgelegd, Esc).
  useEffect(() => {
    const gesloten = () => setOpen(null)
    window.addEventListener(GESLOTEN_GEBEURTENIS, gesloten)
    return () => window.removeEventListener(GESLOTEN_GEBEURTENIS, gesloten)
  }, [])

  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const doel = e.target as HTMLElement | null
      if (doel && (doel.tagName === 'INPUT' || doel.tagName === 'TEXTAREA' || doel.tagName === 'SELECT' || doel.isContentEditable)) return
      if (e.key === 'Escape') { sluit(); return }
      if ((e.key === 'ArrowDown' || e.key === 'j') && volgendeId !== null) { e.preventDefault(); gaVerder(volgendeId); return }
      if ((e.key === 'ArrowUp' || e.key === 'k') && vorigeId !== null) { e.preventDefault(); gaVerder(vorigeId); return }
      if (!isInWachtrij) return
      if (e.key === '1') kies('goedgekeurd')
      else if (e.key === '2' && status !== 'geparkeerd') kies('geparkeerd')
      else if (e.key === '3') kies('afgekeurd')
    }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volgendeId, vorigeId, isInWachtrij, status])

  async function terugzetten() {
    setFout(null)
    setBezig(true)
    requestId.current ??= crypto.randomUUID()
    try {
      const res = await fetch(`/api/tip/${tipId}/beslis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie: 'wachtrij', reden_code: null, reden_tekst: null, request_id: requestId.current }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setFout(body.fout ?? 'Opslaan is niet gelukt. Probeer het opnieuw; er is niets gewijzigd.')
        return
      }
      requestId.current = null
      router.refresh()
    } catch {
      setFout('Geen verbinding. Probeer het opnieuw; er is niets gewijzigd.')
    } finally {
      setBezig(false)
    }
  }

  const knop = (actie: BeslisActie, klasse: string, label: string, titel: string) => (
    <button type="button" className={`np-knop-klein ${klasse}${open === actie ? ' np-knop-open' : ''}`}
      aria-pressed={open === actie} onClick={() => (open === actie ? sluit() : kies(actie))} title={titel}>
      {label}
    </button>
  )

  return (
    <div className="np-beslisbalk">
      <div className="np-beslisbalk-rij">
        <Link href="/nieuwsplein33" className="np-terug" style={{ marginRight: 8 }}>← wachtrij</Link>

        {positie !== null && (
          <>
            <span className="np-beslisbalk-positie">tip {positie} van {totaal}</span>
            <button type="button" className="np-beslisbalk-nav" disabled={vorigeId === null}
              onClick={() => vorigeId !== null && gaVerder(vorigeId)} title="Vorige tip (↑ of k)">
              ↑
            </button>
            <button type="button" className="np-beslisbalk-nav" disabled={volgendeId === null}
              onClick={() => volgendeId !== null && gaVerder(volgendeId)} title="Volgende tip (↓ of j)">
              ↓
            </button>
          </>
        )}

        {isInWachtrij && (
          <div className="np-beslisbalk-acties">
            {knop('goedgekeurd', 'np-knop-klein-ja', 'Oppakken', 'Hier wil ik iets mee (toets 1)')}
            {status !== 'geparkeerd' && knop('geparkeerd', 'np-knop-klein-later', 'Parkeren', 'Bewaar voor later (toets 2)')}
            {knop('afgekeurd', 'np-knop-klein-nee', 'Afwijzen', 'Niets mee doen, met reden (toets 3)')}
            {status === 'geparkeerd' && (
              <button type="button" className="np-knop-klein" disabled={bezig} onClick={terugzetten}
                title="De tip komt terug in de wachtrij; de eerdere beslissing blijft in de geschiedenis staan">
                {bezig ? 'Bezig…' : 'Terugzetten'}
              </button>
            )}
          </div>
        )}

        {!isInWachtrij && status !== 'gepubliceerd' && (
          <div className="np-beslisbalk-acties">
            <button type="button" className="np-knop-klein" disabled={bezig} onClick={terugzetten}
              title="De tip komt terug in de wachtrij; de eerdere beslissing blijft in de geschiedenis staan">
              {bezig ? 'Bezig…' : 'Terugzetten'}
            </button>
          </div>
        )}
      </div>
      {fout && <p className="np-fout np-beslisbalk-fout" role="alert">{fout}</p>}
    </div>
  )
}
