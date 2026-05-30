import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pagina niet gevonden',
}

export default function NotFound() {
  return (
    <div className="wrap page-in" style={{ paddingTop: 80, paddingBottom: 120, maxWidth: 560 }}>
      <div style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 16 }}>
        404
      </div>
      <h1 style={{ fontFamily: 'var(--f-s)', fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: 600, lineHeight: 1.2, color: 'var(--t1)', marginBottom: 16 }}>
        Pagina niet gevonden
      </h1>
      <p style={{ fontFamily: 'var(--f-d)', fontSize: 16, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 32 }}>
        De pagina die u zoekt bestaat niet of is verplaatst.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Naar de homepage
        </Link>
        <Link href="/nieuws" style={{ fontFamily: 'var(--f-d)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
          Alle berichten →
        </Link>
      </div>
    </div>
  )
}
