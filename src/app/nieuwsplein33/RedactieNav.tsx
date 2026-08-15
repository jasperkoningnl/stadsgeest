'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/nieuwsplein33', label: 'Wachtrij', tel: ['wachtrij'] },
  { href: '/nieuwsplein33/behandeling', label: 'Mee bezig', tel: ['goedgekeurd', 'in_behandeling'] },
  { href: '/nieuwsplein33/geparkeerd', label: 'Geparkeerd', tel: ['geparkeerd'] },
  { href: '/nieuwsplein33/archief', label: 'Archief', tel: ['gepubliceerd', 'niet_gebruikt', 'afgekeurd'] },
  { href: '/nieuwsplein33/verkenner', label: 'Verkenner', tel: [] as string[] },
]

// Beheer is bewust alleen voor Jasper: cijfers over de pipeline zelf, niet over
// tips. Andere redactieleden hebben daar niets aan en het maakt de rest van de
// nav onnodig druk.
const BEHEER_ITEM = { href: '/nieuwsplein33/beheer', label: 'Beheer', tel: [] as string[] }

export default function RedactieNav({
  tellingen,
  gebruiker,
}: {
  tellingen: Record<string, number>
  gebruiker: string | null
}) {
  const pathname = usePathname()
  const items = gebruiker === 'jasper' ? [...ITEMS, BEHEER_ITEM] : ITEMS

  return (
    <nav className="np-nav">
      {items.map((item) => {
        const actief = item.href === '/nieuwsplein33' ? pathname === '/nieuwsplein33' : pathname.startsWith(item.href)
        const aantal = item.tel.reduce((som, s) => som + (tellingen[s] ?? 0), 0)
        return (
          <Link key={item.href} href={item.href} className={`np-nav-item${actief ? ' np-nav-item-actief' : ''}`}>
            {item.label}
            {aantal > 0 && <span className="np-nav-tel">{aantal}</span>}
          </Link>
        )
      })}
    </nav>
  )
}
