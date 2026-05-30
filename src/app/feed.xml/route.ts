import { client } from '@/lib/sanity'

export const revalidate = 3600

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function cdataSafe(str: string): string {
  return str.replace(/]]>/g, ']]]]><![CDATA[>')
}

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

  const items = articles.map((a) => {
    const slug = xmlEscape(a.slug?.current ?? '')
    const url = `https://stadsgeest.nl/artikel/${slug}`
    return `
    <item>
      <title><![CDATA[${cdataSafe(a.title ?? '')}]]></title>
      <link>${url}</link>
      <description><![CDATA[${cdataSafe(a.lead ?? '')}]]></description>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      ${a.author ? `<dc:creator><![CDATA[${cdataSafe(a.author)}]]></dc:creator>` : ''}
      <guid isPermaLink="true">${url}</guid>
    </item>`
  }).join('')

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
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
