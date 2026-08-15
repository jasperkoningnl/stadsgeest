'use client'

import { useSyncExternalStore } from 'react'

/**
 * Wisselt het dashboard tussen licht en donker. Zonder eigen keuze volgt het
 * dashboard de systeemvoorkeur (via CSS, zie globals.css); wie hier drukt
 * kiest expliciet en die keuze wordt onthouden in localStorage ('np-thema').
 * Het attribuut staat op <html>, zodat het inline script in de layout het
 * vóór de eerste render al kan zetten en er geen themaflits is.
 *
 * useSyncExternalStore in plaats van useState-in-effect: de themastand leeft
 * buiten React (het html-attribuut en de systeemvoorkeur), en zo hydrateert
 * de knop zonder mismatch-waarschuwing.
 */

function abonneer(luister: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', luister)
  window.addEventListener('np-thema-gewisseld', luister)
  return () => {
    mq.removeEventListener('change', luister)
    window.removeEventListener('np-thema-gewisseld', luister)
  }
}

function leesThema(): 'licht' | 'donker' {
  const gezet = document.documentElement.getAttribute('data-np-thema')
  if (gezet === 'licht' || gezet === 'donker') return gezet
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'donker' : 'licht'
}

export default function ThemaSchakelaar() {
  const thema = useSyncExternalStore(abonneer, leesThema, () => 'licht')

  function wissel() {
    const naar = thema === 'donker' ? 'licht' : 'donker'
    document.documentElement.setAttribute('data-np-thema', naar)
    try { localStorage.setItem('np-thema', naar) } catch { /* privémodus: dan geen onthouden voorkeur */ }
    window.dispatchEvent(new Event('np-thema-gewisseld'))
  }

  return (
    <button
      type="button"
      className="np-thema-knop"
      onClick={wissel}
      title={thema === 'donker' ? 'Naar het lichte thema' : 'Naar het donkere thema'}
      aria-label="Wissel tussen licht en donker thema"
    >
      {thema === 'donker' ? (
        // zon
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // maan
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}
