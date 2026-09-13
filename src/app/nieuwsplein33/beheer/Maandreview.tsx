'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Maandreview({ maand, status }: { maand: string; status: string }) {
  const router = useRouter()
  const [checks, setChecks] = useState([false,false,false])
  const [notes, setNotes] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const requestId = useRef<string | null>(null)
  if (status !== 'open') return null
  async function opslaan() {
    if (!checks.every(Boolean)) { setFout('Controleer eerst alle drie de onderdelen.'); return }
    requestId.current ??= crypto.randomUUID(); setBezig(true); setFout(null)
    const response = await fetch('/api/fase5/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      maand, request_id: requestId.current, false_positives: checks[0], gemiste_entiteiten: checks[1], brongezondheid: checks[2], notes,
    }) }).catch(() => null)
    setBezig(false)
    if (!response?.ok) { const body = await response?.json().catch(() => ({})); setFout(body?.fout || 'Opslaan is niet gelukt.'); return }
    requestId.current = null; router.refresh()
  }
  const labels = ['False positives en afwijsredenen bekeken','Gemiste of verkeerd gekoppelde entiteiten bekeken','Brongezondheid en uitval bekeken']
  return <div className="np-maandreview">
    {labels.map((item,index) => <label className="np-vink" key={item}><input type="checkbox" checked={checks[index]} onChange={event => setChecks(current => current.map((value,i) => i === index ? event.target.checked : value))} /><span>{item}</span></label>)}
    <textarea className="np-reden-tekst" rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Korte conclusie of vervolgactie (optioneel)" />
    {fout && <p className="np-fout">{fout}</p>}
    <button className="np-knop np-knop-ja" type="button" disabled={bezig} onClick={opslaan}>{bezig ? 'Bezig…' : 'Maandreview vastleggen'}</button>
  </div>
}
