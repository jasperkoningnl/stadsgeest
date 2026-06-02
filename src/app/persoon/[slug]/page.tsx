import { client, urlFor } from '@/lib/sanity'
import { personBySlugQuery } from '@/lib/queries'
import type { Person, SanityImage, SanitySlug, Tag } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

type ArticleItem = {
  _id: string
  title: string
  slug: SanitySlug
  lead?: string
  publishedAt: string
  format: string
  tags?: Tag[]
}

type PersonData = Person & {
  photo?: SanityImage
  party?: string
  totalMentions?: number
  articles?: ArticleItem[]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  let person: PersonData | null = null
  try {
    person = await client.fetch<PersonData | null>(personBySlugQuery, { slug })
  } catch {
    return { title: 'Persoon niet gevonden' }
  }
  if (!person) return { title: 'Persoon niet gevonden' }
  return {
    title: `${person.name} — Stadsgeest 033`,
    description: `Automatisch gegenereerd dossier voor ${person.name}${person.role ? `, ${person.role}` : ''}.`,
    alternates: { canonical: `${SITE_URL}/persoon/${slug}` },
  }
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('nl-NL', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).toUpperCase()
}

function estimateReadTime(lead?: string): number {
  if (!lead) return 3
  return Math.max(2, Math.ceil(lead.split(' ').length / 200) + 2)
}

