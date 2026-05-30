import { client } from '@/lib/sanity'
import type { Metadata } from 'next'
import Link from 'next/link'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Archief',
  description: 'Alle gepubliceerde artikelen van Stadsgeest 033 in chronologisch overzicht.',
}

interface ArchiefArticle {
  _id: string
  title: string
  slug: { current: string }
  publishedAt: string
  format: string
  tags: { name: string; slug: { current: string } }[]
}

type MonthGroup = Record<string, ArchiefArticle[]>
type YearGroup = Record<string, MonthGroup>

function groupByYearAndMonth(articles: ArchiefArticle[]): YearGroup {
  const years: YearGroup = {}
  for (const a of articles) {
    const date = new Date(a.publishedAt)
    const year = date.getFullYear().toString()
    const month = date.toLocaleDateString('nl-NL', { month: 'long' })
    if (!years[year]) years[year] = {}
    if (!years[year][month]) years[year][month] = []
    years[year][month].push(a)
  }
  return years
}

export default async function ArchiefPage() {
  let articles: ArchiefArticle[] = []
  try {
    articles = await client.fetch<ArchiefArticle[]>(
      `*[_type == "article" && status == "published"] | order(publishedAt desc) [0...500] {
        _id, title, slug, publishedAt, format,
        tags[]->{ name, slug }
      }`,
      {},
      { next: { revalidate: 300 } }
    )
  } catch {
    // Sanity unavailable
  }

  const years = groupByYearAndMonth(articles)
  const yearKeys = Object.keys(years).sort((a, b) => Number(b) - Number(a))

  return (
    <div className="wrap page-in" style={{ paddingTop: 48, paddingBottom: 80 }}>
      <div className="nbh-hdr">
        <h1 className="nbh-title">Archief</h1>
        <p className="nbh-sub">
          Alle {articles.length} gepubliceerde artikelen, gegroepeerd per jaar en maand.
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="empty-state mt8">Nog geen artikelen in het archief.</div>
      ) : (
        <div style={{ marginTop: 32 }}>
          {yearKeys.map((year) => (
            <div key={year} style={{ marginBottom: 56 }}>
              <div style={{
                fontFamily: 'var(--f-d)', fontSize: 28, fontWeight: 700,
                letterSpacing: '-0.02em', color: 'var(--t1)',
                paddingBottom: 16, marginBottom: 24,
                borderBottom: '2px solid var(--border)',
              }}>
                {year}
              </div>

              {Object.entries(years[year]).map(([month, items]) => (
                <div key={month} style={{ marginBottom: 40 }}>
                  <div style={{
                    fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--accent)',
                    marginBottom: 12, paddingBottom: 8,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {month} · {items.length} artikel{items.length !== 1 ? 'en' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {items.map((a) => (
                      <Link
                        key={a._id}
                        href={`/artikel/${a.slug.current}`}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                          gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border-s)',
                          textDecoration: 'none', color: 'inherit',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--f-d)', fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>
                          {a.title}
                        </span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                          {a.tags?.filter(t => t?.slug?.current && t.slug.current !== 'amersfoort').slice(0, 1).map(t => (
                            <span key={t.slug.current} style={{ fontFamily: 'var(--f-m)', fontSize: 10, color: 'var(--t3)', letterSpacing: '0.05em' }}>
                              {t.name}
                            </span>
                          ))}
                          <span style={{ fontFamily: 'var(--f-m)', fontSize: 10, color: 'var(--t3)', letterSpacing: '0.05em' }}>
                            {new Date(a.publishedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
