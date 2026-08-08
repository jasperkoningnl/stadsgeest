'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/nieuwsplein33', label: 'Wachtrij', tel: ['wachtrij'] },
  { href: '/nieuwsplein33/behandeling', label: 'Mee bezig', tel: ['goedgekeurd', 'in_behandeling'] },
  { href: '/nieuwsplein33/geparkeerd', label: 'Geparkeerd', tel: ['geparkeerd'] },
  { href: '/nieuwsplein33/archief', label: 'Archief', tel: ['gepubliceerd', 'niet_gebruikt', 'afgekeurd'] },
]

export default function RedactieNav({ tellingen }: { tellingen: Record<string, number> }) {
  const pathname = usePathname()

  return (
    <nav className="np-nav">
      {ITEMS.map((item) => {
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
