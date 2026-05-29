'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

const NAV_ITEMS = [
  { label: 'Nieuws', slug: null, href: '/nieuws' },
  { label: 'Politiek', slug: 'politiek' },
  { label: 'Wonen', slug: 'wonen' },
  { label: 'Verkeer', slug: 'verkeer' },
  { label: 'Veiligheid', slug: 'veiligheid' },
  { label: 'Cultuur', slug: 'cultuur' },
  { label: '112', slug: null, href: '/112' },
]


interface NavTag {
  name: string
  slug: { current: string }
  count: number
}

function LogoWordmark() {
  return (
    <span className="logo-wordmark">
      STADSGEEST<em>033</em>
    </span>
  )
}

export default function Header({ navTags }: { navTags?: NavTag[] }) {
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

  // Build nav items: always start with Nieuws, then dynamic tags or fallback static tags
  const dynamicTags = navTags && navTags.length > 0
    ? navTags.filter((t) => t.count > 0)
    : null

  const navLinks = dynamicTags
    ? [
        { label: 'Nieuws', slug: null as string | null, href: '/nieuws' as string | null },
        ...dynamicTags.map((t) => ({
          label: t.name.charAt(0).toUpperCase() + t.name.slice(1),
          slug: t.slug.current,
          href: t.slug.current === '112' ? '/112' : null as string | null,
        })),
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
                <LogoWordmark />
              </Link>
              <nav className="header-nav" aria-label="Hoofdnavigatie">
                {navLinks.map((item) => {
                  const href = item.href ?? `/tag/${item.slug}`
                  const is112 = item.slug === '112' || href === '/112'
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
