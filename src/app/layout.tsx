import type { Metadata } from 'next'
import { Space_Grotesk, Lora } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  style: ['normal', 'italic'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s — Stadsgeest 033',
    default: 'Stadsgeest 033 — Nieuws uit Amersfoort',
  },
  description: 'AI-gedreven lokaal nieuws voor Amersfoort. Altijd transparant over herkomst.',
  metadataBase: new URL('https://stadsgeest.nl'),
  openGraph: {
    siteName: 'Stadsgeest 033',
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
      className={`${spaceGrotesk.variable} ${lora.variable}`}
    >
      <head>
        {/* Anti-FOUC: apply saved theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  )
}
