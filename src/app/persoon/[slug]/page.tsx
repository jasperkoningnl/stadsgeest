import { client } from '@/lib/sanity'
import { articlesByPersonQuery, personBySlugQuery } from '@/lib/queries'
import type { Article, Person } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const person = await client.fetch<Person | null>(personBySlugQuery, { slug })
  if (!person) return { title: 'Persoon niet gevonden' }
  return {
    title: `${person.name} — Stadsgeest 033`,
    description: `Automatisch gegenereerd dossier voor ${person.name}${person.role ? `, ${person.role}` : ''}.`,
  }
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('nl-NL', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).toUpperCase()
}

const TAG_COLORS: Record<string, string> = {
  Wonen: 'var(--accent)',
  Politiek: 'var(--accent)',
  Verkeer: 'var(--amber)',
  Veiligheid: 'var(--amber)',
  Cultuur: 'var(--accent)',
}

export default async function PersoonPage({ params }: Props) {
  const { slug } = await params
  const [person, articles] = await Promise.all([
    client.fetch<(Person & { articleCount?: number; notes?: string }) | null>(
      personBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    ),
    client.fetch<Article[]>(
      articlesByPersonQuery,
      { personSlug: slug },
      { next: { revalidate: 60 } }
    ),
  ])

  if (!person) notFound()

  const mainTag = articles[0]?.tags?.[0]?.name || 'Nieuws'
  const initials = person.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80 }}>

      {/* ── Profile header ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'flex-end', marginBottom: 48 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{
              fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '4px 12px', borderRadius: 9999,
              background: 'var(--accent-dim)', color: 'var(--accent)',
              border: '1px solid rgba(70,234,237,0.25)',
            }}>
              OFFICIEEL PROFIEL
            </span>
            <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              ID: AMF-033-{slug.slice(0, 6).toUpperCase()}
            </span>
          </div>
          <h1 style={{
            fontFamily: 'var(--f-d)', fontWeight: 700,
            fontSize: 'clamp(32px, 5vw, 48px)', letterSpacing: '-0.02em',
            lineHeight: 1.08, marginBottom: 8,
          }}>
            {person.name}
          </h1>
          {person.role && (
            <p style={{ fontFamily: 'var(--f-d)', fontSize: 20, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
              {person.role}
            </p>
          )}
          {person.orgName && (
            <p style={{ fontFamily: 'var(--f-m)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>
              {person.orgName}
            </p>
          )}
        </div>

        {/* Avatar */}
        <div style={{
          width: 120, height: 120, borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          filter: 'grayscale(1)',
        }}>
          <span style={{ fontFamily: 'var(--f-d)', fontSize: 32, fontWeight: 700, color: 'var(--t3)' }}>
            {initials}
          </span>
        </div>
      </div>

      {/* ── Dashboard grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 32,
        paddingTop: 32,
        borderTop: '1px solid var(--border)',
      }}
        className="persoon-grid"
      >
        <style>{`
          @media (min-width: 900px) {
            .persoon-grid { grid-template-columns: 280px 1fr !important; }
          }
        `}</style>

        {/* Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* AI dossier card */}
          <div style={{
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 'var(--r-xl)',
            padding: 24,
          }}>
            <h3 style={{ fontFamily: 'var(--f-d)', fontSize: 16, fontWeight: 600, color: 'var(--accent)', marginBottom: 12 }}>
              AI Dossier-analyse
            </h3>
            {person.notes && (
              <p style={{ fontFamily: 'var(--f-b)', fontStyle: 'italic', fontSize: 14, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 20 }}>
                "{person.notes}"
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>Vermeldingen</span>
                <span style={{ fontFamily: 'var(--f-d)', fontSize: 22, fontWeight: 600 }}>{person.articleCount ?? articles.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>Hoofdonderwerp</span>
                <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, background: 'var(--surface-highest)', padding: '3px 8px', borderRadius: 'var(--r)' }}>
                  {mainTag}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>Status</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', animation: 'pulse 2s infinite' }} />
                  Actief
                </span>
              </div>
            </div>
          </div>

          {/* Related entities */}
          {(articles.flatMap(a => a.tags || []).length > 0) && (
            <div style={{ padding: 20, border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
              <div style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 12 }}>
                Gerelateerde thema's
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[...new Map(
                  articles.flatMap(a => a.tags || []).map(t => [t.name, t])
                ).values()].slice(0, 6).map((t) => (
                  <Link
                    key={t.slug.current}
                    href={`/tag/${t.slug.current}`}
                    style={{
                      fontFamily: 'var(--f-m)', fontSize: 11,
                      padding: '4px 10px', borderRadius: 'var(--r)',
                      background: 'var(--primary-container)',
                      color: 'var(--primary)',
                      border: '1px solid var(--border)',
                      textDecoration: 'none',
                    }}
                  >
                    {t.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Timeline */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
            <h2 style={{ fontFamily: 'var(--f-d)', fontSize: 24, fontWeight: 600 }}>
              Automatisch gegenereerd dossier
            </h2>
            <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>
              {articles.length} resultaten
            </span>
          </div>

          {articles.length > 0 ? (
            <div style={{ position: 'relative', paddingLeft: 32 }}>
              {/* Timeline line */}
              <div style={{
                position: 'absolute', left: 0, top: 6, bottom: 0,
                width: 1, background: 'var(--border)',
              }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                {articles.map((a, i) => {
                  const tagColor = TAG_COLORS[a.tags?.[0]?.name || ''] || 'var(--accent)'
                  return (
                    <article key={a._id} style={{ position: 'relative' }}>
                      {/* Timeline node */}
                      <div style={{
                        position: 'absolute', left: -36, top: 4,
                        width: 14, height: 14, borderRadius: '50%',
                        background: 'var(--bg)',
                        border: `2px solid ${i === 0 ? 'var(--primary)' : 'var(--border)'}`,
                      }} />

                      <time style={{ fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: 'var(--amber)', display: 'block', marginBottom: 8 }}>
                        {formatDateShort(a.publishedAt)}
                      </time>

                      <Link href={`/artikel/${a.slug.current}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                        <h3 style={{
                          fontFamily: 'var(--f-d)', fontSize: 20, fontWeight: 600,
                          lineHeight: 1.28, letterSpacing: '-0.01em',
                          marginBottom: 10, cursor: 'pointer',
                          transition: 'color .15s',
                        }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '')}
                        >
                          {a.title}
                        </h3>
                      </Link>

                      {a.lead && (
                        <p style={{ fontFamily: 'var(--f-b)', fontSize: 15, color: 'var(--t2)', lineHeight: 1.65, maxWidth: 640 }}>
                          {a.lead}
                        </p>
                      )}

                      <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        {a.tags?.slice(0, 2).map(t => (
                          <Link
                            key={t.slug.current}
                            href={`/tag/${t.slug.current}`}
                            style={{ fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500, color: tagColor, textDecoration: 'none', letterSpacing: '0.04em' }}
                          >
                            #{t.name}
                          </Link>
                        ))}
                        <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)' }}>
                          {Math.max(2, Math.ceil((a.lead?.split(' ').length || 100) / 200) + 2)} min leestijd
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              Geen artikelen gevonden voor {person.name}.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
