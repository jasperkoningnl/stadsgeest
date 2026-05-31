import { client, urlFor } from '@/lib/sanity'
import { articleBySlugQuery } from '@/lib/queries'
import type { Article } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { relativeTime, FORMAT_LABELS } from '@/lib/utils'
import Tag from '@/components/Tag'
import PortableTextRenderer from '@/components/PortableTextRenderer'
import ReportButton from '@/components/ReportButton'
import ShareButtons from '@/components/ShareButtons'
import BackButton from '@/components/BackButton'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  let article: Article | null = null
  try {
    article = await client.fetch<Article | null>(
      articleBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    )
  } catch {
    return { title: 'Artikel niet gevonden' }
  }
  if (!article) return { title: 'Artikel niet gevonden' }
  return {
    title: article.seoTitle || article.title,
    description: article.seoDescription || article.lead,
    alternates: { canonical: `${SITE_URL}/artikel/${slug}` },
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
  let article: Article | null = null
  try {
    article = await client.fetch<Article | null>(
      articleBySlugQuery,
      { slug },
      { next: { revalidate: 60 } }
    )
  } catch {
    notFound()
  }
  if (!article) notFound()

  const fmtLabel = FORMAT_LABELS[article.format] || 'Nieuws'
  const isAnalyse = article.format === 'analyse'

  const normalizeTag = (t: { name: string; slug: { current: string } }) => {
    if (t.name.toLowerCase() === 'politie amersfoort') return { name: 'Politie', slug: { current: 'politie' } }
    return t
  }

  const readMins = Math.max(1, Math.ceil(
    ((article.body?.reduce((acc: number, b: { children?: { text?: string }[] }) =>
      acc + (b.children?.map((c) => c.text || '').join('').split(' ').length || 0), 0) || 0) +
      (article.lead?.split(' ').length || 0)) / 200
  ))

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
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    image: article.mainImage ? urlFor(article.mainImage).width(1200).height(630).url() : undefined,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="wrap page-in">
        <article style={{ paddingTop: 24, paddingBottom: 40 }}>
          <BackButton />
          <div style={{ maxWidth: 780 }}>

            {/* Category badge */}
            <span className={isAnalyse ? 'art-cat-badge' : 'art-cat-badge art-cat-badge-teal'}>
              {fmtLabel}
            </span>

            <h1 className="art-title">{article.title}</h1>
            {article.lead && <p className="art-lead">{article.lead}</p>}

            {/* Byline */}
            <div className="art-byline">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'var(--accent-dim)', border: '1px solid rgba(70,234,237,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--accent)' }}>
                    <path d="M7 1 L8.2 4.5 L12 4.5 L9 6.7 L10.2 10.2 L7 8 L3.8 10.2 L5 6.7 L2 4.5 L5.8 4.5 Z" fill="currentColor" />
                  </svg>
                </div>
                <strong style={{ color: 'var(--t1)', fontSize: 14, fontWeight: 500 }}>AI-redactie Stadsgeest 033</strong>
              </div>
              <span style={{ color: 'var(--border)', fontSize: 13 }}>•</span>
              <span>
                {new Date(article.publishedAt).toLocaleDateString('nl-NL', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
              <span style={{ color: 'var(--border)', fontSize: 13 }}>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.2" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M6.5 3.5v3l1.8 1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {readMins} min leestijd
              </span>
            </div>

            <ShareButtons
              title={article.title}
              url={`${SITE_URL}/artikel/${article.slug.current}`}
            />
          </div>

          {/* Hero image */}
          {article.mainImage && (
            <figure style={{ marginBottom: 40, marginTop: 24 }}>
              <div className="art-hero-img" style={{ borderRadius: 'var(--r-lg)', position: 'relative', marginBottom: 0 }}>
                <Image
                  src={urlFor(article.mainImage).width(1200).height(630).url()}
                  alt={article.mainImage.alt || ''}
                  fill
                  style={{ objectFit: 'cover' }}
                  sizes="(max-width: 900px) 100vw, 900px"
                  priority
                />
                {article.mainImage.credit && (
                  <span style={{
                    position: 'absolute', bottom: 8, right: 10,
                    fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.05em',
                    color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase',
                    textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                  }}>
                    {article.mainImage.credit}
                  </span>
                )}
              </div>
              {article.mainImage.caption && (
                <figcaption style={{ marginTop: 4 }}>
                  <p style={{ fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--t2)', fontStyle: 'italic' }}>
                    {article.mainImage.caption}
                  </p>
                </figcaption>
              )}
            </figure>
          )}

          {/* Body + Sidebar */}
          <div className="art-layout">
            <main className="art-body">
              {article.body && article.body.length > 0 && (
                <PortableTextRenderer value={article.body} />
              )}

              {/* AI transparency block + sources */}
              {(article.aiTransparency || (article.sources && article.sources.length > 0)) && (
                <div className="ai-block" style={{ width: '85%', margin: '0 auto' }}>
                  <div className="ai-block-head">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--accent)' }}>
                      <path d="M7 1 L8.2 4.5 L12 4.5 L9 6.7 L10.2 10.2 L7 8 L3.8 10.2 L5 6.7 L2 4.5 L5.8 4.5 Z" fill="currentColor" opacity="0.7"/>
                    </svg>
                    Hoe dit artikel tot stand kwam
                  </div>
                  {article.aiTransparency && (
                    <p className="ai-block-text">{article.aiTransparency}</p>
                  )}
                  {article.sources && article.sources.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div className="sources-head" style={{ marginBottom: 8 }}>Geraadpleegde bronnen</div>
                      {article.sources.map((s, i) => (
                        <div key={i} className="source-row">
                          <a href={s.url} className="source-link" target="_blank" rel="noopener noreferrer">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
                              <path d="M5 2.5H2.5A1 1 0 0 0 1.5 3.5v7A1 1 0 0 0 2.5 11.5h7A1 1 0 0 0 10.5 10.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                              <path d="M7.5 1.5h4v4M11.5 1.5 L6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {s.name}
                          </a>
                          <span className="source-pub">{s.sourceType}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tags */}
              {article.tags?.filter(t => t?.slug?.current && t.slug.current !== 'amersfoort').length ? (
                <div style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500, color: 'var(--t2)', marginRight: 4 }}>Tags:</span>
                  {article.tags?.filter(t => t?.slug?.current && t.slug.current !== 'amersfoort').slice(0, 5).map((t) => {
                    const nt = normalizeTag(t)
                    return (
                      <Link key={t.slug.current} href={`/tag/${nt.slug.current}`} className="ent-chip">
                        {nt.name}
                      </Link>
                    )
                  })}
                </div>
              ) : null}

              {/* Report button */}
              <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
                <ReportButton articleId={article._id} />
              </div>
            </main>

            {/* Sidebar */}
            <aside>
              {article.relatedArticles && article.relatedArticles.length > 0 && (
                <div className="sidebar-box">
                  <div className="sidebar-title">Gerelateerde artikelen</div>
                  {article.relatedArticles.slice(0, 4).map((a) =>
                    a.slug ? (
                      <Link key={a._id} href={`/artikel/${a.slug.current}`} className="rel-item">
                        <div className="rel-title">{a.title}</div>
                        <div className="rel-meta">
                          <span>{a.publishedAt ? relativeTime(a.publishedAt) : ''}</span>
                          {a.tags?.[0]?.slug?.current && <Tag name={a.tags[0].name} slug={a.tags[0].slug.current} />}
                        </div>
                      </Link>
                    ) : null
                  )}
                </div>
              )}

              <div className="sidebar-box">
                <div className="sidebar-title">Onderwerpen</div>
                <div className="sidebar-tags">
                  {article.tags?.filter(t => t?.slug?.current && t.slug.current !== 'amersfoort').slice(0, 5).map((t) => {
                    const nt = normalizeTag(t)
                    return <Tag key={t.slug.current} name={nt.name} slug={nt.slug.current} />
                  })}
                </div>
              </div>

            </aside>
          </div>

          {/* Related articles grid — below article */}
          {article.relatedArticles && article.relatedArticles.length > 0 && (
            <div style={{ marginTop: 64, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontFamily: 'var(--f-d)', fontSize: 22, fontWeight: 600, marginBottom: 28 }}>
                Gerelateerde analyses
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 32 }}>
                {article.relatedArticles.slice(0, 3).map((a) =>
                  a.slug ? (
                    <Link key={a._id} href={`/artikel/${a.slug.current}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }}>
                      {a.mainImage && (
                        <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--bg-raised)', position: 'relative' }}>
                          <Image
                            src={urlFor(a.mainImage).width(400).height(225).url()}
                            alt={a.mainImage.alt || ''}
                            fill
                            sizes="300px"
                            style={{ objectFit: 'cover' }}
                          />
                        </div>
                      )}
                      {a.tags?.[0] && (
                        <span style={{ fontFamily: 'var(--f-m)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                          {a.tags[0].name}
                        </span>
                      )}
                      <h4 style={{ fontFamily: 'var(--f-d)', fontSize: 18, fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{a.title}</h4>
                    </Link>
                  ) : null
                )}
              </div>
            </div>
          )}
        </article>
      </div>
    </>
  )
}
