'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// De tabbladen van het woondashboard. Een client component alleen omdat de
// actieve tab van het pad afhangt; verder gewone links, dus ook zonder
// JavaScript te gebruiken.
export const TABS = [
  { href: '/beleidsadviseur', label: 'Overzicht', sub: 'wat vraagt aandacht' },
  { href: '/beleidsadviseur/vergunningen', label: 'Vergunningen', sub: 'aanvragen, besluiten, termijnen' },
  { href: '/beleidsadviseur/woningmarkt', label: 'Woningmarkt', sub: 'CBS: voorraad, bouw, prijzen' },
  { href: '/beleidsadviseur/corporaties', label: 'Corporaties', sub: 'dPi-plannen en bezit' },
  { href: '/beleidsadviseur/wonen-zorg', label: 'Wonen en zorg', sub: 'vergrijzing, Wmo, opvang' },
  { href: '/beleidsadviseur/raad', label: 'Raad en beleid', sub: 'stukken, regels, subsidies' },
]

export default function TabBalk() {
  const pathname = usePathname()
  return (
    <nav className="bd-tabs" aria-label="Onderdelen van het woondashboard">
      {TABS.map((t) => {
        const actief = t.href === '/beleidsadviseur' ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href} className={`bd-tab${actief ? ' bd-tab-actief' : ''}`} aria-current={actief ? 'page' : undefined}>
            <strong>{t.label}</strong>
            <span>{t.sub}</span>
          </Link>
        )
      })}
    </nav>
  )
}
