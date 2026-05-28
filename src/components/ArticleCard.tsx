import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'
import { relativeTime, FORMAT_LABELS } from '@/lib/utils'
import type { Article } from '@/types'
import Tag from './Tag'

interface Props {
  article: Article
  variant?: 'standard' | 'feature' | '112'
}

export default function ArticleCard({ article, variant = 'standard' }: Props) {
  const href = `/artikel/${article.slug.current}`
  const rt = relativeTime(article.publishedAt)

  if (variant === '112') {
    return (
      <Link href={href} className="card-112">
        <span className="badge-112">112</span>
        <div className="card-112-body">
          <div className="card-112-title">{article.title}</div>
          <div className="card-112-meta">{rt}</div>
        </div>
      </Link>
    )
  }

  if (variant === 'feature') {
    return (
      <Link href={href} className="fcard">
        <div className="fcard-img" style={{ position: 'relative' }}>
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
          <div className="fcard-meta">{rt}</div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={href} className="acard">
      <div className="acard-tags">
        {article.tags
          ?.filter((t) => t.name !== '112')
          .slice(0, 2)
          .map((t) => (
            <Tag key={t.slug.current} name={t.name} slug={t.slug.current} />
          ))}
      </div>
      <h3 className="acard-title">{article.title}</h3>
      {article.lead && <p className="acard-lead">{article.lead}</p>}
      <div className="acard-meta">
        <span>{rt}</span>
      </div>
    </Link>
  )
}
