import { client, urlFor } from '@/lib/sanity'
import { articlesByTagQuery, tagBySlugQuery } from '@/lib/queries'
import type { Article, Tag } from '@/types'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { relativeTime } from '@/lib/utils'
import TagChip from '@/components/Tag'
import { notFound } from 'next/navigation'

export const revalidate = 60

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  let tag: Tag | null = null
  try {
    tag = await client.fetch<Tag | null>(tagBySlugQuery, { slug })
  } catch {
    return { title: 'Tag niet gevonden' }
  }
  if (!tag) return { title: 'Tag niet gevonden' }
  return {
    title: tag.name,
    description: `Alle artikelen over ${tag.name} in Amersfoort`,
  }
}

export default async function TagPage({ params }: Props) {
  const { slug } = await params

  let tag: Tag | null = null
  let initialArticles: Article[] = []
  try {
    ;[tag, initialArticles] = await Promise.all([
      client.fetch<Tag | null>(tagBySlugQuery, { slug }, { next: { revalidate: 60 } }),
      client.fetch<Article[]>(articlesByTagQuery, { tagSlug: slug }, { next: { revalidate: 60 } }),
    ])
  } catch {
    // Sanity unavailable — tag stays null, triggering notFound below
  }

  if (!tag) notFound()

  // For 112, also fetch brief-format articles as fallback when no tagged articles found
  let articles = initialArticles
  if (slug === '112' && articles.length === 0) {
    try {
      articles = await client.fetch<Article[]>(
        `*[_type == "article" && status == "published" && format == "brief"] | order(publishedAt desc) { _id, title, slug, lead, format, publishedAt, tags[]->{ name, slug } }`,
        {},
        { next: { revalidate: 60 } }
      )
    } catch {
      // keep articles as empty array
    }
  }

  return (
    <div className="wrap page-in">
      <div className="nbh-hdr">
        <div className="crumb">
          <Link href="/" className="crumb-link">Stadsgeest 033</Link>
          <span>›</span>
          <span>{tag.name}</span>
        </div>
        <h1 className="nbh-title">{tag.name}</h1>
        <p className="nbh-sub">
          Alle artikelen over {tag.name} — chronologisch, op basis van openbare bronnen.
        </p>
      </div>

      <div className="sec-head mt24">
        <span className="sec-label">
          {articles.length} artikel{articles.length !== 1 ? 'en' : ''}
        </span>
      </div>

      {articles.length > 0 ? (
        <div className="art-list mt8">
          {articles.map((a) => (
            <Link key={a._id} href={`/artikel/${a.slug.current}`} className="art-list-item">
              {a.mainImage && (
                <div className="art-list-thumb">
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
                <div className="art-list-title">{a.title}</div>
                {a.lead && <div className="art-list-lead">{a.lead}</div>}
                <div className="art-list-meta">
                  <span>{relativeTime(a.publishedAt)}</span>
                  {a.tags?.filter((t: { slug: { current: string } | null }) => t?.slug?.current && t.slug.current !== 'amersfoort').slice(0, 1).map((t: { slug: { current: string }; name: string }) => (
                    <TagChip key={t.slug.current} name={t.name} />
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state mt8">Nog geen artikelen gevonden voor deze tag.</div>
      )}
    </div>
  )
}
