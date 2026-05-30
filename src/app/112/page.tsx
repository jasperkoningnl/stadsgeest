import { client } from '@/lib/sanity'
import type { Article } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'

export const revalidate = 60

export const metadata: Metadata = {
  title: '112 & Actueel',
  description: 'Real-time incidentmeldingen en urgente stadsberichten uit de regio Amersfoort.',
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Politie:    { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', dot: '#3b82f6' },
  Brandweer:  { bg: 'rgba(239,68,68,0.15)',  text: '#f87171', dot: '#ef4444' },
  Ambulance:  { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80', dot: '#22c55e' },
  Verkeer:    { bg: 'rgba(249,115,22,0.15)', text: '#fb923c', dot: '#f97316' },
}

function getCategory(article: Article): string {
  const tagName = article.tags?.[0]?.name || ''
  if (tagName.toLowerCase().includes('brand')) return 'Brandweer'
  if (tagName.toLowerCase().includes('verkeer')) return 'Verkeer'
  if (tagName.toLowerCase().includes('ambulance') || tagName.toLowerCase().includes('medisch')) return 'Ambulance'
  return 'Politie'
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default async function Page112() {
  const articles = await client.fetch<Article[]>(
    `*[_type == "article" && status == "published" && (
      "112" in tags[]->slug.current ||
      format == "brief"
    )] | order(publishedAt desc) [0...40] {
      _id, title, slug, lead, format, publishedAt,
      tags[]-> { name, slug },
      locations[]-> { name, slug }
    }`,
    {},
    { next: { revalidate: 60 } }
  ).catch(() => [] as Article[])

  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80 }}>

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{
          fontFamily: 'var(--f-d)', fontWeight: 700,
          fontSize: 'clamp(36px,6vw,48px)', letterSpacing: '-0.02em',
          lineHeight: 1.1, marginBottom: 12,
        }}>
          112 &amp; Actueel
        </h1>
        <p style={{ fontFamily: 'var(--f-b)', fontSize: 17, color: 'var(--t2)', maxWidth: 580, lineHeight: 1.65 }}>
          Real-time incidentmeldingen en urgente stadsberichten uit de regio Amersfoort.
          Onze AI-gevoede systemen monitoren lokale hulpdiensten 24/7 voor transparante verslaggeving.
        </p>
      </div>

      {/* Map placeholder */}
      <div style={{
        width: '100%', height: 240, borderRadius: 'var(--r-lg)',
        overflow: 'hidden', border: '1px solid var(--border)',
        background: '#0c0e10', position: 'relative', marginBottom: 32,
      }}>
        <svg width="100%" height="100%" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
          <defs>
            <filter id="dot-glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          {[40,80,120,160,200].map((y,i) => (
            <line key={i} x1="0" y1={y} x2="1200" y2={y} stroke="#45474b" strokeWidth="0.5"/>
          ))}
          {[150,300,450,600,750,900,1050].map((x,i) => (
            <line key={i} x1={x} y1="0" x2={x} y2="240" stroke="#45474b" strokeWidth="0.5"/>
          ))}
          <path d="M0 120 Q300 90 600 120 Q900 150 1200 120" stroke="#46eaed" strokeWidth="1.5" fill="none" opacity="0.4"/>
          <path d="M600 0 Q580 120 600 240" stroke="#46eaed" strokeWidth="1" fill="none" opacity="0.3"/>
          <ellipse cx="600" cy="120" rx="220" ry="90" stroke="#46eaed" strokeWidth="1" fill="none" opacity="0.25"/>
          {/* Incident dots */}
          <circle cx="420" cy="90" r="6" fill="#46eaed" filter="url(#dot-glow)" opacity="0.9"/>
          <circle cx="680" cy="140" r="6" fill="#ef4444" filter="url(#dot-glow)" opacity="0.9"/>
          <circle cx="820" cy="100" r="6" fill="#ffba20" filter="url(#dot-glow)" opacity="0.9"/>
        </svg>

        {/* Live badge */}
        <div style={{
          position: 'absolute', bottom: 12, right: 12,
          background: 'rgba(17,20,21,0.85)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 2s infinite' }} />
          <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em' }}>Live Amersfoort Radius</span>
        </div>
      </div>

      {/* Category filter bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12,
        paddingTop: 16, paddingBottom: 16,
        borderTop: '1px solid rgba(69,71,75,0.3)',
        borderBottom: '1px solid rgba(69,71,75,0.3)',
        marginBottom: 48,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {['Alles', 'Politie', 'Brandweer', 'Ambulance', 'Verkeer'].map((cat) => {
            const c = CATEGORY_COLORS[cat]
            return (
              <span
                key={cat}
                style={{
                  fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500,
                  padding: '6px 16px', borderRadius: 9999, cursor: 'default',
                  background: c ? c.bg : 'var(--bg-raised)',
                  color: c ? c.text : 'var(--t1)',
                  border: `1px solid ${c ? c.bg : 'var(--border)'}`,
                }}
              >
                {cat}
              </span>
            )
          })}
        </div>
      </div>

      {/* Timeline feed */}
      {articles.length > 0 ? (
        <div style={{ position: 'relative' }}>
          {/* Timeline line */}
          <div style={{
            position: 'absolute', left: 0, top: 6, bottom: 0,
            width: 1, background: 'rgba(69,71,75,0.3)',
            display: 'none',
          }} className="feed-timeline-line" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {articles.map((a) => {
              const cat = getCategory(a)
              const c = CATEGORY_COLORS[cat]
              const loc = a.locations?.[0]?.name

              return (
                <div key={a._id} style={{ position: 'relative' }}>
                  <div style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(69,71,75,0.2)',
                    borderRadius: 'var(--r-lg)',
                    padding: '20px 24px',
                    transition: 'border-color 0.2s',
                  }}
                    className="feed-card"
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <span style={{ fontFamily: 'var(--f-m)', fontSize: 12, color: 'var(--accent)', letterSpacing: '0.05em' }}>
                        {formatTime(a.publishedAt)} · {formatDateShort(a.publishedAt)}
                      </span>
                      <span style={{
                        fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.1em', fontWeight: 700,
                        padding: '2px 10px', borderRadius: 9999, textTransform: 'uppercase',
                        background: c.bg, color: c.text, border: `1px solid ${c.bg}`,
                      }}>
                        {cat}
                      </span>
                      {loc && (
                        <span style={{ fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                            <path d="M6.5 1.5a3.5 3.5 0 0 1 3.5 3.5c0 2.5-3.5 6.5-3.5 6.5S3 7.5 3 5a3.5 3.5 0 0 1 3.5-3.5z" stroke="currentColor" strokeWidth="1.2"/>
                          </svg>
                          {loc}
                        </span>
                      )}
                    </div>

                    <Link href={`/artikel/${a.slug.current}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <h3 style={{
                        fontFamily: 'var(--f-d)', fontSize: 18, fontWeight: 600,
                        lineHeight: 1.3, marginBottom: a.lead ? 10 : 0,
                      }}>
                        {a.title}
                      </h3>
                    </Link>

                    {a.lead && (
                      <p style={{ fontFamily: 'var(--f-b)', fontSize: 15, color: 'var(--t2)', lineHeight: 1.65 }}>
                        {a.lead}
                      </p>
                    )}

                    <Link href={`/artikel/${a.slug.current}`} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--accent)',
                      textDecoration: 'none', marginTop: 12,
                    }}>
                      Lees meer →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="empty-state">Geen incidentmeldingen gevonden.</div>
      )}
    </div>
  )
}
