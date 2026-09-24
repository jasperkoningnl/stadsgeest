'use client'

import { useEffect, useState } from 'react'

type Candidate = {
  id: number
  type: string
  mention: string
  context: string
  occurrences: number
  kgName: string
  kgMentions: number
  title: string
  url: string | null
  source: string
}

type NerStatus = {
  labeled: number
  correct: number
  incorrect: number
  skipped: number
  open: number
  target: number
  candidate: Candidate | null
}

const TYPE_LABEL: Record<string, string> = { person: 'persoon', organization: 'organisatie', location: 'locatie' }

// Markeert de vermelding in het tekstfragment, zonder HTML te injecteren.
function Fragment({ context, mention }: { context: string; mention: string }) {
  const i = context.toLowerCase().indexOf(mention.toLowerCase())
  if (i < 0) return <>…{context}…</>
  return (
    <>…{context.slice(0, i)}<mark>{context.slice(i, i + mention.length)}</mark>{context.slice(i + mention.length)}…</>
  )
}

export default function NerControle() {
  const [data, setData] = useState<NerStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ner/review')
      .then(async response => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.fout || 'Laden mislukt')
        setData(result)
      })
      .catch(error => setFout(error instanceof Error ? error.message : 'Laden mislukt'))
  }, [])

  async function beoordeel(verdict: 'correct' | 'incorrect' | 'skipped') {
    if (!data?.candidate || busy) return
    setBusy(true)
    setFout(null)
    try {
      const response = await fetch('/api/ner/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mentionId: data.candidate.id, verdict, request_id: crypto.randomUUID() }),
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

  const c = data.candidate
  const precisie = data.labeled ? Math.round((100 * data.correct) / data.labeled) : null
  return (
    <div className="np-golden">
      <p className="np-telling">
        {data.labeled} van {data.target} beoordeeld
        {precisie !== null ? ` · ${precisie}% juist gekoppeld` : ''}
        {data.skipped > 0 ? ` · ${data.skipped} overgeslagen` : ''}
      </p>
      <div className="np-golden-voortgang" aria-label={`${data.labeled} van ${data.target} beoordeeld`}>
        <span style={{ width: `${Math.min(100, (data.labeled / data.target) * 100)}%` }} />
      </div>

      {c ? (
        <div className="np-beheer-kaart">
          <p className="np-golden-vraag">
            Stadsgeest vond deze naam in een document en koppelde hem aan een bekende {TYPE_LABEL[c.type] ?? c.type}.
            Gaat het in dit stuk om die {TYPE_LABEL[c.type] ?? c.type}?
          </p>
          <div className="np-golden-vergelijking">
            <div><span>In het document</span><strong>{c.mention}</strong><small>{c.source}{c.occurrences > 1 ? ` · ${c.occurrences}× in dit stuk` : ''}</small></div>
            <div><span>Gekoppeld aan</span><strong>{c.kgName}</strong><small>In Stadsgeest · {c.kgMentions} vermeldingen</small></div>
          </div>
          {c.context && <p className="np-ner-fragment"><Fragment context={c.context} mention={c.mention} /></p>}
          {c.title && (
            <p className="np-golden-kvk">
              {c.title}
              {c.url && <>{' · '}<a href={c.url} target="_blank" rel="noreferrer">Open de bron ↗</a></>}
            </p>
          )}
          <div className="np-acties-knoppen np-golden-acties">
            <button type="button" className="np-knop np-knop-ja" disabled={busy} onClick={() => beoordeel('correct')}>Ja, dezelfde</button>
            <button type="button" className="np-knop np-knop-nee" disabled={busy} onClick={() => beoordeel('incorrect')}>Nee, iemand of iets anders</button>
            <button type="button" className="np-knop np-knop-stil" disabled={busy} onClick={() => beoordeel('skipped')}>Weet ik niet</button>
          </div>
          {fout && <div className="np-beheer-fout">{fout}</div>}
        </div>
      ) : (
        <div className="np-beheer-kaart"><p>Geen onbeoordeelde koppelingen meer.</p></div>
      )}
      {c && data.labeled >= data.target && (
        <p className="np-telling">Het doel van {data.target} is gehaald. Doorgaan mag; elk extra oordeel maakt het cijfer nauwkeuriger.</p>
      )}
    </div>
  )
}
