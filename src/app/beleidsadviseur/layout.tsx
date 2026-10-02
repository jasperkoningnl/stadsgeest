import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import ThemaSchakelaar from '../nieuwsplein33/ThemaSchakelaar'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'

export const metadata: Metadata = {
  title: 'Woondashboard Amersfoort',
  robots: { index: false, follow: false },
}

// Het woondashboard leest uit dezelfde database als het redactiedashboard, maar
// is een eigen pagina voor een externe gebruiker: de beleidsadviseur wonen van
// de gemeente Amersfoort. Geen redactienavigatie, geen tips, geen feedbackbalk.
// Alleen het account 'adviseur' en Jasper komen hier (zie dashboardAuth.ts).

const THEMA_SCRIPT = `try{var t=localStorage.getItem('np-thema');if(t==='licht'||t==='donker'){document.documentElement.setAttribute('data-np-thema',t)}}catch(e){}`

export default async function BeleidLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)
  const jasper = gebruiker === 'jasper'

  return (
    <div className="np-vlak">
      <script dangerouslySetInnerHTML={{ __html: THEMA_SCRIPT }} />
      <div className="np-kolom page-in">
        <header className="np-kop">
          <div className="np-kop-rij">
            <div className="np-kop-titel">
              <Link href="/" className="np-merk" title="Naar de voorpagina van Stadsgeest">
                Stadsgeest<span>*</span>
              </Link>
              <div className="np-hdr-titel">Woondashboard Amersfoort</div>
            </div>
            <div className="np-top-rechts">
              <ThemaSchakelaar />
              {jasper && (
                <Link href="/nieuwsplein33" className="np-sessie-uitloggen" style={{ textDecoration: 'none' }}>
                  Naar de redactie
                </Link>
              )}
              {gebruiker && (
                <div className="np-sessie">
                  <span className="np-sessie-tekst" title={`Ingelogd als ${gebruiker}`}>
                    <strong>{gebruiker}</strong>
                  </span>
                  <form method="POST" action="/api/auth/logout">
                    <button type="submit" className="np-sessie-uitloggen">Uitloggen</button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
