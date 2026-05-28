import { client } from '@/lib/sanity'
import { allArticlesQuery, trendingTagsQuery } from '@/lib/queries'
import type { Article, TrendingTag } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'
import { relativeTime, FORMAT_LABELS, TAG_COLORS } from '@/lib/utils'
import ArticleCard from '@/components/ArticleCard'
import TrendingTags from '@/components/TrendingTags'
import Tag from '@/components/Tag'

export const revalidate = 60

export default async function HomePage() {
  let articles: Article[] = []
  let trendingTags: TrendingTag[] = []

  try {
    ;[articles, trendingTags] = await Promise.all([
      client.fetch<Article[]>(allArticlesQuery, {}, { next: { revalidate: 60 } }),
      client.fetch<TrendingTag[]>(trendingTagsQuery, {}, { next: { revalidate: 60 } }),
    ])
  } catch {
    // Sanity not connected yet — show empty state
  }

  const topArticle = articles.find((a) => a.priority === 'top')
  const kortCards = articles.filter(
    (a) => a.priority === 'kort' || a.format === '112'
  )
  const analyseCard = articles.find((a) => a.format === 'analyse')
  const normalCards = articles.filter(
    (a) =>
      a.priority === 'normaal' &&
      a.format !== 'analyse' &&
      a._id !== topArticle?._id
  )
  const row1 = normalCards.slice(0, 3)
  const sideCard = normalCards[3]

  return (
    <div className="page-in">
      {/* ── Hero ── */}
      {topArticle ? (
        <Link
          href={`/artikel/${topArticle.slug.current}`}
          className="hero"
          aria-label={topArticle.title}
        >
          <div className="hero-ph">
            {topArticle.mainImage && (
              <Image
                src={urlFor(topArticle.mainImage).width(1400).height(700).url()}
                alt={topArticle.mainImage.alt || ''}
                fill
                priority
                sizes="100vw"
                style={{ objectFit: 'cover', filter: 'brightness(1.12) saturate(1.05)' }}
              />
            )}
          </div>
          <div className="hero-grad" />
          <div className="hero-body">
            <div className="wrap">
              <div className="hero-inner">
                <span className="hero-badge">
                  {FORMAT_LABELS[topArticle.format] || 'Nieuws'}
                </span>
                <h1 className="hero-title">{topArticle.title}</h1>
                {topArticle.lead && (
                  <p className="hero-lead">{topArticle.lead}</p>
                )}
                <div className="hero-meta">
                  <span>{relativeTime(topArticle.publishedAt)}</span>
                  <span>·</span>
                  {topArticle.tags?.slice(0, 2).map((t) => (
                    <span key={t.slug.current} style={{ color: TAG_COLORS[t.name] || '#fff' }}>
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Link>
      ) : (
        <div style={{ height: 'clamp(260px, 48vw, 560px)', background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--t3)', fontSize: 14 }}>Geen topverhaal gevonden in Sanity</p>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="wrap">

        {/* Vandaag — 3-col */}
        {row1.length > 0 && (
          <>
            <div className="sec-head">
              <span className="sec-label">Vandaag</span>
            </div>
            <div className="ngrid ngrid-3 mt8">
              {row1.map((a) => (
                <ArticleCard key={a._id} article={a} />
              ))}
            </div>
          </>
        )}

        {/* Feature + side */}
        {analyseCard && (
          <div className="ngrid ngrid-2p1 mt16">
            <ArticleCard article={analyseCard} variant="feature" />
            {sideCard && <ArticleCard article={sideCard} />}
          </div>
        )}

        {/* 112 & Kort */}
        {kortCards.length > 0 && (
          <>
            <div className="sec-head mt32">
              <span className="sec-label">112 &amp; Kort</span>
            </div>
            <div className="grid-112 mt8">
              {kortCards.map((a) => (
                <ArticleCard key={a._id} article={a} variant="112" />
              ))}
            </div>
          </>
        )}

        {/* Trending */}
        <div className="sec-head mt32">
          <span className="sec-label">Trending deze week</span>
        </div>
        <div className="mt8">
          <TrendingTags tags={trendingTags} />
        </div>

        {articles.length === 0 && (
          <div className="empty-state mt32">
            <p>Nog geen artikelen gepubliceerd.</p>
            <p style={{ marginTop: 8 }}>
              Maak een artikel aan in{' '}
              <a href="http://localhost:3333" style={{ color: 'var(--accent)' }}>
                Sanity Studio
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
