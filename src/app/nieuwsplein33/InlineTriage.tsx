'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { noteerBeslissing } from './feedbackTeller'

type Actie = 'goedgekeurd' | 'geparkeerd' | 'afgekeurd'

const REDENEN: Record<Actie, { code: string; label: string }[]> = {
  goedgekeurd: [
    { code: 'zelf_niet_gevonden', label: 'Zelf niet gevonden' },
    { code: 'concreet_gemaakt', label: 'Maakt het concreet' },
    { code: 'stond_al_op_lijst', label: 'Stond al op mijn lijstje' },
    { code: 'goede_invalshoek', label: 'Nieuwe invalshoek' },
  ],
  geparkeerd: [
    { code: 'te_vroeg', label: 'Te vroeg' },
    { code: 'geen_tijd', label: 'Nu geen capaciteit' },
    { code: 'wacht_op_meer', label: 'Wacht op meer' },
  ],
  afgekeurd: [
    { code: 'onduidelijk', label: 'Onduidelijk' },
    { code: 'oud_nieuws', label: 'Oud nieuws' },
    { code: 'al_bekend', label: 'Al bekend' },
    { code: 'geen_nieuwswaarde', label: 'Geen nieuwswaarde' },
    { code: 'buiten_gebied', label: 'Buiten gebied' },
    { code: 'te_dun', label: 'Te dun' },
  ],
}

/**
 * Compacte triage-knoppen onder een tipkaart in de wachtrij. Laat de
 * redacteur direct beslissen zonder de detailpagina te openen. Bij klik
 * opent een redenkeuzepaneel; na bevestiging wordt de actie verstuurd.
 */
export default function InlineTriage({ tipId }: { tipId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState<Actie | null>(null)
  const [code, setCode] = useState('')
  const [bezig, startTransition] = useTransition()
  const [fout, setFout] = useState<string | null>(null)

  async function verstuur(actie: Actie) {
    setFout(null)
    const res = await fetch(`/api/tip/${tipId}/beslis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actie, reden_code: code || null, reden_tekst: null }),
    })
    if (!res.ok) {
      setFout('Niet gelukt — probeer het opnieuw.')
      return
    }
    setOpen(null); setCode('')
    noteerBeslissing()
    startTransition(() => router.refresh())
  }

  // Voorkom dat een klik op de triage-knoppen de Link van de tipkaart activeert.
  function stop(e: React.MouseEvent) { e.preventDefault(); e.stopPropagation() }

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div onClick={stop}>
      <div className="np-regel-triage">
        <button type="button" className="np-knop-inline np-knop-inline-ja" disabled={bezig}
          onClick={() => { setOpen(open === 'goedgekeurd' ? null : 'goedgekeurd'); setCode('') }}>
          Oppakken
        </button>
        <button type="button" className="np-knop-inline np-knop-inline-later" disabled={bezig}
          onClick={() => { setOpen(open === 'geparkeerd' ? null : 'geparkeerd'); setCode('') }}>
          Parkeren
        </button>
        <button type="button" className="np-knop-inline np-knop-inline-nee" disabled={bezig}
          onClick={() => { setOpen(open === 'afgekeurd' ? null : 'afgekeurd'); setCode('') }}>
          Afwijzen
        </button>
        <Link href={`/nieuwsplein33/tip/${tipId}`} className="np-regel-link-open"
          onClick={(e) => e.stopPropagation()}>
          Open de tip →
        </Link>
      </div>

      {open && (
        <div className="np-reden" style={{ marginTop: 8 }}>
          <div className="np-reden-keuzes">
            {REDENEN[open].map((r) => (
              <button key={r.code} type="button"
                className={`np-reden-keuze${code === r.code ? ' np-reden-keuze-aan' : ''}`}
                onClick={() => setCode(r.code)}>
                {r.label}
              </button>
            ))}
          </div>
          {fout && <p className="np-fout" style={{ marginTop: 6 }}>{fout}</p>}
          <div className="np-reden-bevestig" style={{ marginTop: 8 }}>
            <button type="button" className="np-knop-inline np-knop-inline-ja" disabled={bezig}
              onClick={() => verstuur(open)}>
              {bezig ? 'Bezig…' : 'Vastleggen'}
            </button>
            <button type="button" className="np-knop-inline" onClick={() => setOpen(null)}>
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
