import Link from 'next/link'
import type { TrendingTag } from '@/types'

interface Props {
  tags: TrendingTag[]
}

export default function TrendingTags({ tags }: Props) {
  if (!tags?.length) {
    return (
      <div className="trending-wrap">
        <div className="trending-label">Trending deze week</div>
        <p style={{ fontSize: 13, color: 'var(--t3)' }}>
          Geen trending onderwerpen gevonden.
        </p>
      </div>
    )
  }

  return (
    <div className="trending-wrap">
      <div className="trending-label">Trending deze week</div>
      <div className="trending-list">
        {tags.map((tag) => (
          <Link
            key={tag.slug.current}
            href={`/tag/${tag.slug.current}`}
            className="trending-item"
          >
            <span>{tag.name}</span>
            <span className="trending-count">{tag.recentCount}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
