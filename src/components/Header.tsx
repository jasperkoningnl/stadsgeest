'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

const NAV_ITEMS = [
  { label: 'Politiek', slug: 'politiek' },
  { label: 'Wonen', slug: 'wonen' },
  { label: 'Verkeer', slug: 'verkeer' },
  { label: 'Veiligheid', slug: 'veiligheid' },
  { label: 'Cultuur', slug: 'cultuur' },
  { label: '112', slug: '112' },
]

const WIJKEN = ['Vathorst', 'Binnenstad', 'Soesterkwartier', 'Schothorst', 'Hoogland', 'Liendert']

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const isHome = pathname === '/'
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme') || 'dark'
    setTheme(t as 'dark' | 'light')
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('theme', next) } catch {}
    setTheme(next)
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <div className="header-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              {!isHome && (
                <button className="back-btn" onClick={() => router.back()}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2 L4 7 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Terug
                </button>
              )}
              <Link href="/" className="logo-btn">
                <span className="logo-wordmark">
                  STADSGEEST<em>033</em>
                </span>
              </Link>
              <nav className="header-nav" aria-label="Hoofdnavigatie">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.slug}
                    href={`/tag/${item.slug}`}
                    className="nav-pill"
                    style={item.slug === '112' ? { color: 'var(--error)' } : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="nav-dropdown">
                  <button className="nav-dropdown-btn">
                    Wijken
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 5 L7 9 L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="nav-dropdown-menu">
                    {WIJKEN.map((wijk) => (
                      <Link
                        key={wijk}
                        href={`/wijk/${wijk.toLowerCase()}`}
                        className="nav-dropdown-item"
                      >
                        {wijk}
                      </Link>
                    ))}
                  </div>
                </div>
              </nav>
            </div>
            <div className="header-end">
              <button className="icon-btn" title="Locatie" aria-label="Locatie">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 1.5C6.51 1.5 4.5 3.51 4.5 6c0 3.75 4.5 10.5 4.5 10.5S13.5 9.75 13.5 6c0-2.49-2.01-4.5-4.5-4.5zm0 6.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="icon-btn" onClick={toggleTheme} title="Wissel thema" aria-label="Wissel thema">
                {theme === 'dark' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M11.7 3.2l-1.1 1.1M3.2 11.7l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isHome && (
        <div className="mobile-nav" role="navigation" aria-label="Mobiele navigatie">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.slug}
              href={`/tag/${item.slug}`}
              className="nav-pill"
              style={item.slug === '112' ? { color: 'var(--error)' } : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
