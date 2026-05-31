export interface SanitySlug {
  current: string
}

export interface SanityImageAsset {
  _id: string
  url: string
  metadata?: {
    dimensions: { width: number; height: number }
  }
}

export interface SanityImage {
  asset: SanityImageAsset
  alt?: string
  caption?: string
  credit?: string
}

export interface Tag {
  name: string
  slug: SanitySlug
  color?: string
}

export interface Location {
  name: string
  slug: SanitySlug
  type?: string
}

export interface Person {
  name: string
  slug: SanitySlug
  role?: string
  orgName?: string
}

export interface Organization {
  name: string
  slug: SanitySlug
  type?: string
  website?: string
}

export interface Source {
  name: string
  url: string
  sourceType: string
  reliability?: string
  retrievedAt?: string
}

export interface Article {
  _id: string
  title: string
  slug: SanitySlug
  lead?: string
  format: 'nieuws' | 'brief' | 'analyse' | 'feature' | 'interview' | '112'
  priority: 'top' | 'normaal' | 'kort'
  status?: string
  publishedAt: string
  updatedAt?: string
  author?: string
  editedBy?: string
  aiTransparency?: string
  mainImage?: SanityImage
  seoTitle?: string
  seoDescription?: string
  tags?: Tag[]
  locations?: Location[]
  persons?: Person[]
  organizations?: Organization[]
  sources?: Source[]
  relatedArticles?: Partial<Article>[]
  reportCount?: number
  bodyWordCount?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any[]
}

export interface TrendingTag {
  name: string
  slug: SanitySlug
  color?: string
  recentCount: number
}

export interface SiteSettings {
  siteName: string
  siteDescription: string
  reportThreshold: number
  aiDisclaimer: string
}
