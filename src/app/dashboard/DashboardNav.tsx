'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard/persberichten', label: 'Persberichten' },
  { href: '/dashboard', label: 'Vandaag' },
  { href: '/dashboard/bronnen', label: 'Bronnen' },
  { href: '/dashboard/intake', label: 'Intake' },
  { href: '/dashboard/signalen', label: 'Signalen' },
  { href: '/dashboard/dwarsverbanden', label: 'Dwarsverbanden' },
]

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="dash-nav">
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href} className={`dash-nav-item${active ? ' dash-nav-item-active' : ''}`}>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
