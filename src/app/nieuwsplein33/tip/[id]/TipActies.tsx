'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { noteerBeslissing } from '../../feedbackTeller'

export type BeslisActie = 'goedgekeurd' | 'geparkeerd' | 'afgekeurd'
type Actie = BeslisActie | 'wachtrij'

// Eén beslisflow (sinds 3 oktober 2026): de vaste balk bovenaan
// (BeslisNavigatie) kiest de actie en opent via deze gebeurtenis het
// redenpaneel hieronder; het paneel legt vast. Zo is er één plek waar redenen
// worden gekozen, en kan afwijzen nooit zonder reden. detail = de actie, of
// null om het paneel te sluiten. Het paneel meldt zelf terug wanneer het
// dichtgaat (GESLOTEN_GEBEURTENIS), zodat de balk zijn knop kan ontmarkeren.
export const OPEN_REDEN_GEBEURTENIS = 'np-open-reden'
export const GESLOTEN_GEBEURTENIS = 'np-reden-gesloten'

// De redenen zijn bewust kort en uitputtend genoeg om zonder typen te kunnen
// afhandelen. Ze worden geteld bij het bijstellen van de selectie, dus ze
// moeten over maanden nog dezelfde betekenis hebben.
// Terugzetten ('wachtrij') vraagt geen reden — de eerdere beslissing met reden
// blijft in de geschiedenis staan.
const REDENEN: Record<BeslisActie, { code: string; label: string }[]> = {
  goedgekeurd: [
    { code: 'zelf_niet_gevonden', label: 'Dit had ik zelf niet gevonden' },
    { code: 'concreet_gemaakt', label: 'Wist er iets van, dit maakt het concreet' },
    { code: 'stond_al_op_lijst', label: 'Stond al op mijn lijstje' },
    { code: 'goede_invalshoek', label: 'Bekend onderwerp, nieuwe invalshoek' },
  ],
  geparkeerd: [
    { code: 'te_vroeg', label: 'Te vroeg, besluitvorming moet nog komen' },
    { code: 'geen_tijd', label: 'Interessant, nu geen capaciteit' },
    { code: 'wacht_op_meer', label: 'Wacht op meer materiaal' },
  ],
  afgekeurd: [
    { code: 'onduidelijk', label: 'Onduidelijk wat het verhaal is' },
    { code: 'oud_nieuws', label: 'Oud nieuws' },
    { code: 'al_bekend', label: 'Al bekend of al gepubliceerd' },
    { code: 'geen_nieuwswaarde', label: 'Geen nieuwswaarde' },
    { code: 'buiten_gebied', label: 'Valt buiten Amersfoort en Leusden' },
    { code: 'te_dun', label: 'Te dun onderbouwd' },
    { code: 'duplicaat', label: 'Dubbele tip' },
    { code: 'verkeerd_geclusterd', label: 'Verkeerd geclusterd' },
    { code: 'feitelijk_fout', label: 'Fout in de tip' },
    { code: 'bron_fout', label: 'Fout in de bron' },
  ],
}

export const ACTIE_LABEL: Record<BeslisActie, string> = {
  goedgekeurd: 'Hier wil ik iets mee',
  geparkeerd: 'Bewaar voor later',
  afgekeurd: 'Niets mee doen',
}

const VRAAG: Record<BeslisActie, string> = {
  goedgekeurd: 'Waarom wil je hier iets mee? Dat helpt om de selectie scherper te krijgen.',
  geparkeerd: 'Waarom nu niet?',
  afgekeurd: 'Waarom niet? Hoe specifieker, hoe beter de volgende selectie wordt.',
}

export function isBeslisActie(x: unknown): x is BeslisActie {
  return x === 'goedgekeurd' || x === 'geparkeerd' || x === 'afgekeurd'
}

/**
 * Het redenpaneel onder de beslisbalk. Open staat het alleen nadat de balk
 * (of een toets) een actie heeft gekozen. Na "Vastleggen" ga je door naar de
 * volgende tip in de wachtrij, of terug naar de wachtrij als dit de laatste
 * was. Bij een afgehandelde tip toont dit alleen een korte strook.
 */
