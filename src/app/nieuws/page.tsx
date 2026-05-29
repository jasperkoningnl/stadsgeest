import { client, urlFor } from '@/lib/sanity'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { FORMAT_LABELS } from '@/lib/utils'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Alle berichten',
  description: 'Overzicht van alle gepubliceerde berichten van Stadsgeest 033',
}

const PAGE_SIZE = 30

interface Props {
  searchParams: Promise<{ page?: string }>
}

export default async function NieuwsPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam || '1', 10))
  const offset = (page - 1) * PAGE_SIZE
  const limit = page * PAGE_SIZE

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let articles: any[] = []
  let total = 0

  try {
    ;[articles, total] = await Promise.all([
      client.fetch(
        `*[_type == "article" && status == "published"] | order(publishedAt desc) [$offset...$limit] {
          _id, title, slug, lead, format, publishedAt, tags[]->{ name, slug }, mainImage { asset->, alt }
        }`,
        { offset, limit },
        { next: { revalidate: 60 } }
      ),
      client.fetch(
        `count(*[_type == "article" && status == "published"])`,
        {},
        { next: { revalidate: 60 } }
      ),
    ])
  } catch {
    // Sanity unavailable
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="wrap page-in">
      <div className="nbh-hdr">
        <div className="crumb">
          <Link href="/" className="crumb-link">Stadsgeest 033</Link>
          <span>›</span>
          <span>Nieuws</span>
        </div>
        <h1 className="nbh-title">Alle berichten</h1>
        <p className="nbh-sub">Alle gepubliceerde berichten, meest recent bovenaan.</p>
      </div>

      {articles.length > 0 ? (
        <div className="art-list mt8">
          {articles.map((a) => (
            <Link key={a._id} href={`/artikel/${a.slug?.current}`} className="art-list-item">
              {a.mainImage && (
                <div className="art-list-thumb" style={{ marginTop: 22 }}>
                  <Image
                    src={urlFor(a.mainImage).width(240).height(160).url()}
                    alt={a.mainImage.alt || ''}
                    fill
                    sizes="120px"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
              )}
              <div className="art-list-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--accent)',
                    padding: '2px 6px', borderRadius: 2, background: 'var(--accent-dim)',
                  }}>
                    {FORMAT_LABELS[a.format] || 'Nieuws'}
                  </span>
                  <span style={{ fontFamily: 'var(--f-d)', fontSize: 12, color: 'var(--t3)' }}>
                    {new Date(a.publishedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="art-list-title">{a.title}</div>
                {a.lead && (
                  <div className="art-list-lead" style={{
                    display: '-webkit-box', WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {a.lead}
                  </div>
                )}
                {a.tags && a.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {a.tags.filter((t: { slug: { current: string } }) => t.slug?.current !== 'amersfoort').map((t: { name: string; slug: { current: string } }) => (
                      <span key={t.slug?.current} style={{
                        fontFamily: 'var(--f-d)', fontSize: 12, color: 'var(--t3)',
                        padding: '1px 6px', borderRadius: 2, border: '1px solid var(--border-s)',
                      }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state mt8">Nog geen berichten gepubliceerd.</div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
          {page > 1 ? (
            <Link href={`/nieuws?page=${page - 1}`} style={{ fontFamily: 'var(--f-d)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>
              ← Vorige
            </Link>
          ) : <span />}
          <span style={{ fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--t3)' }}>
            Pagina {page} van {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/nieuws?page=${page + 1}`} style={{ fontFamily: 'var(--f-d)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>
              Volgende →
            </Link>
          ) : <span />}
        </div>
      )}
    </div>
  )
}
