import { client } from '@/lib/sanity'
import { allLocationsWithCountQuery } from '@/lib/queries'
import type { Metadata } from 'next'
import Link from 'next/link'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Wijken — Stadsgeest 033',
  description: 'Navigeer door de haarvaten van Amersfoort. Real-time data en journalistieke diepgang voor elke buurt.',
}

interface LocationWithCount {
  name: string
  slug: { current: string }
  type: string
  count: number
}

export default async function WijkenPage() {
  const locations = await client.fetch<LocationWithCount[]>(
    allLocationsWithCountQuery,
    {},
    { next: { revalidate: 300 } }
  ).catch(() => [] as LocationWithCount[])

  const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name, 'nl'))

  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80 }}>

      {/* Title */}
      <div style={{ marginBottom: 48 }}>
        <h1 style={{
          fontFamily: 'var(--f-d)', fontWeight: 700,
          fontSize: 'clamp(36px,6vw,48px)', letterSpacing: '-0.02em',
          lineHeight: 1.1, marginBottom: 12,
        }}>
          Wijken
        </h1>
        <p style={{ fontFamily: 'var(--f-b)', fontSize: 17, color: 'var(--t2)', maxWidth: 560, lineHeight: 1.65 }}>
          Navigeer door de haarvaten van Amersfoort. Real-time data en journalistieke diepgang voor elke buurt.
        </p>
      </div>

      {/* Map hero */}
      <section style={{ marginBottom: 64 }}>
        <div style={{
          width: '100%', height: 400, borderRadius: 'var(--r-lg)',
          overflow: 'hidden', border: '1px solid var(--border)',
          background: 'var(--bg-raised)', position: 'relative',
        }}>
          {/* Teal glow map SVG */}
          <svg width="100%" height="100%" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              <radialGradient id="bg-grad" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="#46eaed" stopOpacity="0.05"/>
                <stop offset="100%" stopColor="#111415" stopOpacity="0"/>
              </radialGradient>
            </defs>
            <rect width="1200" height="400" fill="#0c0e10"/>
            <rect width="1200" height="400" fill="url(#bg-grad)"/>
            {/* City street grid */}
            {[60,120,180,240,300,340].map((y,i) => (
              <line key={`h${i}`} x1="0" y1={y} x2="1200" y2={y} stroke="#46eaed" strokeWidth="0.4" opacity="0.15"/>
            ))}
            {[150,300,450,600,750,900,1050].map((x,i) => (
              <line key={`v${i}`} x1={x} y1="0" x2={x} y2="400" stroke="#46eaed" strokeWidth="0.4" opacity="0.15"/>
            ))}
            {/* Main roads */}
            <path d="M0 200 Q300 160 600 200 Q900 240 1200 200" stroke="#46eaed" strokeWidth="1.5" fill="none" filter="url(#glow)" opacity="0.7"/>
            <path d="M600 0 Q580 200 600 400" stroke="#46eaed" strokeWidth="1.5" fill="none" filter="url(#glow)" opacity="0.5"/>
            <path d="M200 0 Q300 200 200 400" stroke="#46eaed" strokeWidth="1" fill="none" opacity="0.3"/>
            <path d="M1000 0 Q950 200 1000 400" stroke="#46eaed" strokeWidth="1" fill="none" opacity="0.3"/>
            <path d="M0 100 Q400 80 800 150 L1200 100" stroke="#46eaed" strokeWidth="0.8" fill="none" opacity="0.25"/>
            <path d="M0 300 Q400 320 800 280 L1200 300" stroke="#46eaed" strokeWidth="0.8" fill="none" opacity="0.25"/>
            {/* Ring road */}
            <ellipse cx="600" cy="200" rx="280" ry="140" stroke="#46eaed" strokeWidth="1.8" fill="none" filter="url(#glow)" opacity="0.5"/>
          </svg>

          {/* Overlay badge */}
          <div style={{
            position: 'absolute', top: 20, left: 20,
            background: 'rgba(30,32,33,0.8)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(197,198,203,0.1)', borderRadius: 'var(--r-xl)',
            padding: '12px 16px',
          }}>
            <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
              STADSOVERZICHT
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 2s infinite', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--f-d)', fontSize: 14, fontWeight: 500 }}>
                {sorted.length} Actieve wijken
              </span>
            </div>
          </div>

          {/* Hover card preview */}
          <div style={{
            position: 'absolute', bottom: 24, right: 24,
            background: 'rgba(30,32,33,0.8)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(70,234,237,0.2)', borderRadius: 'var(--r-xl)',
            padding: 20, maxWidth: 220,
          }}>
            <h3 style={{ fontFamily: 'var(--f-d)', fontSize: 18, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>
              Binnenstad
            </h3>
            <p style={{ fontFamily: 'var(--f-b)', fontSize: 14, color: 'var(--t2)', marginBottom: 12, lineHeight: 1.5 }}>
              Focus: Herinrichting Hof en mobiliteitsplan 2030.
            </p>
            <Link href="/wijk/binnenstad" style={{ fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              Bekijk wijk →
            </Link>
          </div>
        </div>
      </section>

      {/* Buurt Dossiers grid */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'var(--f-d)', fontSize: 28, fontWeight: 600 }}>Buurt Dossiers</h2>
          <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {sorted.length} wijken
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {sorted.map((loc) => (
            <Link
              key={loc.slug.current}
              href={`/wijk/${loc.slug.current}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="wijk-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <h3 style={{ fontFamily: 'var(--f-d)', fontSize: 20, fontWeight: 600 }}>{loc.name}</h3>
                  {loc.count > 0 && (
                    <span style={{
                      fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.08em',
                      background: 'rgba(70,234,237,0.1)', color: 'var(--accent)',
                      padding: '3px 8px', borderRadius: 'var(--r)', flexShrink: 0, marginLeft: 8,
                    }}>
                      {loc.count} ARTIKELEN
                    </span>
                  )}
                </div>
                <p style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Laatste nieuws
                </p>
                <p style={{ fontFamily: 'var(--f-b)', fontStyle: 'italic', fontSize: 14, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 16 }}>
                  {loc.count > 0
                    ? `Bekijk alle ${loc.count} artikel${loc.count !== 1 ? 'en' : ''} over ${loc.name}.`
                    : 'Nog geen artikelen beschikbaar voor deze wijk.'}
                </p>
                <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em', color: 'var(--primary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  BEKIJK WIJK ↗
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* AI Insights module */}
      <section style={{
        marginTop: 80, padding: '48px 40px',
        background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)', borderRadius: 'var(--r-xl)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', maxWidth: 640 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16,
            background: 'rgba(255,186,32,0.12)', color: 'var(--amber)',
            padding: '4px 12px', borderRadius: 9999,
          }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
              <path d="M7 1 L8.2 4.5 L12 4.5 L9 6.7 L10.2 10.2 L7 8 L3.8 10.2 L5 6.7 L2 4.5 L5.8 4.5 Z"/>
            </svg>
            <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em' }}>STADSGEEST AI ANALYSE</span>
          </div>
          <h2 style={{ fontFamily: 'var(--f-d)', fontSize: 28, fontWeight: 600, marginBottom: 16 }}>
            Trendverschuiving: Noord vs. Zuid
          </h2>
          <p style={{ fontFamily: 'var(--f-b)', fontSize: 17, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 20 }}>
            Onze algoritmen signaleren een toename in burgerinitiatieven rondom deelmobiliteit in Vathorst en Nieuwland,
            terwijl de Binnenstad momenteel worstelt met geluidsoverlast die boven het jaargemiddelde ligt.
          </p>
          <Link href="/nieuws" style={{ fontFamily: 'var(--f-d)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Lees alle analyses →
          </Link>
        </div>
      </section>
    </div>
  )
}
