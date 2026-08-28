'use client'

import { useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TABS = ['Bronnen', 'Intake', 'Weging'] as const
export type BeheerTab = (typeof TABS)[number]

const PERIODES = [
  { dagen: 7, label: '7 dagen' },
  { dagen: 14, label: '14 dagen' },
  { dagen: 30, label: '30 dagen' },
] as const

interface BeheerTabsProps {
  bronnenCount: number
  bronnenContent: ReactNode
  intakeContent: ReactNode
  wegingContent: ReactNode
  periode: number
}

export default function BeheerTabs({
  bronnenCount,
  bronnenContent,
  intakeContent,
  wegingContent,
  periode,
}: BeheerTabsProps) {
  const [actief, setActief] = useState<BeheerTab>('Bronnen')
  const router = useRouter()
  const searchParams = useSearchParams()

  function wijzigPeriode(dagen: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('periode', String(dagen))
    router.push(`?${params.toString()}`)
  }

  return (
    <div>
      {/* Sub-navigatie: duidelijk submenu van Beheer */}
      <nav className="np-subnav">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`np-subnav-item${actief === tab ? ' np-subnav-item-actief' : ''}`}
            onClick={() => setActief(tab)}
          >
            {tab}
            {tab === 'Bronnen' && (
              <span className="np-nav-tel">{bronnenCount}</span>
            )}
          </button>
        ))}

        {/* Periodeselector (niet voor Bronnen) */}
        {actief !== 'Bronnen' && (
          <div className="np-periode-kiezer">
            {PERIODES.map((p) => (
              <button
                key={p.dagen}
                type="button"
                className={`np-periode-pil${periode === p.dagen ? ' np-periode-pil-actief' : ''}`}
                onClick={() => wijzigPeriode(p.dagen)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </nav>

      <div style={{ marginTop: 20 }}>
        {actief === 'Bronnen' && bronnenContent}
        {actief === 'Intake' && intakeContent}
        {actief === 'Weging' && wegingContent}
      </div>
    </div>
  )
}
