import Link from 'next/link'
import type { TrendingTag } from '@/types'

export default function TrendingTags({ tags }: { tags: TrendingTag[] }) {
  if (!tags.length) return null
  return (
    <div className="trending-box">
      <h4 className="trending-title">Populaire thema's</h4>
      <div className="trending-tags">
        {tags.map((t) => (
          <Link key={t.slug} href={`/tag/${t.slug}`} className="trending-pill">
            #{t.name}
          </Link>
        ))}
      </div>
      <div className="trending-ai-note">
        "AI-analyse: trending onderwerpen worden automatisch bijgehouden op basis van publicatiefrequentie."
      </div>
    </div>
  )
}
