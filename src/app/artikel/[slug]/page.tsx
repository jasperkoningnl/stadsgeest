import { client, urlFor } from '@/lib/sanity'
import { articleBySlugQuery } from '@/lib/queries'
import type { Article } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { relativeTime, FORMAT_LABELS, FORMAT_COLORS } from '@/lib/utils'
import Tag from '@/components/Tag'
import PortableTextRenderer from '@/components/PortableTextRenderer'
import ReportButton from '@/components/ReportButton'
import { notFound } from 'next/navigation'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await client.fetch<Article | null>(
    articleBySlugQuery,
    { slug },
    { next: { revalidate: 60 } }
  )

  if (!article) return { title: 'Artikel niet gevonden' }

  return {
    title: article.seoTitle || article.title,
    description: article.seoDescription || article.lead,
    openGraph: {
      title: article.seoTitle || article.title,
      description: article.seoDescription || article.lead || undefined,
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      images: article.mainImage
        ? [urlFor(article.mainImage).width(1200).height(630).url()]
        : [],
    },
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await client.fetch<Article | null>(
    articleBySlugQuery,
    { slug },
    { next: { revalidate: 60 } }
  )

  if (!article) notFound()

  const fmtLabel = FORMAT_LABELS[article.format] || 'Nieuws'
  const fmtColor = FORMAT_COLORS[article.format] || 'var(--accent)'

  const allEntities = [
    ...(article.persons?.map((p) => ({
      name: p.name,
      href: `/persoon/${p.slug.current}`,
    })) || []),
    ...(article.organizations?.map((o) => ({
      name: o.name,
      href: `/organisatie/${o.slug.current}`,
    })) || []),
  ]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.lead,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: { '@type': 'Organization', name: 'AI-redactie Stadsgeest 033' },
    publisher: {
      '@type': 'Organization',
      name: 'Stadsgeest 033',
      url: 'https://stadsgeest.nl',
    },
    image: article.mainImage
      ? urlFor(article.mainImage).width(1200).height(630).url()
      : undefined,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="wrap page-in">
        <div className="article-pg">

          {/* ── Article header ── */}
          <div style={{ maxWidth: 780 }}>
            <div className="art-format" style={{ color: fmtColor }}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="4" fill="currentColor" />
              </svg>
              {fmtLabel}
            </div>

            <h1 className="art-title">{article.title}</h1>

            {article.lead && <p className="art-lead">{article.lead}</p>}

            <div className="art-byline">
              <span>
                <strong>AI-redactie Stadsgeest 033</strong>
              </span>
              <span>
                {new Date(article.publishedAt).toLocaleDateString('nl-NL', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              {/* readTime would come from a calculated field */}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {article.tags?.map((t) => (
                  <Tag key={t.slug.current} name={t.name} slug={t.slug.current} />
                ))}
              </span>
            </div>
          </div>

          {/* ── Hero image ── */}
          {article.mainImage && (
            <div className="art-hero-img">
              <Image
                src={urlFor(article.mainImage).width(1200).height(630).url()}
                alt={article.mainImage.alt || ''}
                fill
                style={{ objectFit: 'cover' }}
                sizes="(max-width: 900px) 100vw, 900px"
                priority
              />
              {article.mainImage.caption && (
                <p
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    right: 12,
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.6)',
                    zIndex: 2,
                  }}
                >
                  {article.mainImage.caption}
                </p>
              )}
            </div>
          )}

          {/* ── Body + Sidebar ── */}
          <div className="art-layout">

            {/* Main body */}
            <main className="art-body">
              {article.body && article.body.length > 0 && (
                <PortableTextRenderer value={article.body} />
              )}

              {/* AI transparency block */}
              {article.aiTransparency && (
                <div className="ai-block">
                  <div className="ai-block-head">Hoe dit artikel tot stand kwam</div>
                  <p className="ai-block-text">{article.aiTransparency}</p>
                </div>
              )}

              {/* Sources */}
              {article.sources && article.sources.length > 0 && (
                <div className="mt24">
                  <hr className="divider" />
                  <div className="sources-head">Bronnen</div>
                  {article.sources.map((s, i) => (
                    <div key={i} className="source-row">
                      <a
                        href={s.url}
                        className="source-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.name}
                      </a>
                      <span className="source-pub">{s.sourceType}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Entities */}
              {allEntities.length > 0 && (
                <div className="mt24">
                  <hr className="divider" />
                  <div className="ents-head">Genoemde personen en organisaties</div>
                  <div className="ents-list mt8">
                    {allEntities.map((e, i) => (
                      <Link key={i} href={e.href} className="ent-chip">
                        {e.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Locations */}
              {article.locations && article.locations.length > 0 && (
                <div className="mt16">
                  <div className="ents-head">Locaties</div>
                  <div className="ents-list mt8">
                    {article.locations.map((l) => (
                      <Link
                        key={l.slug.current}
                        href={`/wijk/${l.slug.current}`}
                        className="ent-chip"
                      >
                        {l.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <ReportButton articleId={article._id} />
            </main>

            {/* Sidebar */}
            <aside>
              {article.relatedArticles && article.relatedArticles.length > 0 && (
                <div className="sidebar-box">
                  <div className="sidebar-title">Gerelateerde artikelen</div>
                  {article.relatedArticles.slice(0, 4).map(
                    (a) =>
                      a.slug && (
                        <Link
                          key={a._id}
                          href={`/artikel/${a.slug.current}`}
                          className="rel-item"
                        >
                          <div className="rel-title">{a.title}</div>
                          <div className="rel-meta">
                            <span>
                              {a.publishedAt ? relativeTime(a.publishedAt) : ''}
                            </span>
                            {a.tags?.[0] && (
                              <Tag
                                name={a.tags[0].name}
                                slug={a.tags[0].slug.current}
                              />
                            )}
                          </div>
                        </Link>
                      )
                  )}
                </div>
              )}

              <div className="sidebar-box">
                <div className="sidebar-title">Tags</div>
                <div className="sidebar-tags">
                  {article.tags?.map((t) => (
                    <Tag key={t.slug.current} name={t.name} slug={t.slug.current} />
                  ))}
                  {article.locations?.map((l) => (
                    <Link
                      key={l.slug.current}
                      href={`/wijk/${l.slug.current}`}
                      className="ent-chip"
                    >
                      {l.name}
                    </Link>
                  ))}
                </div>
              </div>

              <div
                className="sidebar-box"
                style={{
                  background: 'var(--accent-dim)',
                  borderColor: 'rgba(26,154,170,.25)',
                }}
              >
                <div className="sidebar-title" style={{ color: 'var(--accent)' }}>
                  Over de AI-redactie
                </div>
                <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>
                  Stadsgeest 033 publiceert dagelijks lokaal nieuws, samengesteld door AI op basis
                  van openbare bronnen. Altijd transparant over herkomst.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}
