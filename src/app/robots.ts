import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// De voorpagina mag geïndexeerd worden, het redactionele dashboard niet.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/nieuwsplein33', '/login', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