export default function TipActies({ tipId, status, volgendeId }: { tipId: number; status: string; volgendeId: number | null }) {
  const router = useRouter()
  const [open, setOpen] = useState<BeslisActie | null>(null)
  const [code, setCode] = useState('')
  const [tekst, setTekst] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, startTransition] = useTransition()
  const [verzenden, setVerzenden] = useState(false)
  const requestId = useRef<string | null>(null)
  const paneel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function openVanuitBalk(e: Event) {
      const actie = (e as CustomEvent<string | null>).detail
      if (actie === null) { sluit(); return }
      if (!isBeslisActie(actie)) return
      setOpen(actie); setCode(''); setTekst(''); setFout(null)
      // Na de render staat het paneel er; dan pas scrollen en focus.
      requestAnimationFrame(() => {
        paneel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        paneel.current?.querySelector<HTMLButtonElement>('.np-reden-keuze')?.focus()
      })
    }
    window.addEventListener(OPEN_REDEN_GEBEURTENIS, openVanuitBalk)
    return () => window.removeEventListener(OPEN_REDEN_GEBEURTENIS, openVanuitBalk)
  }, [])

  function sluit() {
    setOpen(null); setCode(''); setTekst(''); setFout(null)
    window.dispatchEvent(new Event(GESLOTEN_GEBEURTENIS))
  }

  async function verstuur(actie: Actie) {
    setFout(null)
    if (actie === 'afgekeurd' && !code) {
      setFout('Kies eerst waarom de tip niet bruikbaar is.')
      return
    }
    requestId.current ??= crypto.randomUUID()
    setVerzenden(true)
    try {
      const res = await fetch(`/api/tip/${tipId}/beslis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie, reden_code: code || null, reden_tekst: tekst || null, request_id: requestId.current }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setFout(body.fout ?? 'Opslaan is niet gelukt. Probeer het opnieuw; er is niets gewijzigd.')
        return
      }
    } catch {
      setFout('Geen verbinding. Probeer het opnieuw; er is niets gewijzigd.')
      return
    } finally {
      setVerzenden(false)
    }
    requestId.current = null
    sluit()
    // Telt mee voor de vraag om feedback op het dashboard, die verschijnt zodra
    // er die dag een paar tips zijn afgehandeld. Terugzetten telt niet: dat is
    // een correctie, geen afgeronde beoordeling.
    if (actie === 'wachtrij') { startTransition(() => router.refresh()); return }
    noteerBeslissing()
    // Door naar de volgende tip; de wachtrij zelf is dan al bijgewerkt.
    startTransition(() => router.push(volgendeId !== null ? `/nieuwsplein33/tip/${volgendeId}` : '/nieuwsplein33'))
  }

  const druk = bezig || verzenden

  if (status !== 'wachtrij' && status !== 'geparkeerd') {
    return (
      <div className="np-acties np-acties-strook">
        <div className="np-acties-af">
          Deze tip is afgehandeld. Onderaan staat wat er is besloten en waarom.
          {status !== 'gepubliceerd' && ' Terugzetten kan met de knop in de balk hierboven.'}
        </div>
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="np-acties" ref={paneel}>
      <div className="np-reden np-reden-paneel" role="dialog" aria-label={`Vastleggen: ${ACTIE_LABEL[open]}`}>
        <div className="np-reden-kop">
          <span className={`np-reden-actie np-reden-actie-${open}`}>{ACTIE_LABEL[open]}</span>
          <p className="np-reden-vraag">{VRAAG[open]}</p>
        </div>

        <div className="np-reden-keuzes">
          {REDENEN[open].map((r) => (
            <button
              key={r.code}
              type="button"
              className={`np-reden-keuze${code === r.code ? ' np-reden-keuze-aan' : ''}`}
              onClick={() => setCode(r.code)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <textarea
          className="np-reden-tekst"
          placeholder="Toelichting (mag leeg blijven)"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          rows={3}
        />

        {fout && <p className="np-fout">{fout}</p>}

        <div className="np-reden-bevestig">
          <button type="button" className="np-knop np-knop-ja" disabled={druk} onClick={() => verstuur(open)}>
            {druk ? 'Bezig…' : volgendeId !== null ? 'Vastleggen en volgende' : 'Vastleggen'}
          </button>
          <button type="button" className="np-knop np-knop-stil" onClick={sluit}>
            Annuleren
          </button>
          <span className="np-reden-hint">Esc sluit, 1 2 3 kiest, ↑ ↓ bladert</span>
        </div>
      </div>
    </div>
  )
}
