'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { noteerBeslissing } from '../../feedbackTeller'

type Actie = 'goedgekeurd' | 'geparkeerd' | 'afgekeurd' | 'wachtrij'

// De redenen zijn bewust kort en uitputtend genoeg om zonder typen te kunnen
// afhandelen. Ze worden geteld bij het bijstellen van de selectie, dus ze
// moeten over maanden nog dezelfde betekenis hebben.
// Terugzetten ('wachtrij') vraagt geen reden — de eerdere beslissing met reden
// blijft in de geschiedenis staan.
const REDENEN: Record<Exclude<Actie, 'wachtrij'>, { code: string; label: string }[]> = {
  goedgekeurd: [
    { code: 'zelf_niet_gevonden', label: 'Dit had ik zelf niet gevonden' },
    { code: 'concreet_gemaakt', label: 'Wist er iets van, dit maakt het concreet' },
    { code: 'stond_al_op_lijst', label: 'Stond al op mijn lijstje' },
    { code: 'goede_invalshoek', label: 'Bekend onderwerp, nieuwe invalshoek' },
  ],
  geparkeerd: [
    { code: 'te_vroeg', label: 'Te vroeg — besluitvorming moet nog komen' },
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
  ],
}

const KNOPPEN: { actie: Exclude<Actie, 'wachtrij'>; label: string; klasse: string }[] = [
  { actie: 'goedgekeurd', label: 'Hier wil ik iets mee', klasse: 'np-knop-ja' },
  { actie: 'geparkeerd', label: 'Bewaar voor later', klasse: 'np-knop-later' },
  { actie: 'afgekeurd', label: 'Niets mee doen', klasse: 'np-knop-nee' },
]

export default function TipActies({ tipId, status }: { tipId: number; status: string }) {
  const router = useRouter()
  const [open, setOpen] = useState<Exclude<Actie, 'wachtrij'> | null>(null)
  const [code, setCode] = useState('')
  const [tekst, setTekst] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, startTransition] = useTransition()

  async function verstuur(actie: Actie) {
    setFout(null)
    const res = await fetch(`/api/tip/${tipId}/beslis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actie, reden_code: code || null, reden_tekst: tekst || null }),
    })
    if (!res.ok) {
      setFout('Opslaan is niet gelukt. Probeer het opnieuw; er is niets gewijzigd.')
      return
    }
    setOpen(null); setCode(''); setTekst('')
    // Telt mee voor de vraag om feedback op het dashboard, die verschijnt zodra
    // er die dag een paar tips zijn afgehandeld. Terugzetten telt niet: dat is
    // een correctie, geen afgeronde beoordeling.
    if (actie !== 'wachtrij') noteerBeslissing()
    startTransition(() => router.refresh())
  }

  // Elke beslissing is omkeerbaar (de geschiedenis is append-only en blijft
  // onderaan de pagina staan), behalve bij een gepubliceerde tip — daar loopt
  // de correctie via de meetknop, zodat de meetstand blijft kloppen.
  const terugKnop = (
    <button
      type="button"
      className="np-knop np-knop-stil"
      disabled={bezig}
      onClick={() => verstuur('wachtrij')}
      title="De tip komt terug in de wachtrij; de eerdere beslissing blijft in de geschiedenis staan"
    >
      {bezig ? 'Bezig…' : 'Zet terug in de wachtrij'}
    </button>
  )

  if (status !== 'wachtrij' && status !== 'geparkeerd') {
    return (
      <div className="np-acties">
        <div className="np-acties-af">
          Deze tip is afgehandeld. Hieronder staat wat er is besloten en waarom.
        </div>
        {status !== 'gepubliceerd' && (
          <div className="np-acties-knoppen" style={{ marginTop: 12 }}>
            {terugKnop}
          </div>
        )}
        {fout && <p className="np-fout" style={{ marginTop: 10 }}>{fout}</p>}
      </div>
    )
  }

  return (
    <div className="np-acties">
      <div className="np-acties-knoppen">
        {KNOPPEN.filter((k) => k.actie !== status).map((k) => (
          <button
            key={k.actie}
            type="button"
            className={`np-knop ${k.klasse}${open === k.actie ? ' np-knop-open' : ''}`}
            onClick={() => { setOpen(open === k.actie ? null : k.actie); setCode(''); setTekst('') }}
          >
            {k.label}
          </button>
        ))}
        {status === 'geparkeerd' && terugKnop}
      </div>

      {open && (
        <div className="np-reden">
          <p className="np-reden-vraag">
            {open === 'goedgekeurd' && 'Waarom wil je hier iets mee? Dat helpt om de selectie scherper te krijgen.'}
            {open === 'geparkeerd' && 'Waarom nu niet?'}
            {open === 'afgekeurd' && 'Waarom niet? Hoe specifieker, hoe beter de volgende selectie wordt.'}
          </p>

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
            <button type="button" className="np-knop np-knop-ja" disabled={bezig} onClick={() => verstuur(open)}>
              {bezig ? 'Bezig…' : 'Vastleggen'}
            </button>
            <button type="button" className="np-knop np-knop-stil" onClick={() => setOpen(null)}>
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
