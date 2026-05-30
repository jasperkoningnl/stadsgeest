export const allArticlesQuery = `
  *[_type == "article" && status == "published"] | order(publishedAt desc) {
    _id,
    title,
    slug,
    lead,
    format,
    priority,
    publishedAt,
    updatedAt,
    author,
    mainImage {
      asset->,
      alt,
      caption,
      credit
    },
    tags[]-> { name, slug, color },
    locations[]-> { name, slug },
    reportCount
  }
`

const ARTICLE_FIELDS = `
  _id, title, slug, lead, format, priority, publishedAt,
  mainImage { asset->, alt },
  tags[]-> { name, slug, color }
`

export const homepageQuery = `{
  "topArticle": *[_type == "article" && status == "published" && priority == "top"] | order(publishedAt desc) [0] { ${ARTICLE_FIELDS} },
  "kortCards": *[_type == "article" && status == "published" && (priority == "kort" || format == "112")] | order(publishedAt desc) [0...4] { ${ARTICLE_FIELDS} },
  "analyseCard": *[_type == "article" && status == "published" && format == "analyse"] | order(publishedAt desc) [0] { ${ARTICLE_FIELDS} },
  "normalCards": *[_type == "article" && status == "published" && priority == "normaal" && format != "analyse"] | order(publishedAt desc) [0...3] { ${ARTICLE_FIELDS} }
}`

export const articleBySlugQuery = `
  *[_type == "article" && status == "published" && slug.current == $slug][0] {
    _id,
    title,
    slug,
    lead,
    body[] {
      ...,
      markDefs[] {
        ...,
        _type == "sourceRef" => {
          "source": source-> { name, url, sourceType, reliability }
        }
      }
    },
    format,
    priority,
    status,
    publishedAt,
    updatedAt,
    author,
    editedBy,
    aiTransparency,
    mainImage {
      asset->,
      alt,
      caption,
      credit
    },
    seoTitle,
    seoDescription,
    tags[]-> { name, slug, color },
    locations[]-> { name, slug, type },
    persons[]-> { name, slug, role, "orgName": organization->name },
    organizations[]-> { name, slug, type, website },
    sources[]-> { name, url, sourceType, reliability, retrievedAt },
    relatedArticles[]-> {
      _id, title, slug, lead, format, publishedAt,
      mainImage { asset->, alt },
      tags[]-> { name, slug, color }
    },
    reportCount
  }
`

export const articlesByTagQuery = `
  *[_type == "article" && status == "published" && $tagSlug in tags[]->slug.current] | order(publishedAt desc) {
    _id, title, slug, lead, format, priority, publishedAt,
    mainImage { asset->, alt },
    tags[]-> { name, slug, color },
    locations[]-> { name, slug }
  }
`

export const articlesByLocationQuery = `
  *[_type == "article" && status == "published" && $locationSlug in locations[]->slug.current] | order(publishedAt desc) {
    _id, title, slug, lead, format, priority, publishedAt,
    mainImage { asset->, alt },
    tags[]-> { name, slug, color },
    locations[]-> { name, slug }
  }
`

export const articlesByPersonQuery = `
  *[_type == "article" && status == "published" && $personSlug in persons[]->slug.current] | order(publishedAt desc) {
    _id, title, slug, lead, format, priority, publishedAt,
    mainImage { asset->, alt },
    tags[]-> { name, slug, color }
  }
`

export const personBySlugQuery = `
  *[_type == "person" && slug.current == $slug][0] {
    name, slug, role, notes,
    "orgName": organization->name,
    "articleCount": count(*[_type == "article" && status == "published" && ^._id in persons[]._ref])
  }
`

export const tagBySlugQuery = `
  *[_type == "tag" && slug.current == $slug][0] {
    name, slug, color
  }
`

export const locationBySlugQuery = `
  *[_type == "location" && slug.current == $slug][0] {
    name, slug, type
  }
`

export const allTagsWithCountQuery = `
  *[_type == "tag"] {
    name, slug, color,
    "count": count(*[_type == "article" && status == "published" && ^._id in tags[]._ref])
  } | order(count desc)
`

export const allLocationsWithCountQuery = `
  *[_type == "location"] {
    name, slug, type,
    "count": count(*[_type == "article" && status == "published" && ^._id in locations[]._ref])
  } | order(count desc)
`

export const trendingTagsQuery = `
  *[_type == "tag"] {
    name, slug, color,
    "recentCount": count(*[_type == "article" && status == "published" && ^._id in tags[]._ref && publishedAt > now() - 60*60*24*7])
  } | order(recentCount desc) [0...7]
`

export const siteSettingsQuery = `
  *[_type == "siteSettings"][0] {
    siteName, siteDescription, reportThreshold, aiDisclaimer
  }
`
