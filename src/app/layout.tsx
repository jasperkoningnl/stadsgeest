import type { Metadata } from 'next'
import { Hanken_Grotesk, Source_Serif_4, JetBrains_Mono } from 'next/font/google'
import './globals.css'
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
    template: '%s — Stadsgeest',
    default: 'Stadsgeest — persbureau voor lokale journalistiek',
  },
  description:
    'Stadsgeest doorzoekt dagelijks honderden openbare bronnen op zoek naar lokaal nieuws dat blijft liggen, en levert de vondsten aan lokale redacties.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: 'Stadsgeest',
    locale: 'nl_NL',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="nl"
      data-theme="dark"
      suppressHydrationWarning
      className={`${hankenGrotesk.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
