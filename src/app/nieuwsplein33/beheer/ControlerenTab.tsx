'use client'

import { useEffect, useState } from 'react'

type Candidate = {
  id: number
  referenceName: string
  identifierType: string
  identifierValue: string
  evidenceUrl: string
}

type GoldenStatus = {
  total: number
  labeled: number
  skipped: number
  target: number
  candidate: Candidate | null
}

export default function ControlerenTab() {
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
          <p className="np-golden-vraag">Hoort deze registratie bij deze organisatie?</p>
          <h2 className="np-golden-titel">{data.candidate.referenceName}</h2>
          <dl className="np-golden-gegevens">
            <div><dt>{data.candidate.identifierType.toUpperCase()}</dt><dd>{data.candidate.identifierValue}</dd></div>
            <div><dt>Bewijs</dt><dd><a href={data.candidate.evidenceUrl} target="_blank" rel="noreferrer">Open bron ↗</a></dd></div>
          </dl>
          <div className="np-acties-knoppen np-golden-acties">
            <button type="button" className="np-knop np-knop-ja" disabled={busy} onClick={() => beoordeel('same')}>Ja, dezelfde</button>
            <button type="button" className="np-knop np-knop-nee" disabled={busy} onClick={() => beoordeel('different')}>Nee, andere</button>
            <button type="button" className="np-knop np-knop-stil" disabled={busy} onClick={() => beoordeel('skipped')}>Overslaan</button>
          </div>
          {fout && <div className="np-beheer-fout">{fout}</div>}
        </div>
      ) : (
        <div className="np-beheer-kaart"><p>Geen onbeoordeelde kandidaten meer.</p></div>
      )}
    </div>
  )
}
