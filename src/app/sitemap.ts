import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// De site bestaat sinds 7 augustus 2026 uit één publieke pagina; de rest zit
// achter de inlog en hoort niet in de sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, changeFrequency: 'monthly', priority: 1 }]
}
