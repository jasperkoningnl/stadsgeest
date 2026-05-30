import { client } from '@/lib/sanity'
import { homepageQuery } from '@/lib/queries'
import type { Article } from '@/types'
import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'
import { relativeTime, FORMAT_LABELS } from '@/lib/utils'
import ArticleCard from '@/components/ArticleCard'

export const revalidate = 60

interface HomepageData {
  topArticle: Article | null
  kortCards: Article[]
  analyseCard: Article | null
  normalCards: Article[]
}

const EMPTY: HomepageData = { topArticle: null, kortCards: [], analyseCard: null, normalCards: [] }

export default async function HomePage() {
  let data: HomepageData = EMPTY

  try {
    data = await client.fetch<HomepageData>(homepageQuery, {}, { next: { revalidate: 60 } })
  } catch {
    // Sanity not connected yet
  }

  const { topArticle, kortCards, analyseCard, normalCards } = data
  const hasContent = topArticle || kortCards.length > 0 || analyseCard || normalCards.length > 0

  return (
    <div className="page-in">
      {/* ── Hero ── */}
      <div className="wrap" style={{ paddingTop: '32px' }}>
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
                  style={{ objectFit: 'cover' }}
                />
              )}
            </div>
            <div className="hero-grad" />
            <div className="hero-body">
              <div className="hero-inner">
                <div className="hero-tags">
                  {topArticle.tags?.filter(t => t?.slug?.current).slice(0, 1).map((t) => (
                    <span key={t.slug.current} className="hero-tag hero-tag-primary">
                      {t.name}
                    </span>
                  ))}
                  <span className="hero-tag hero-tag-secondary">
                    {FORMAT_LABELS[topArticle.format] || 'Nieuws'}
                  </span>
                </div>
                <h1 className="hero-title">{topArticle.title}</h1>
                {topArticle.lead && (
                  <p className="hero-lead">{topArticle.lead}</p>
                )}
                <div className="hero-meta">
                  <span className="hero-meta-icon">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M7 4v3l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                    {Math.ceil((topArticle.lead?.split(' ').length || 100) / 200) + 3} min leestijd
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ) : (
          <div style={{ height: 'clamp(300px, 52vw, 580px)', background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--r-lg)' }}>
            <p style={{ color: 'var(--t3)', fontSize: 14 }}>Geen topverhaal gevonden</p>
          </div>
        )}
      </div>

      {/* ── Rij 1: 112 + Analyse ── */}
      <div className="wrap mt56">
        <div className="bento">
          {/* 112 & Actueel compact feed (4 cols) */}
          {kortCards.length > 0 && (
            <div className="bento-4" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="sec-head" style={{ paddingTop: 0 }}>
                <span className="sec-dot" />
                <span className="sec-label">112 &amp; Actueel</span>
              </div>
              <div className="feed-112 mt8">
                {kortCards.slice(0, 2).map((a) => (
                  <ArticleCard key={a._id} article={a} variant="112" />
                ))}
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                <Link href="/112" style={{ fontFamily: 'var(--f-d)', fontSize: 14, fontWeight: 600, color: 'var(--error)', textDecoration: 'none' }}>
                  Alle 112 meldingen →
                </Link>
              </div>
            </div>
          )}

          {/* Diepgaande analyse (8 cols) */}
          {analyseCard && (
            <div className="bento-8">
              <Link href={`/artikel/${analyseCard.slug.current}`} className="ai-module">
                <div className="ai-module-body">
                  <div className="ai-module-label">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1 L9.5 5.5 L14 5.5 L10.5 8.5 L11.8 13 L8 10.5 L4.2 13 L5.5 8.5 L2 5.5 L6.5 5.5 Z" fill="currentColor" opacity="0.8"/>
                    </svg>
                    Diepgaande Analyse
                  </div>
                  <h2 className="ai-module-title">{analyseCard.title}</h2>
                  {analyseCard.lead && (
                    <p className="ai-module-quote">"{analyseCard.lead}"</p>
                  )}
                  <span className="ai-module-btn">Lees de analyse</span>
                </div>
                {analyseCard.mainImage?.asset && (
                  <div className="ai-module-img">
                    <Image
                      src={urlFor(analyseCard.mainImage).width(440).height(440).url()}
                      alt={analyseCard.mainImage.alt || ''}
                      fill
                      sizes="220px"
                      style={{ objectFit: 'cover' }}
                    />
                  </div>
                )}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Rij 2: Nieuwsteasers ── */}
      {normalCards.length > 0 && (
        <div className="wrap mt56">
          <div className="bento">
            {normalCards.slice(0, 3).map((a) => (
              <div key={a._id} className="bento-4">
                <ArticleCard article={a} variant="with-image" catColor="teal" />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, textAlign: 'right' }}>
            <Link href="/nieuws" style={{ fontFamily: 'var(--f-d)', fontSize: 14, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
              Alle berichten →
            </Link>
          </div>
        </div>
      )}

      {!hasContent && (
        <div className="wrap">
          <div className="empty-state mt56">
            <p>Nog geen artikelen gepubliceerd.</p>
          </div>
        </div>
      )}
    </div>
  )
}
