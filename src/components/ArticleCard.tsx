import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'
import { relativeTime, FORMAT_LABELS } from '@/lib/utils'
import type { Article } from '@/types'
import Tag from './Tag'

interface Props {
  article: Article
  variant?: 'standard' | 'feature' | '112' | 'with-image'
  catColor?: 'teal' | 'amber' | 'default'
}

export default function ArticleCard({ article, variant = 'standard', catColor = 'teal' }: Props) {
  const href = `/artikel/${article.slug.current}`
  const rt = relativeTime(article.publishedAt)
  const catClass = catColor === 'amber' ? 'acard-cat-amber' : catColor === 'default' ? 'acard-cat-primary' : 'acard-cat'
  const isUpdated = article.updatedAt && new Date(article.updatedAt) > new Date(article.publishedAt)

  if (variant === '112') {
    const isAmber = article.tags?.some(t => t?.slug?.current === 'verkeer')
    return (
      <Link href={href} className={`feed-112-item ${isAmber ? 'feed-112-item-amber' : 'feed-112-item-teal'}`}>
        <div className={`feed-112-time ${isAmber ? '' : 'feed-112-time-teal'}`}>
          {rt} · {article.tags?.[0]?.name?.toUpperCase() || '112'}
        </div>
        <div className="feed-112-title">{article.title}</div>
      </Link>
    )
  }

  if (variant === 'feature') {
    return (
      <Link href={href} className="fcard">
        <div className="fcard-img">
          {article.mainImage ? (
            <Image
              src={urlFor(article.mainImage).width(900).height(450).url()}
              alt={article.mainImage.alt || ''}
              fill
              sizes="(max-width: 768px) 100vw, 66vw"
              style={{ objectFit: 'cover' }}
            />
          ) : null}
        </div>
        <div className="fcard-body">
          <span className="fcard-fmt">{FORMAT_LABELS[article.format] || 'Nieuws'}</span>
          <h3 className="fcard-title">{article.title}</h3>
          {article.lead && <p className="fcard-lead">{article.lead}</p>}
          <div className="fcard-meta">
            {rt}
            {isUpdated && <span style={{ fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginLeft: 6 }}>bijgewerkt</span>}
          </div>
        </div>
      </Link>
    )
  }

  if (variant === 'with-image') {
    const catLabel = article.tags?.[0]?.name || FORMAT_LABELS[article.format] || 'Nieuws'
    return (
      <Link href={href} className="acard">
        {article.mainImage && (
          <div className="acard-img-wrap">
            <Image
              src={urlFor(article.mainImage).width(600).height(338).url()}
              alt={article.mainImage.alt || ''}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              style={{ objectFit: 'cover' }}
            />
          </div>
        )}
        <div className="acard-meta">
          <span className={catClass}>{catLabel}</span>
          <span className="acard-meta-sep">·</span>
          <span>{rt}</span>
          {isUpdated && <span style={{ fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginLeft: 2 }}>bijgewerkt</span>}
        </div>
        <h3 className="acard-title">{article.title}</h3>
      </Link>
    )
  }

  // standard (no image)
  const catLabel = article.tags?.filter(t => t.name !== '112')[0]?.name || FORMAT_LABELS[article.format] || 'Nieuws'
  return (
    <Link href={href} className="acard">
      <div className="acard-meta">
        <span className={catClass}>{catLabel}</span>
        <span className="acard-meta-sep">·</span>
        <span>{rt}</span>
        {isUpdated && <span style={{ fontFamily: 'var(--f-m)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', marginLeft: 2 }}>bijgewerkt</span>}
      </div>
      <h3 className="acard-title">{article.title}</h3>
      {article.lead && <p className="acard-lead">{article.lead}</p>}
    </Link>
  )
}
