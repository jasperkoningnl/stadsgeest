'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LOGBOEK_GELEZEN_SLEUTEL, LOGBOEK_GEBEURTENIS } from './logboekGelezen'

const ITEMS = [
  { href: '/nieuwsplein33', label: 'Wachtrij', tel: ['wachtrij'] },
  { href: '/nieuwsplein33/behandeling', label: 'Mee bezig', tel: ['goedgekeurd', 'in_behandeling'] },
  { href: '/nieuwsplein33/geparkeerd', label: 'Geparkeerd', tel: ['geparkeerd'] },
  { href: '/nieuwsplein33/archief', label: 'Archief', tel: ['gepubliceerd', 'niet_gebruikt', 'afgekeurd'] },
  { href: '/nieuwsplein33/verkenner', label: 'Verkenner', tel: [] as string[] },
]

// Logboek staat achteraan: wat er is veranderd en waar je iets kunt laten weten.
// Het hoort niet tussen de werkvoorraad, maar wel in het zicht — vandaar het
// stipje zolang de nieuwste regel niet is gelezen.
const LOGBOEK_ITEM = { href: '/nieuwsplein33/logboek', label: 'Logboek', tel: [] as string[] }

// Beheer is bewust alleen voor Jasper: cijfers over de pipeline zelf, niet over
// tips. Andere redactieleden hebben daar niets aan en het maakt de rest van de
// nav onnodig druk.
const BEHEER_ITEM = { href: '/nieuwsplein33/beheer', label: 'Beheer', tel: [] as string[] }

export default function RedactieNav({
  tellingen,
  gebruiker,
  laatsteLogDatum,
}: {
  tellingen: Record<string, number>
  gebruiker: string | null
  laatsteLogDatum: string | null
}) {
  const pathname = usePathname()
  const items = [...ITEMS, LOGBOEK_ITEM, ...(gebruiker === 'jasper' ? [BEHEER_ITEM] : [])]

  // Pas ná hydratatie vergelijken: de server weet niet wat deze browser heeft
  // gelezen, dus zonder dit zou de eerste render niet overeenkomen.
  const [ongelezen, setOngelezen] = useState(false)
  useEffect(() => {
    function meten() {
      if (!laatsteLogDatum) { setOngelezen(false); return }
      let gelezen: string | null = null
      try { gelezen = localStorage.getItem(LOGBOEK_GELEZEN_SLEUTEL) } catch { /* privémodus */ }
      setOngelezen(!gelezen || gelezen < laatsteLogDatum)
    }
    meten()
    window.addEventListener(LOGBOEK_GEBEURTENIS, meten)
    return () => window.removeEventListener(LOGBOEK_GEBEURTENIS, meten)
  }, [laatsteLogDatum])

  return (
    <nav className="np-nav">
      {items.map((item) => {
        const actief = item.href === '/nieuwsplein33' ? pathname === '/nieuwsplein33' : pathname.startsWith(item.href)
        const aantal = item.tel.reduce((som, s) => som + (tellingen[s] ?? 0), 0)
        const stip = item.href === LOGBOEK_ITEM.href && ongelezen
        return (
          <Link key={item.href} href={item.href} className={`np-nav-item${actief ? ' np-nav-item-actief' : ''}`}>
            {item.label}
            {aantal > 0 && <span className="np-nav-tel">{aantal}</span>}
            {stip && <span className="np-nav-stip" title="Er is iets nieuws in het logboek" aria-label="ongelezen" />}
          </Link>
        )
      })}
    </nav>
  )
}
