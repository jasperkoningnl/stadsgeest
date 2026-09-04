'use client'

import { useState } from 'react'

/**
 * "Wat is dit?" knop die de ondertitel van het dashboard toont of verbergt.
 * Standaard ingeklapt om de kop compact te houden.
 */
export default function UitlegToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="np-uitleg-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Verberg uitleg' : 'Wat is dit?'}
      </button>
      {open && children}
    </>
  )
}
