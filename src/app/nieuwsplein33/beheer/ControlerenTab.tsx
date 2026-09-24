'use client'

import { useEffect, useState } from 'react'
import NerControle from './NerControle'

type Candidate = {
  id: number
  referenceName: string
  candidateName: string
  candidatePlace: string | null
  sourceLabel: string
  identifierType: string
  identifierValue: string
}

type GoldenStatus = {
  total: number
  labeled: number
  skipped: number
  target: number
  candidate: Candidate | null
}

// Twee handmatige controles onder Beheer > Controleren: de fase-1-organisatiematches
// en de NER-naamkoppelingen (docs/NER.md). Beide alleen voor Jasper.
export default function ControlerenTab() {
  const [soort, setSoort] = useState<'organisaties' | 'namen'>('organisaties')
  return (
    <div>
      <div className="np-controle-keuze" role="group" aria-label="Soort controle">
        <button
          type="button"
          aria-pressed={soort === 'organisaties'}
          className={`np-periode-pil${soort === 'organisaties' ? ' np-periode-pil-actief' : ''}`}
          onClick={() => setSoort('organisaties')}
        >
          Organisaties (fase 1)
        </button>
        <button
          type="button"
          aria-pressed={soort === 'namen'}
          className={`np-periode-pil${soort === 'namen' ? ' np-periode-pil-actief' : ''}`}
          onClick={() => setSoort('namen')}
        >
          Namen in documenten
        </button>
      </div>
      {soort === 'organisaties' ? <OrganisatieControle /> : <NerControle />}
    </div>
  )
}

function OrganisatieControle() {
  const [data, setData] = useState<GoldenStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fase1/golden')
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.fout || 'Laden mislukt')
        setData(result)
      })
      .catch(error => setFout(error instanceof Error ? error.message : 'Laden mislukt'))
  }, [])

  async function beoordeel(verdict: 'same' | 'different' | 'skipped') {
    if (!data?.candidate || busy) return
    setBusy(true)
    setFout(null)
    try {
      const response = await fetch('/api/fase1/golden', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: data.candidate.id, verdict, request_id: crypto.randomUUID() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.fout || 'Opslaan mislukt')
      setData(result)
    } catch (error) {
      setFout(error instanceof Error ? error.message : 'Opslaan mislukt')
    } finally {
      setBusy(false)
    }
  }

  if (fout && !data) return <div className="np-beheer-fout">{fout}</div>
  if (!data) return <p className="np-telling">Beoordelingen laden…</p>

  const klaar = data.labeled >= data.target
  return (
    <div className="np-golden">
      <p className="np-telling">
        {data.labeled} van {data.target} beoordeeld
        {data.skipped > 0 ? ` · ${data.skipped} overgeslagen` : ''}
      </p>
      <div className="np-golden-voortgang" aria-label={`${data.labeled} van ${data.target} beoordeeld`}>
        <span style={{ width: `${Math.min(100, (data.labeled / data.target) * 100)}%` }} />
      </div>

      {klaar ? (
        <div className="np-beheer-kaart">
          <h2 className="np-golden-titel">De vereiste 200 zijn beoordeeld</h2>
          <p>De fase-1-audit kan nu de precisie van de automatische matches berekenen.</p>
        </div>
      ) : data.candidate ? (
        <div className="np-beheer-kaart">
          <p className="np-golden-vraag">Vergelijk de naamvariant met de organisatie. Bedoelen ze dezelfde organisatie?</p>
          <div className="np-golden-vergelijking">
            <div><span>Naamvariant</span><strong>{data.candidate.candidateName}</strong><small>{data.candidate.sourceLabel}{data.candidate.candidatePlace ? ` · ${data.candidate.candidatePlace}` : ''}</small></div>
            <div><span>Gekoppeld aan</span><strong>{data.candidate.referenceName}</strong><small>Organisatie in Stadsgeest</small></div>
          </div>
          <p className="np-golden-kvk">
            {data.candidate.identifierType.toUpperCase()} {data.candidate.identifierValue}
            {' · '}<a href={`https://www.kvk.nl/zoeken/?source=all&q=${encodeURIComponent(data.candidate.identifierValue)}`} target="_blank" rel="noreferrer">Controleer bij KVK ↗</a>
          </p>
          <div className="np-acties-knoppen np-golden-acties">
            <button type="button" className="np-knop np-knop-ja" disabled={busy} onClick={() => beoordeel('same')}>Ja, dezelfde organisatie</button>
            <button type="button" className="np-knop np-knop-nee" disabled={busy} onClick={() => beoordeel('different')}>Nee, niet dezelfde</button>
            <button type="button" className="np-knop np-knop-stil" disabled={busy} onClick={() => beoordeel('skipped')}>Weet ik niet</button>
          </div>
          {fout && <div className="np-beheer-fout">{fout}</div>}
        </div>
      ) : (
        <div className="np-beheer-kaart"><p>Geen onbeoordeelde kandidaten meer.</p></div>
      )}
    </div>
  )
}
