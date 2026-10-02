'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { noteerBeslissing } from './feedbackTeller'

/**
 * Knop boven de ingeklapte groep "Ouder dan een maand" op de wachtrij: wijst
 * alle tips in die groep in één keer af als oud nieuws. Elke tip krijgt zijn
 * eigen beslissing via de gewone beslisroute (met reden en request_id), dus
 * de leerloop telt ze mee en elke tip is los weer terug te zetten.
 *
 * Een netwerkfout halverwege is geen ramp: wat al is afgewezen blijft
 * afgewezen, de rest staat er na verversen nog. Een herhaalde klik gebruikt
 * per tip hetzelfde request_id, dus er komt geen dubbele feedbackrij.
 */
export default function VerouderdeTips({ tipIds }: { tipIds: number[] }) {
  const router = useRouter()
  const [stand, setStand] = useState<'rust' | 'bezig' | 'klaar' | 'fout'>('rust')
  const [voortgang, setVoortgang] = useState(0)
  const [fout, setFout] = useState<string | null>(null)
  const requestIds = useRef(new Map<number, string>())

  async function afsluiten() {
    const n = tipIds.length
    const bevestigd = window.confirm(
      `${n} ${n === 1 ? 'tip' : 'tips'} ouder dan een maand afwijzen als oud nieuws?\n\n` +
      'Ze verdwijnen uit de wachtrij naar het Archief. Een afgewezen tip kun je daar altijd nog terugzetten.',
    )
    if (!bevestigd) return
    setStand('bezig'); setFout(null); setVoortgang(0)
    let mislukt = 0
    for (const id of tipIds) {
      let rid = requestIds.current.get(id)
      if (!rid) { rid = crypto.randomUUID(); requestIds.current.set(id, rid) }
      try {
        const res = await fetch(`/api/tip/${id}/beslis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actie: 'afgekeurd', reden_code: 'oud_nieuws',
            reden_tekst: 'Afgesloten vanuit de wachtrij: langer dan een maand niet opgepakt.',
            request_id: rid,
          }),
        })
        // "heeft die status al" betekent dat iemand anders hem net heeft afgehandeld; dat is geen fout.
        if (!res.ok && res.status !== 400) mislukt++
        else requestIds.current.delete(id)
      } catch {
        mislukt++
      }
      setVoortgang((v) => v + 1)
    }
    if (mislukt > 0) {
      setStand('fout')
      setFout(`${mislukt} van ${n} ${n === 1 ? 'tip is' : 'tips zijn'} niet opgeslagen. Ververs de pagina en probeer het opnieuw voor de rest.`)
    } else {
      setStand('klaar')
    }
    noteerBeslissing()
    router.refresh()
  }

  return (
    <div className="np-oud-actie">
      <p className="np-tekst np-stil">
        Deze tips staan langer dan een maand in de wachtrij. Wat je niet alsnog oppakt of parkeert, kun je hier in
        één keer afsluiten; elke tip krijgt dan de reden &ldquo;oud nieuws&rdquo; en blijft in het archief terug te
        vinden.
      </p>
      <button type="button" className="np-knop np-knop-nee" disabled={stand === 'bezig'} onClick={afsluiten}>
        {stand === 'bezig'
          ? `Bezig… ${voortgang} van ${tipIds.length}`
          : stand === 'klaar'
            ? 'Afgesloten ✓'
            : `Alles hier afwijzen als oud nieuws (${tipIds.length})`}
      </button>
      {fout && <p className="np-fout" role="alert" style={{ marginTop: 8 }}>{fout}</p>}
    </div>
  )
}
