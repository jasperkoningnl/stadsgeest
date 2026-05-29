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
  const isAnalyse = article.format === 'analyse'

  const allEntities = [
    ...(article.persons?.map((p) => ({ name: p.name, href: `/persoon/${p.slug.current}` })) || []),
    ...(article.organizations?.map((o) => ({ name: o.name, href: `/organisatie/${o.slug.current}` })) || []),
  ]

  const readMins = Math.max(3, Math.ceil(
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
    publisher: { '@type': 'Organization', name: 'Stadsgeest 033', url: 'https://stadsgeest.nl' },
    image: article.mainImage ? urlFor(article.mainImage).width(1200).height(630).url() : undefined,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="wrap page-in">
        <article style={{ paddingTop: 40, paddingBottom: 80 }}>
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
              url={`https://stadsgeest.nl/artikel/${article.slug.current}`}
            />
          </div>

          {/* Hero image */}
          {article.mainImage && (
            <figure style={{ marginBottom: 40 }}>
              <div className="art-hero-img" style={{ borderRadius: 'var(--r-lg)', marginBottom: 10 }}>
                <Image
                  src={urlFor(article.mainImage).width(1200).height(630).url()}
                  alt={article.mainImage.alt || ''}
                  fill
                  style={{ objectFit: 'cover' }}
                  sizes="(max-width: 900px) 100vw, 900px"
                  priority
                />
              </div>
              {(article.mainImage.caption || article.mainImage.credit) && (
                <figcaption style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16,
                }}>
                  {article.mainImage.caption && (
                    <p style={{ fontFamily: 'var(--f-d)', fontSize: 13, color: 'var(--t2)', fontStyle: 'italic' }}>
                      {article.mainImage.caption}
                    </p>
                  )}
                  {article.mainImage.credit && (
                    <p style={{ fontFamily: 'var(--f-m)', fontSize: 11, color: 'var(--t3)', flexShrink: 0, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      FOTO: {article.mainImage.credit}
                    </p>
                  )}
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

              {/* AI transparency block */}
              {article.aiTransparency && (
                <div className="ai-block">
                  <div className="ai-block-head">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--accent)' }}>
                      <path d="M7 1 L8.2 4.5 L12 4.5 L9 6.7 L10.2 10.2 L7 8 L3.8 10.2 L5 6.7 L2 4.5 L5.8 4.5 Z" fill="currentColor" opacity="0.7"/>
                    </svg>
                    Hoe dit artikel tot stand kwam
                  </div>
                  <p className="ai-block-text">{article.aiTransparency}</p>
                  <div className="ai-block-grid">
                    <div className="ai-block-item">
                      <span className="ai-block-item-label">Data-aggregatie</span>
                      <span className="ai-block-item-text">Extractie van feiten uit officiële gemeente-publicaties.</span>
                    </div>
                    <div className="ai-block-item">
                      <span className="ai-block-item-label ai-block-item-label-amber">Menselijke controle</span>
                      <span className="ai-block-item-text">Eindredactie uitgevoerd door onze journalistieke toezichthouder.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sources */}
              {article.sources && article.sources.length > 0 && (
                <div className="mt32">
                  <hr className="divider" />
                  <div className="sources-head">Geraadpleegde bronnen</div>
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

              {/* Tags & entities */}
              {(article.tags?.length || allEntities.length) ? (
                <div style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--f-d)', fontSize: 13, fontWeight: 500, color: 'var(--t2)', marginRight: 4 }}>Tags:</span>
                  {article.tags?.map((t) => (
                    <Link key={t.slug.current} href={`/tag/${t.slug.current}`} className="ent-chip">
                      {t.name}
                    </Link>
                  ))}
                  {allEntities.map((e, i) => (
                    <Link key={i} href={e.href} className="ent-chip">{e.name}</Link>
                  ))}
                  {article.locations?.map((l) => (
                    <span key={l.slug.current} className="ent-chip">{l.name}</span>
                  ))}
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
                          {a.tags?.[0] && <Tag name={a.tags[0].name} slug={a.tags[0].slug.current} />}
                        </div>
                      </Link>
                    ) : null
                  )}
                </div>
              )}

              <div className="sidebar-box">
                <div className="sidebar-title">Onderwerpen</div>
                <div className="sidebar-tags">
                  {article.tags?.map((t) => (
                    <Tag key={t.slug.current} name={t.name} slug={t.slug.current} />
                  ))}
                  {article.locations?.map((l) => (
                    <span key={l.slug.current} className="ent-chip">{l.name}</span>
                  ))}
                </div>
              </div>

              <div className="sidebar-box" style={{ background: 'var(--accent-dim)', borderColor: 'rgba(70,234,237,0.20)' }}>
                <div className="sidebar-title" style={{ color: 'var(--accent)' }}>Over de AI-redactie</div>
                <p style={{ fontFamily: 'var(--f-b)', fontSize: 14, color: 'var(--t2)', lineHeight: 1.65 }}>
                  Stadsgeest 033 publiceert dagelijks lokaal nieuws, samengesteld door AI op basis van openbare bronnen. Altijd transparant over herkomst.
                </p>
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
