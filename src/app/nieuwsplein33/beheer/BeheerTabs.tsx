'use client'

import { useState, type ReactNode } from 'react'

const TABS = ['Bronnen', 'Intake', 'Weging'] as const
export type BeheerTab = (typeof TABS)[number]

interface BeheerTabsProps {
  bronnenCount: number
  bronnenContent: ReactNode
  intakeContent: ReactNode
  wegingContent: ReactNode
}

export default function BeheerTabs({
  bronnenCount,
  bronnenContent,
  intakeContent,
  wegingContent,
}: BeheerTabsProps) {
  const [actief, setActief] = useState<BeheerTab>('Bronnen')

  return (
    <div>
      <nav className="np-nav-strip">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`np-nav-item${actief === tab ? ' np-nav-item-actief' : ''}`}
            onClick={() => setActief(tab)}
          >
            {tab}
            {tab === 'Bronnen' && (
              <span className="np-nav-tel">{bronnenCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 24 }}>
        {actief === 'Bronnen' && bronnenContent}
        {actief === 'Intake' && intakeContent}
        {actief === 'Weging' && wegingContent}
      </div>
    </div>
  )
}
