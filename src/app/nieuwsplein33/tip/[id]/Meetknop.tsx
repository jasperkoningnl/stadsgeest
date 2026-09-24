'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * De meetknop. Het succescriterium van de testperiode is dat het dashboard drie
 * tot vijf keer aantoonbaar tot een artikel heeft geleid dat er anders niet was
 * geweest. Dat moet hier worden vastgelegd, op het moment zelf — achteraf
 * reconstrueren lukt niet.
 */
export default function Meetknop({
  tipId, artikelUrl, eigenVondst, status,
}: {
  tipId: number
  artikelUrl: string | null
  eigenVondst: number | null
  status: string
}) {
  const router = useRouter()
  const [url, setUrl] = useState(artikelUrl ?? '')
  const [zonderStadsgeest, setZonderStadsgeest] = useState<'ja' | 'nee' | ''>(
    eigenVondst === 1 ? 'ja' : eigenVondst === 0 ? 'nee' : '',
  )
  const [nietGebruikt, setNietGebruikt] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, startTransition] = useTransition()
  const requestId = useRef<string | null>(null)

  if (!['goedgekeurd', 'in_behandeling', 'gepubliceerd', 'niet_gebruikt'].includes(status)) return null

  async function opslaan(alsNietGebruikt = false) {
    setFout(null)
    if (!alsNietGebruikt && !zonderStadsgeest) {
      setFout('Kies of dit artikel er zonder Stadsgeest ook was geweest.')
      return
    }
    requestId.current ??= crypto.randomUUID()
    const res = await fetch(`/api/tip/${tipId}/artikel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artikel_url: alsNietGebruikt ? null : url.trim() || null,
        zonder_stadsgeest: alsNietGebruikt ? null : zonderStadsgeest,
        niet_gebruikt: alsNietGebruikt,
        request_id: requestId.current,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setFout(body.fout ?? 'Opslaan is niet gelukt.')
      return
    }
    requestId.current = null
    startTransition(() => router.refresh())
  }

  return (
    <div className="np-meetknop">
      <p className="np-meetknop-kop">Is hier een artikel van gekomen?</p>

      <label className="np-veld">
        <span>Adres van het artikel op nieuwsplein33.nl</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.nieuwsplein33.nl/nieuws/…"
        />
      </label>

      <fieldset className="np-uitkomst-keuze">
        <legend>Was dit artikel er zonder Stadsgeest ook geweest?</legend>
        <label className="np-vink">
          <input type="radio" name="zonder-stadsgeest" checked={zonderStadsgeest === 'ja'} onChange={() => setZonderStadsgeest('ja')} />
          <span>Nee, dit hadden we zonder Stadsgeest niet gehad</span>
        </label>
        <label className="np-vink">
          <input type="radio" name="zonder-stadsgeest" checked={zonderStadsgeest === 'nee'} onChange={() => setZonderStadsgeest('nee')} />
          <span>Ja, dit onderwerp was al op een andere manier gevonden</span>
        </label>
      </fieldset>

      {fout && <p className="np-fout">{fout}</p>}

      <div className="np-meetknop-knoppen">
        <button type="button" className="np-knop np-knop-ja" disabled={bezig} onClick={() => opslaan(false)}>
          {bezig ? 'Bezig…' : 'Vastleggen'}
        </button>
        {status !== 'niet_gebruikt' && status !== 'gepubliceerd' && (
          <button
            type="button"
            className="np-knop np-knop-stil"
            disabled={bezig}
            onClick={() => { setNietGebruikt(true); opslaan(true) }}
          >
            {nietGebruikt && bezig ? 'Bezig…' : 'Toch niets mee gedaan'}
          </button>
        )}
      </div>
    </div>
  )
}
