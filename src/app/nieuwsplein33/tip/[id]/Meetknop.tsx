'use client'

import { useState, useTransition } from 'react'
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
  const [vondst, setVondst] = useState(eigenVondst === 1)
  const [nietGebruikt, setNietGebruikt] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, startTransition] = useTransition()

  if (!['goedgekeurd', 'in_behandeling', 'gepubliceerd', 'niet_gebruikt'].includes(status)) return null

  async function opslaan(alsNietGebruikt = false) {
    setFout(null)
    const res = await fetch(`/api/tip/${tipId}/artikel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artikel_url: alsNietGebruikt ? null : url.trim() || null,
        eigen_vondst: vondst,
        niet_gebruikt: alsNietGebruikt,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setFout(body.fout ?? 'Opslaan is niet gelukt.')
      return
    }
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

      <label className="np-vink">
        <input type="checkbox" checked={vondst} onChange={(e) => setVondst(e.target.checked)} />
        <span>Dit hadden we zonder Stadsgeest niet gehad</span>
      </label>

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
