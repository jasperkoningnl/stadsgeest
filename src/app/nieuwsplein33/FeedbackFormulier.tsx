'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Feedback over het dashboard zélf. Staat op de logboekpagina en in de balk die
 * na een paar afgehandelde tips verschijnt; het is één component, zodat er niet
 * twee formulieren uiteen kunnen gaan lopen.
 *
 * De soorten volgen dezelfde gedachte als de redenen bij een tip: kort, zonder
 * typen te kiezen, en over maanden nog dezelfde betekenis. Ze zijn optioneel —
 * wie meteen begint te typen hoeft er niet langs.
 */

const SOORTEN: { code: string; label: string }[] = [
  { code: 'onduidelijk', label: 'Iets is onduidelijk' },
  { code: 'ontbreekt', label: 'Er ontbreekt iets' },
  { code: 'werkt_niet', label: 'Er werkt iets niet' },
  { code: 'werkt_goed', label: 'Dit werkt juist goed' },
  { code: 'anders', label: 'Iets anders' },
]

export default function FeedbackFormulier({
  aanleiding,
  onKlaar,
  rijen = 4,
}: {
  aanleiding: 'logboek' | 'balk'
  onKlaar?: () => void
  rijen?: number
}) {
  const pathname = usePathname()
  const [soort, setSoort] = useState('')
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const [klaar, setKlaar] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  async function verstuur() {
    if (!tekst.trim()) { setFout('Schrijf eerst iets op.'); return }
    setFout(null)
    setBezig(true)
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soort: soort || null, tekst, pagina: pathname, aanleiding }),
    }).catch(() => null)
    setBezig(false)

    if (!res || !res.ok) {
      setFout('Versturen is niet gelukt. Probeer het nog eens; er is niets verloren gegaan.')
      return
    }
    setKlaar(true)
    setSoort(''); setTekst('')
    onKlaar?.()
  }

  if (klaar) {
    return (
      <p className="np-fb-dank">
        Genoteerd, dank je. Wat ermee gebeurt komt in dit logboek te staan.
        {' '}
        <button type="button" className="np-fb-nogeens" onClick={() => setKlaar(false)}>
          Nog iets kwijt?
        </button>
      </p>
    )
  }

  return (
    <div className="np-fb-formulier">
      <div className="np-reden-keuzes">
        {SOORTEN.map((s) => (
          <button
            key={s.code}
            type="button"
            className={`np-reden-keuze${soort === s.code ? ' np-reden-keuze-aan' : ''}`}
            onClick={() => setSoort(soort === s.code ? '' : s.code)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <textarea
        className="np-reden-tekst"
        placeholder="Wat wil je kwijt? Hoe concreter, hoe makkelijker er iets aan te doen is."
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        rows={rijen}
      />

      {fout && <p className="np-fout">{fout}</p>}

      <button type="button" className="np-knop np-knop-ja" disabled={bezig} onClick={verstuur}>
        {bezig ? 'Bezig…' : 'Versturen'}
      </button>
    </div>
  )
}
