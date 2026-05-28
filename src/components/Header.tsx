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
            {!isHome && (
              <button className="back-btn" onClick={() => router.back()}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 2 L4 7 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Terug
              </button>
            )}
            <Link href="/" className="logo-btn">
              <LogoIcon />
              <span className="logo-text">
                Stadsgeest <em>033</em>
              </span>
            </Link>
            <nav className="header-nav" aria-label="Hoofdnavigatie">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.slug}
                  href={`/tag/${item.slug}`}
                  className={`nav-pill${item.slug === '112' ? ' nav-112' : ''}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="header-end">
              <Link href="/wijk/vathorst" className="icon-btn">
                Wijken
              </Link>
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
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.slug}
              href={`/tag/${item.slug}`}
              className={`nav-pill${item.slug === '112' ? ' nav-112' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
