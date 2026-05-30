import { createClient } from 'next-sanity'
import { createImageUrlBuilder } from '@sanity/image-url'

if (process.env.NODE_ENV === 'development') {
  if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) console.warn('[sanity] NEXT_PUBLIC_SANITY_PROJECT_ID niet ingesteld — valt terug op productie-project')
  if (!process.env.NEXT_PUBLIC_SANITY_DATASET) console.warn('[sanity] NEXT_PUBLIC_SANITY_DATASET niet ingesteld — valt terug op "production"')
}

export const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '60u1z6xa',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-28',
  useCdn: true,
})

const builder = createImageUrlBuilder(client)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function urlFor(source: any) {
  return builder.image(source)
}
