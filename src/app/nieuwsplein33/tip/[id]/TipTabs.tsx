'use client'

import { useState } from 'react'

export interface Tab {
  id: string
  label: string
  /** Aantal achter het label, bijvoorbeeld het aantal documenten. */
  aantal?: number
  inhoud: React.ReactNode
}

export default function TipTabs({ tabs }: { tabs: Tab[] }) {
  const [actief, setActief] = useState(tabs[0]?.id)

  return (
    <div className="np-tabs">
      <div className="np-tabs-balk" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={actief === t.id}
            className={`np-tab${actief === t.id ? ' np-tab-actief' : ''}`}
            onClick={() => setActief(t.id)}
          >
            {t.label}
            {t.aantal !== undefined && <span className="np-tab-tel">{t.aantal}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={actief !== t.id} className="np-tab-inhoud">
          {t.inhoud}
        </div>
      ))}
    </div>
  )
}
