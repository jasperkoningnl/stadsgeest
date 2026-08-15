import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  // LOGBOEK.md wordt tijdens het verzoek van schijf gelezen (zie
  // src/lib/dashboard/logboek.ts). Next spoort dat niet vanzelf op, dus het
  // bestand moet hier expliciet worden meegegeven — anders is het op Vercel
  // afwezig en blijft de logboekpagina leeg.
  outputFileTracingIncludes: {
    '/nieuwsplein33/**': ['./LOGBOEK.md'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
