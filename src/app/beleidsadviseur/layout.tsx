import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import ThemaSchakelaar from '../nieuwsplein33/ThemaSchakelaar'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import TabBalk from './TabBalk'
import './woon.css'

export const metadata: Metadata = {
  title: 'Woondashboard Amersfoort',
  robots: { index: false, follow: false },
}

// Het woondashboard leest uit dezelfde database als het redactiedashboard en
// daarnaast rechtstreeks uit CBS StatLine, maar is een eigen product voor een
// externe gebruiker: de beleidsadviseur wonen van de gemeente Amersfoort.
// Eigen stijl (woon.css), eigen tabbladen, geen redactienavigatie, geen tips.
// Alleen het account 'adviseur' en Jasper komen hier (zie dashboardAuth.ts).

const THEMA_SCRIPT = `try{var t=localStorage.getItem('np-thema');if(t==='licht'||t==='donker'){document.documentElement.setAttribute('data-np-thema',t)}}catch(e){}`

export default async function BeleidLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)
  const jasper = gebruiker === 'jasper'

  return (
    <div className="bd-vlak">
      <script dangerouslySetInnerHTML={{ __html: THEMA_SCRIPT }} />
      <div className="bd-kolom">
        <header className="bd-kop">
          <div className="bd-kop-rij">
            <div className="bd-kop-titel">
              <div className="bd-kop-boven"><Link href="/" title="Naar de voorpagina van Stadsgeest">Stadsgeest</Link> · gemeente Amersfoort</div>
              <h1>Woondashboard Amersfoort</h1>
            </div>
            <div className="bd-kop-rechts">
              <ThemaSchakelaar />
              {jasper && <Link href="/nieuwsplein33" className="np-sessie-uitloggen">Naar de redactie</Link>}
              {gebruiker && (
                <div className="np-sessie">
                  <span className="np-sessie-tekst" title={`Ingelogd als ${gebruiker}`}><strong>{gebruiker}</strong></span>
                  <form method="POST" action="/api/auth/logout">
                    <button type="submit" className="np-sessie-uitloggen">Uitloggen</button>
                  </form>
                </div>
              )}
            </div>
          </div>
          <TabBalk />
        </header>
        {children}
      </div>
    </div>
  )
}
