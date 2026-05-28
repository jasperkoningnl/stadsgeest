import Link from 'next/link'

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

const FOOTER_LINKS = ['Over ons', 'Contact', 'Privacy', 'Bronbeleid', 'RSS']

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-row">
          <div className="footer-brand">
            <Link href="/" className="logo-btn" style={{ alignSelf: 'flex-start' }}>
              <LogoIcon />
              <span className="logo-text">
                Stadsgeest <em>033</em>
              </span>
            </Link>
            <p className="footer-disc">
              Stadsgeest 033 is een AI-gedreven nieuwssite. Artikelen worden geschreven door
              kunstmatige intelligentie op basis van openbare bronnen.
            </p>
            <p className="footer-copy">© 2026 Stadsgeest 033 — Amersfoort</p>
          </div>
          <div className="footer-links">
            {FOOTER_LINKS.map((l) => (
              <span key={l} className="footer-link">
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
