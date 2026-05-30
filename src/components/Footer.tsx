import Link from 'next/link'

const INFO_LINKS = [
  { label: 'Over Stadsgeest', href: '/over' },
  { label: 'Privacybeleid', href: '/privacy' },
  { label: 'Archief', href: '/archief' },
]

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="footer-title" style={{ textDecoration: 'none', color: 'inherit' }}>
              Stadsgeest 033
            </Link>
            <p className="footer-disc">
              Stadsgeest 033 is een AI-gedreven nieuwssite voor Amersfoort. Artikelen worden samengesteld door kunstmatige intelligentie op basis van openbare bronnen. Altijd transparant over herkomst en werkwijze.
            </p>
          </div>

          <div className="footer-col">
            <span className="footer-col-title">Informatie</span>
            {INFO_LINKS.map((l) => (
              <Link key={l.label} href={l.href} className="footer-link">
                {l.label}
              </Link>
            ))}
          </div>

          <div className="footer-col">
            <span className="footer-col-title">Volg de Geest</span>
            <div className="footer-social">
              <a href="/feed.xml" className="footer-social-btn" title="RSS-feed" aria-label="RSS-feed">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="3" cy="13" r="1.5" fill="currentColor"/>
                  <path d="M3 8.5A4.5 4.5 0 0 1 7.5 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <path d="M3 4A9 9 0 0 1 12 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