export default async function PersoonPage({ params }: Props) {
  const { slug } = await params

  let person: PersonData | null = null
  try {
    person = await client.fetch<PersonData | null>(
      personBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    )
  } catch {
    // Sanity unavailable — person stays null, triggering notFound below
  }

  if (!person) notFound()

  const articles = person.articles ?? []
  const initials = person.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const mainTag = articles[0]?.tags?.[0]?.name ?? 'Nieuws'
  const totalMentions = person.totalMentions ?? articles.length

  const relatedEntities = [
    ...new Map(
      articles.flatMap(a => a.tags ?? []).map(t => [t.slug.current, t])
    ).values(),
  ].slice(0, 8)

  const photoUrl = person.photo?.asset
    ? urlFor(person.photo).width(384).height(384).fit('crop').url()
    : null

  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80 }}>
      <style>{`
        .person-photo-wrap { filter: grayscale(1); transition: filter 0.5s ease; }
        .person-photo-wrap:hover { filter: grayscale(0); }
        @media (min-width: 900px) {
          .persoon-grid { grid-template-columns: 300px 1fr !important; }
          .person-photo-wrap { width: 192px !important; height: 192px !important; }
        }
        .timeline-dot-first { border-color: var(--primary) !important; }
        .timeline-dot-first:hover { background: var(--primary) !important; }
        .timeline-article:hover .timeline-dot { background: var(--bg-raised); }
        .load-more-btn:hover { background: var(--bg-card); }
        .timeline-title:hover { color: var(--accent); }
      `}</style>

      {/* ── Profile header ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 24,
        alignItems: 'flex-end',
        marginBottom: 48,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{
              fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '4px 12px', borderRadius: 9999,
              background: 'rgba(70,234,237,0.10)', color: 'var(--accent)',
              border: '1px solid rgba(70,234,237,0.25)',
            }}>
              OFFICIEEL PROFIEL
            </span>
            <span style={{
              fontFamily: 'var(--f-m)', fontSize: 11,
              color: 'var(--t3)', letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              ID: AMF-033-{slug.slice(0, 6).toUpperCase()}
            </span>
          </div>

          <h1 style={{
            fontFamily: 'var(--f-d)', fontWeight: 700,
            fontSize: 'clamp(32px, 5vw, 48px)',
            letterSpacing: '-0.02em', lineHeight: 1.08,
            marginBottom: 8,
          }}>
            {person.name}
          </h1>

          {person.role && (
            <p style={{
              fontFamily: 'var(--f-d)', fontSize: 20, fontWeight: 600,
              color: 'var(--primary)', marginBottom: 4,
            }}>
              {person.role}
            </p>
          )}

          {person.orgName && (
            <p style={{
              fontFamily: 'var(--f-m)', fontSize: 12,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--t3)',
            }}>
              {person.orgName}
            </p>
          )}
        </div>

        {/* Photo / Initials avatar */}
        <div className="person-photo-wrap" style={{
          width: 128, height: 128,
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={person.photo?.alt ?? person.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <span style={{
              fontFamily: 'var(--f-d)', fontSize: 36, fontWeight: 700, color: 'var(--t3)',
            }}>
              {initials}
            </span>
          )}
        </div>
      </div>

      {/* ── Dashboard grid ── */}
      <div
        className="persoon-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 32,
          paddingTop: 32,
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* AI dossier card */}
          <div style={{
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 'var(--r-xl)',
            padding: 24,
          }}>
            <h3 style={{
              fontFamily: 'var(--f-d)', fontSize: 16, fontWeight: 600,
              color: 'var(--accent)', marginBottom: 12,
            }}>
              AI Dossier-analyse
            </h3>

            {person.notes && (
              <p style={{
                fontFamily: 'var(--f-b)', fontStyle: 'italic',
                fontSize: 14, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 20,
              }}>
                &ldquo;{person.notes}&rdquo;
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontFamily: 'var(--f-m)', fontSize: 11,
                  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)',
                }}>
                  TOTAAL AANTAL VERMELDINGEN
                </span>
                <span style={{ fontFamily: 'var(--f-d)', fontSize: 22, fontWeight: 600 }}>
                  {totalMentions}
                </span>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontFamily: 'var(--f-m)', fontSize: 11,
                  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)',
                }}>
                  HOOFDONDERWERP
                </span>
                <span style={{
                  fontFamily: 'var(--f-m)', fontSize: 11,
                  background: 'var(--surface-highest)',
                  padding: '3px 8px', borderRadius: 'var(--r)',
                }}>
                  {mainTag}
                </span>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0',
              }}>
                <span style={{
                  fontFamily: 'var(--f-m)', fontSize: 11,
                  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t3)',
                }}>
                  STATUS
                </span>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500,
                  color: 'var(--amber)',
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--amber)', animation: 'pulse 2s infinite',
                  }} />
                  Actief
                </span>
              </div>
            </div>
          </div>

          {/* Related entities */}
          {relatedEntities.length > 0 && (
            <div style={{
              padding: 20,
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-xl)',
            }}>
              <div style={{
                fontFamily: 'var(--f-m)', fontSize: 11,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--t3)', marginBottom: 12,
              }}>
                GERELATEERDE ENTITEITEN
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {relatedEntities.map((t) => (
                  <Link
                    key={t.slug.current}
                    href={`/tag/${t.slug.current}`}
                    style={{
                      fontFamily: 'var(--f-m)', fontSize: 11,
                      padding: '4px 10px', borderRadius: 'var(--r)',
                      background: 'var(--primary-container)',
                      color: 'var(--primary)',
                      border: '1px solid var(--border)',
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
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 32,
          }}>
            <h2 style={{ fontFamily: 'var(--f-d)', fontSize: 24, fontWeight: 600 }}>
              Automatisch gegenereerd dossier
            </h2>
            <span style={{
              fontFamily: 'var(--f-m)', fontSize: 11,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'var(--t3)',
            }}>
              {articles.length} resultaten
            </span>
          </div>

          {articles.length > 0 ? (
            <>
              <div style={{ position: 'relative', paddingLeft: 32 }}>
                {/* Vertical timeline line */}
                <div style={{
                  position: 'absolute', left: 0, top: 6, bottom: 0,
                  width: 1, background: 'var(--border)',
                }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                  {articles.map((a, i) => {
                    const tagColor = a.tags?.[0]?.name
                      ? 'var(--accent)'
                      : 'var(--accent)'

                    return (
                      <article
                        key={a._id}
                        className="timeline-article"
                        style={{ position: 'relative' }}
                      >
                        {/* Timeline dot */}
                        <div
                          className={`timeline-dot${i === 0 ? ' timeline-dot-first' : ''}`}
                          style={{
                            position: 'absolute', left: -36, top: 5,
                            width: 14, height: 14, borderRadius: '50%',
                            background: 'var(--bg)',
                            border: `2px solid ${i === 0 ? 'var(--primary)' : 'var(--border)'}`,
                            transition: 'background 0.3s',
                          }}
                        />

                        <time style={{
                          fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500,
                          letterSpacing: '0.06em', color: 'var(--amber)',
                          display: 'block', marginBottom: 8,
                        }}>
                          {formatDateShort(a.publishedAt)}
                        </time>

                        <Link href={`/artikel/${a.slug.current}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h3 className="timeline-title" style={{
                            fontFamily: 'var(--f-d)', fontSize: 20, fontWeight: 600,
                            lineHeight: 1.28, letterSpacing: '-0.01em',
                            marginBottom: 10, transition: 'color 0.15s',
                          }}>
                            {a.title}
                          </h3>
                        </Link>

                        {a.lead && (
                          <p style={{
                            fontFamily: 'var(--f-b)', fontSize: 15,
                            color: 'var(--t2)', lineHeight: 1.65, maxWidth: 640,
                          }}>
                            {a.lead}
                          </p>
                        )}

                        <div style={{
                          marginTop: 10, display: 'flex', gap: 12,
                          alignItems: 'center', flexWrap: 'wrap',
                        }}>
                          {a.tags?.slice(0, 2).map(t => (
                            <Link
                              key={t.slug.current}
                              href={`/tag/${t.slug.current}`}
                              style={{
                                fontFamily: 'var(--f-m)', fontSize: 11, fontWeight: 500,
                                color: tagColor, letterSpacing: '0.04em',
                              }}
                            >
                              #{t.name}
                            </Link>
                          ))}
                          <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)' }}>
                            {estimateReadTime(a.lead)} min leestijd
                          </span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>

              <div style={{ marginTop: 48, display: 'flex', justifyContent: 'center' }}>
                <button
                  className="load-more-btn"
                  style={{
                    padding: '16px 32px',
                    border: '1px solid var(--border)',
                    background: 'none',
                    borderRadius: 'var(--r)',
                    fontFamily: 'var(--f-m)', fontSize: 11,
                    fontWeight: 500, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--primary)',
                    cursor: 'pointer', transition: 'background 0.2s',
                  }}
                >
                  Laad meer resultaten
                </button>
              </div>
            </>
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
