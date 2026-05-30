import type { MetadataRoute } from 'next'
import { client } from '@/lib/sanity'
import { SITE_URL } from '@/lib/site'

const BASE = SITE_URL

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const [articles, tags, locations] = await Promise.all([
      client.fetch<Array<{ slug: { current: string }; publishedAt: string }>>(`
        *[_type == "article" && status == "published"] { slug, publishedAt }
      `),
      client.fetch<Array<{ slug: { current: string } }>>(`
        *[_type == "tag"] { slug }
      `),
      client.fetch<Array<{ slug: { current: string } }>>(`
        *[_type == "location"] { slug }
      `),
    ])

    return [
      { url: BASE, changeFrequency: 'hourly', priority: 1 },
      ...articles.filter((a) => a?.slug?.current).map((a) => ({
        url: `${BASE}/artikel/${a.slug.current}`,
        lastModified: new Date(a.publishedAt),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
      ...tags.filter((t) => t?.slug?.current).map((t) => ({
        url: `${BASE}/tag/${t.slug.current}`,
        changeFrequency: 'daily' as const,
        priority: 0.5,
      })),
      ...locations.filter((l) => l?.slug?.current).map((l) => ({
        url: `${BASE}/wijk/${l.slug.current}`,
        changeFrequency: 'daily' as const,
        priority: 0.5,
      })),
    ]
  } catch {
    return [{ url: BASE, changeFrequency: 'hourly', priority: 1 }]
  }
}
