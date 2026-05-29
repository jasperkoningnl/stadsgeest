import { client } from '@/lib/sanity'

export const revalidate = 3600

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let articles: any[] = []
  try {
    articles = await client.fetch(`
      *[_type == "article" && status == "published"] | order(publishedAt desc) [0...50] {
        title, slug, lead, publishedAt, author, tags[]->{ name }
      }
    `)
  } catch {
    // Sanity unavailable
  }

  const items = articles.map((a) => `
    <item>
      <title><![CDATA[${a.title ?? ''}]]></title>
      <link>https://stadsgeest.nl/artikel/${a.slug?.current ?? ''}</link>
      <description><![CDATA[${a.lead ?? ''}]]></description>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      ${a.author ? `<author>${a.author}</author>` : ''}
      <guid>https://stadsgeest.nl/artikel/${a.slug?.current ?? ''}</guid>
    </item>
  `).join('')

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Stadsgeest 033</title>
    <link>https://stadsgeest.nl</link>
    <description>AI-gedreven lokaal nieuws voor Amersfoort</description>
    <language>nl</language>
    <atom:link href="https://stadsgeest.nl/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`

  return new Response(feed, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
