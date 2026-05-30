import type { Metadata } from 'next'
import { Hanken_Grotesk, Source_Serif_4, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { client } from '@/lib/sanity'
import { SITE_URL } from '@/lib/site'

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  style: ['normal', 'italic'],
  weight: ['400', '600'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s — Stadsgeest 033',
    default: 'Stadsgeest 033 — Nieuws uit Amersfoort',
  },
  description: 'AI-gedreven lokaal nieuws voor Amersfoort. Altijd transparant over herkomst.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: 'Stadsgeest 033',
    locale: 'nl_NL',
    type: 'website',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const navTags = await client.fetch(
    `*[_type == "tag"] {
      name, slug,
      "count": count(*[_type == "article" && status == "published" && ^._id in tags[]._ref])
    } | order(count desc) [0...6]`,
    {},
    { next: { revalidate: 300 } }
  ).catch(() => [])
  return (
    <html
      lang="nl"
      data-theme="dark"
      suppressHydrationWarning
      className={`${hankenGrotesk.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Header navTags={navTags} />
        {children}
        <Footer />
      </body>
    </html>
  )
}
