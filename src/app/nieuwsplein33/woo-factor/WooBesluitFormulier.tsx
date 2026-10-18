'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { WOO_BESLUITEN } from '@/lib/dashboard/wooFactor'
import type { WooZaak } from '@/lib/dashboard/wooFactorStore'

export default function WooBesluitFormulier({ zaak }: { zaak: WooZaak }) {
  const router = useRouter()
  const [concept, setConcept] = useState(zaak.concept)
  const [bezig, setBezig] = useState(false)
  const [melding, setMelding] = useState('')
  const heeftConcept = zaak.analyse.uitkomst === 'informatieleemte'
  const gewijzigd = concept !== zaak.concept
  async function bewaren(actie: string) {
    if (bezig) return
    setBezig(true); setMelding('')
    try {
      const response = await fetch(`/api/woo-factor/${zaak.analyse.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie, concept, revision: zaak.revision }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.fout || 'Opslaan mislukt.')
      setConcept(result.concept)
      setMelding(actie === 'goedkeuren' ? 'Goedkeuring vastgelegd. Er is niets verzonden.' : actie === 'afwijzen' ? 'Afwijzing vastgelegd.' : 'Concept opgeslagen. Beoordeel deze versie opnieuw.')
      router.refresh()
    } catch (error) { setMelding(error instanceof Error ? error.message : 'Opslaan mislukt.') }
    finally { setBezig(false) }
  }
  return <div className="np-woo-besluit">
    <p><strong>{WOO_BESLUITEN[zaak.besluit]}</strong>{zaak.decided_by && <> · {zaak.decided_by} · {zaak.decided_at && new Date(zaak.decided_at).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}</>}</p>
    {heeftConcept && <>
      <label htmlFor={`concept-${zaak.analyse.id}`}><strong>Conceptverzoek</strong></label>
      <textarea id={`concept-${zaak.analyse.id}`} value={concept} onChange={e => setConcept(e.target.value)} maxLength={20000} rows={14} disabled={bezig} />
      <p className="np-stil">Goedkeuring geldt voor deze opgeslagen tekst, geadresseerde en afbakening. Een wijziging vraagt een nieuwe beoordeling. Voeg bij handmatige indiening de gegevens van de afzender toe.</p>
    </>}
    <div className="np-woo-knoppen">
      {heeftConcept && <>
        <button type="button" disabled={bezig || !gewijzigd || !concept.trim()} onClick={() => bewaren('opslaan')}>Concept opslaan</button>
        <button type="button" disabled={bezig || gewijzigd || !concept.trim() || zaak.besluit === 'goedgekeurd'} onClick={() => bewaren('goedkeuren')}>Goedkeuren voor indiening</button>
      </>}
      <button type="button" disabled={bezig || zaak.besluit === 'afgewezen'} onClick={() => bewaren('afwijzen')}>Afwijzen</button>
    </div>
    {gewijzigd && <p>Sla wijzigingen eerst op voordat je goedkeurt.</p>}
    <p role="status" aria-live="polite">{melding}</p>
    <p className="np-stil">Stadsgeest verstuurt vanuit deze pagina geen verzoeken.</p>
  </div>
}
