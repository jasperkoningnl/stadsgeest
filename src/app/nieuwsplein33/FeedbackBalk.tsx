'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import FeedbackFormulier from './FeedbackFormulier'
import { DREMPEL, GEBEURTENIS, alGetoondVandaag, markeerGetoond, standVandaag } from './feedbackTeller'

/**
 * Vraagt om feedback op het moment dat het werk net gedaan is: nadat iemand die
 * dag DREMPEL tips heeft afgehandeld en terug is op een lijstpagina.
 *
 * Hoogstens één keer per dag. Zodra de balk verschijnt wordt de dag afgestempeld
 * (markeerGetoond) — of iemand nu iets invult of wegklikt maakt niet uit. Blijft
 * de balk staan zonder dat er iets mee gebeurt, dan is dat de laatste van vandaag.
 *
 * Niet op de tippagina zelf: daar is iemand aan het lezen en beslissen, en dat
 * is precies het moment om níét te onderbreken.
 */

const NIET_OP = ['/nieuwsplein33/tip/', '/nieuwsplein33/logboek', '/nieuwsplein33/beheer']

export default function FeedbackBalk() {
  const pathname = usePathname()
  const [zichtbaar, setZichtbaar] = useState(false)
  const magHier = !NIET_OP.some((p) => pathname.startsWith(p))

  useEffect(() => {
    if (!magHier) return
    function kijk() {
      if (alGetoondVandaag() || standVandaag() < DREMPEL) return
      markeerGetoond()
      setZichtbaar(true)
    }
    kijk()
    window.addEventListener(GEBEURTENIS, kijk)
    return () => window.removeEventListener(GEBEURTENIS, kijk)
  }, [magHier, pathname])

  if (!zichtbaar || !magHier) return null

  return (
    <div className="np-fb-balk" role="complementary" aria-label="Feedback op het dashboard">
      <div className="np-fb-balk-binnen">
        <div className="np-fb-balk-kop">
          <strong>Hoe bevalt het dashboard?</strong>
          <button
            type="button"
            className="np-fb-balk-sluit"
            onClick={() => setZichtbaar(false)}
            aria-label="Sluiten"
            title="Sluiten — vandaag niet meer"
          >
            ×
          </button>
        </div>
        <p className="np-tekst np-stil">
          Je hebt net een paar tips afgehandeld. Viel je iets op aan het dashboard zelf? Dit komt
          hoogstens één keer per dag langs.
        </p>
        <FeedbackFormulier aanleiding="balk" rijen={3} />
      </div>
    </div>
  )
}
