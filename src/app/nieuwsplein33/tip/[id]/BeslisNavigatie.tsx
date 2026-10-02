'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { noteerBeslissing } from '../../feedbackTeller'
import { OPEN_REDEN_GEBEURTENIS } from './TipActies'

type Actie = 'goedgekeurd' | 'geparkeerd' | 'wachtrij'

/**
 * Sticky beslisbalk bovenaan de detailpagina. Toont:
 * - ← link terug naar de wachtrij
 * - positie in de wachtrij ("tip X van Y") met ↑/↓-knoppen
 * - beslisknoppen (oppakken / parkeren / afwijzen / terugzetten)
 *
 * Oppakken, parkeren en terugzetten worden hier direct vastgelegd en brengen
 * je naar de volgende tip. Afwijzen vraagt altijd een reden (de leerloop
 * telt die) en opent daarom het redenpaneel onder de kop, hetzelfde paneel
 * als bij de grote knoppen.
 *
 * Tot 2 oktober 2026 stuurde deze balk geen request_id mee; de beslisroute
 * weigerde dat met 400 en de balk slikte die fout in. Oppakken, Parkeren en
 * Afwijzen leken te werken maar sloegen niets op.
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
  // Eén request_id per poging: een herhaalde klik na een netwerkfout is dan
  // dezelfde beslissing en geen tweede feedbackrij.
  const requestId = useRef<string | null>(null)

  const idx = wachtrijIds.indexOf(tipId)
  const positie = idx >= 0 ? idx + 1 : null
  const totaal = wachtrijIds.length
  const vorigeId = idx > 0 ? wachtrijIds[idx - 1] : null
  const volgendeId = idx >= 0 && idx < wachtrijIds.length - 1 ? wachtrijIds[idx + 1] : null

  function gaVerder(id: number) {
    router.push(`/nieuwsplein33/tip/${id}`)
  }

  async function verstuur(actie: Actie) {
    setFout(null)
    setBezig(true)
    requestId.current ??= crypto.randomUUID()
    try {
      const res = await fetch(`/api/tip/${tipId}/beslis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie, reden_code: null, reden_tekst: null, request_id: requestId.current }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setFout(body.fout ?? 'Opslaan is niet gelukt. Probeer het opnieuw; er is niets gewijzigd.')
        return
      }
      requestId.current = null
      // Terugzetten is een correctie, geen afgeronde beoordeling (zie TipActies).
      if (actie !== 'wachtrij') noteerBeslissing()
      // Na een beslissing: door naar de volgende tip, of terug naar de wachtrij.
      if (actie !== 'wachtrij' && volgendeId !== null) gaVerder(volgendeId)
      else if (actie !== 'wachtrij') router.push('/nieuwsplein33')
      else router.refresh()
    } catch {
      setFout('Geen verbinding. Probeer het opnieuw; er is niets gewijzigd.')
    } finally {
      setBezig(false)
    }
  }

  function openAfwijzen() {
    setFout(null)
    window.dispatchEvent(new CustomEvent(OPEN_REDEN_GEBEURTENIS, { detail: 'afgekeurd' }))
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
              onClick={() => vorigeId !== null && gaVerder(vorigeId)} title="Vorige tip">
              ↑
            </button>
            <button type="button" className="np-beslisbalk-nav" disabled={volgendeId === null}
              onClick={() => volgendeId !== null && gaVerder(volgendeId)} title="Volgende tip">
              ↓
            </button>
          </>
        )}

        {isInWachtrij && (
          <div className="np-beslisbalk-acties">
            <button type="button" className="np-knop-klein np-knop-klein-ja" disabled={bezig}
              onClick={() => verstuur('goedgekeurd')} title="Hier wil ik iets mee; je gaat door naar de volgende tip">
              {bezig ? 'Bezig…' : 'Oppakken'}
            </button>
            {status !== 'geparkeerd' && (
              <button type="button" className="np-knop-klein np-knop-klein-later" disabled={bezig}
                onClick={() => verstuur('geparkeerd')} title="Bewaar voor later; je gaat door naar de volgende tip">
                Parkeren
              </button>
            )}
            <button type="button" className="np-knop-klein np-knop-klein-nee" disabled={bezig}
              onClick={openAfwijzen} title="Niets mee doen; kies hieronder waarom">
              Afwijzen
            </button>
          </div>
        )}

        {!isInWachtrij && status !== 'gepubliceerd' && (
          <div className="np-beslisbalk-acties">
            <button type="button" className="np-knop-klein" disabled={bezig}
              onClick={() => verstuur('wachtrij')} title="De tip komt terug in de wachtrij; de eerdere beslissing blijft in de geschiedenis staan">
              {bezig ? 'Bezig…' : 'Terugzetten'}
            </button>
          </div>
        )}
      </div>
      {fout && <p className="np-fout np-beslisbalk-fout" role="alert">{fout}</p>}
    </div>
  )
}
