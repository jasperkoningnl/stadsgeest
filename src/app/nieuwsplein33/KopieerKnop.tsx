'use client'

import { useState } from 'react'

/**
 * Zet een vooraf opgebouwde tekst op het klembord. De tekst komt van de
 * server (de pagina weet wat erin hoort); hier zit alleen de klik. Zonder
 * clipboard-API (http, oude browser) valt hij terug op een verborgen
 * tekstveld met execCommand.
 */
export default function KopieerKnop({ tekst, label = 'Kopieer als tekst', klasse = 'np-knop-klein' }: {
  tekst: string
  label?: string
  klasse?: string
}) {
  const [stand, setStand] = useState<'rust' | 'gekopieerd' | 'mislukt'>('rust')

  async function kopieer() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tekst)
      } else {
        const veld = document.createElement('textarea')
        veld.value = tekst
        veld.setAttribute('readonly', '')
        veld.style.position = 'fixed'
        veld.style.opacity = '0'
        document.body.appendChild(veld)
        veld.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(veld)
        if (!ok) throw new Error('execCommand')
      }
      setStand('gekopieerd')
    } catch {
      setStand('mislukt')
    }
    setTimeout(() => setStand('rust'), 2500)
  }

  return (
    <button type="button" className={klasse} onClick={kopieer} aria-live="polite"
      title="Zet de tekst op het klembord, om te plakken in een mail of document">
      {stand === 'gekopieerd' ? 'Gekopieerd ✓' : stand === 'mislukt' ? 'Kopiëren lukte niet' : label}
    </button>
  )
}
