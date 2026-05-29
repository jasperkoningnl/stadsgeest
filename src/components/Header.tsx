'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

const NAV_ITEMS = [
  { label: 'Nieuws', slug: null, href: '/nieuws' },
  { label: 'Politiek', slug: 'politiek' },
  { label: 'Wonen', slug: 'wonen' },
  { label: 'Verkeer', slug: 'verkeer' },
  { label: 'Veiligheid', slug: 'veiligheid' },
  { label: 'Cultuur', slug: 'cultuur' },
  { label: '112', slug: '112' },
]

const WIJKEN = ['Vathorst', 'Binnenstad', 'Soesterkwartier', 'Schothorst', 'Hoogland', 'Liendert']

interface NavTag {
  name: string
  slug: { current: string }
  count: number
}

function LogoIcon() {
  return (
    <svg width="15" height="22" viewBox="0 0 15 22" fill="none" className="logo-icon" aria-hidden="true">
      <circle cx="7.5" cy="1.8" r="1.4" fill="currentColor" />
      <path d="M3 9 L7.5 3.2 L12 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
      <rect x="3" y="9" width="9" height="12" stroke="currentColor" strokeWidth="1.6" rx="1" fill="none" />
      <path d="M5.5 21 L5.5 17.5 Q5.5 15.5 7.5 15.5 Q9.5 15.5 9.5 17.5 L9.5 21" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  )
}

export default function Header({ navTags }: { navTags?: NavTag[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const isHome = pathname === '/'
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [wijkenOpen, setWijkenOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme') || 'dark'
    setTheme(t as 'dark' | 'light')
  }, [])

  useEffect(() => {
    function handleMousedown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWijkenOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMousedown)
    return () => document.removeEventListener('mousedown', handleMousedown)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('theme', next) } catch {}
    setTheme(next)
  }

  // Build nav items: always start with Nieuws, then dynamic tags or fallback static tags
  const dynamicTags = navTags && navTags.length > 0
    ? navTags.filter((t) => t.count > 0)
    : null

  const navLinks = dynamicTags
    ? [
        { label: 'Nieuws', slug: null as string | null, href: '/nieuws' as string | null },
        ...dynamicTags.map((t) => ({ label: t.name, slug: t.slug.current, href: null as string | null })),
      ]
    : NAV_ITEMS.map((item) => ({
        label: item.label,
        slug: item.slug as string | null ?? null,
        href: (item as { href?: string }).href ?? null,
      }))

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <div className="header-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', position: 'relative' }}>
              {!isHome && (
                <button
                  className="back-btn"
                  onClick={() => router.back()}
                  style={{ position: 'absolute', left: 0, whiteSpace: 'nowrap' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2 L4 7 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Terug
                </button>
              )}
              <Link href="/" className="logo-btn" style={!isHome ? { marginLeft: 70 } : {}}>
                <LogoIcon />
                <span className="logo-text">
                  Stadsgeest <em>033</em>
                </span>
              </Link>
              <nav className="header-nav" aria-label="Hoofdnavigatie">
                {navLinks.map((item) => {
                  const href = item.href ?? `/tag/${item.slug}`
                  const is112 = item.slug === '112'
                  return (
                    <Link
                      key={item.label}
                      href={href}
                      className={`nav-pill${is112 ? ' nav-112' : ''}`}
                      style={is112 ? { color: 'var(--error)' } : undefined}
                    >
                      {item.label}
                    </Link>
                  )
                })}
                <div className="nav-dropdown" ref={dropdownRef}>
                  <button
                    className="nav-dropdown-btn nav-pill"
                    onClick={() => setWijkenOpen((o) => !o)}
                    aria-expanded={wijkenOpen}
                  >
                    Wijken
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 5 L7 9 L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="nav-dropdown-menu" style={{ display: wijkenOpen ? 'block' : 'none' }}>
                    {WIJKEN.map((wijk) => (
                      <Link
                        key={wijk}
                        href={`/wijk/${wijk.toLowerCase()}`}
                        className="nav-dropdown-item"
                        onClick={() => setWijkenOpen(false)}
                      >
                        {wijk}
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>
            </div>
            <div className="header-end">
              <button className="icon-btn" onClick={toggleTheme} title="Wissel thema" aria-label="Wissel thema">
                {theme === 'dark' ? (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <circle cx="6.5" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M6.5 1v1M6.5 11v1M1 6.5h1M11 6.5h1M2.7 2.7l.7.7M9.6 9.6l.7.7M9.6 2.7l-.7.7M2.7 9.6l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path d="M11 7.5A5 5 0 0 1 5.5 2a5 5 0 1 0 5.5 5.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isHome && (
        <div className="mobile-nav" role="navigation" aria-label="Mobiele navigatie">
          {navLinks.map((item) => {
            const href = item.href ?? `/tag/${item.slug}`
            const is112 = item.slug === '112'
            return (
              <Link
                key={item.label}
                href={href}
                className={`nav-pill${is112 ? ' nav-112' : ''}`}
                style={is112 ? { color: 'var(--error)' } : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
