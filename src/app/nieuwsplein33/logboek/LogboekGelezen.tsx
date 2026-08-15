'use client'

import { useEffect } from 'react'
import { LOGBOEK_GELEZEN_SLEUTEL, LOGBOEK_GEBEURTENIS } from '../logboekGelezen'

/**
 * Onthoudt welke logboekregel als laatste is gezien, zodat het stipje in de
 * navigatie verdwijnt. Per browser, in localStorage — dit hoeft niemand terug
 * te kunnen zien, het is alleen een leesteken.
 */
export default function LogboekGelezen({ datum }: { datum: string | null }) {
  useEffect(() => {
    if (!datum) return
    try { localStorage.setItem(LOGBOEK_GELEZEN_SLEUTEL, datum) } catch { /* privémodus: dan blijft het stipje staan */ }
    window.dispatchEvent(new Event(LOGBOEK_GEBEURTENIS))
  }, [datum])

  return null
}
