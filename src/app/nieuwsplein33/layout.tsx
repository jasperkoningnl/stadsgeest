import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import RedactieNav from './RedactieNav'
import ThemaSchakelaar from './ThemaSchakelaar'
import FeedbackBalk from './FeedbackBalk'
import { hasTurso } from '@/lib/turso'
import { getStatusTellingen } from '@/lib/dashboard/tipQueries'
import { laatsteLogboekDatum } from '@/lib/dashboard/logboek'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'

export const metadata: Metadata = {
  title: 'Redactie — Nieuwsplein33',
  robots: { index: false, follow: false },
}

// De tellers in de navigatie moeten meelopen met de beslissingen van de redactie.
export const dynamic = 'force-dynamic'

// Zet een opgeslagen themakeuze op <html> vóór de eerste render, zodat er geen
// flits is. Zonder opgeslagen keuze blijft het attribuut weg en volgt de CSS
// de systeemvoorkeur.
const THEMA_SCRIPT = `try{var t=localStorage.getItem('np-thema');if(t==='licht'||t==='donker'){document.documentElement.setAttribute('data-np-thema',t)}}catch(e){}`

export default async function RedactieLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const [tellingen, gebruiker, laatsteLogDatum] = await Promise.all([
    hasTurso() ? getStatusTellingen() : Promise.resolve({}),
    sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value),
    laatsteLogboekDatum(),
  ])

  return (
    <div className="np-vlak">
      <script dangerouslySetInnerHTML={{ __html: THEMA_SCRIPT }} />
      <div className="np-kolom page-in">
        <header className="np-top">
          <div>
            <Link href="/" className="np-merk" title="Naar de voorpagina van Stadsgeest">
              Stadsgeest<span>*</span>
            </Link>
            <div className="np-hdr-titel">Nieuwstips</div>
            <p className="np-hdr-sub">
              Stadsgeest doorzoekt dagelijks de openbare bronnen van Amersfoort en Leusden —
              bekendmakingen, raadsstukken, registers, rechtspraak — en legt hier voor wat de
              moeite van het bekijken waard lijkt.
            </p>
          </div>
          <div className="np-top-rechts">
            <ThemaSchakelaar />
            {gebruiker && (
              <div className="np-sessie">
                <span className="np-sessie-tekst">
                  Ingelogd als <strong>{gebruiker}</strong>
                </span>
                <form method="POST" action="/api/auth/logout">
                  <button type="submit" className="np-sessie-uitloggen">Uitloggen</button>
                </form>
              </div>
            )}
          </div>
        </header>
        <RedactieNav tellingen={tellingen} gebruiker={gebruiker} laatsteLogDatum={laatsteLogDatum} />
        {children}
      </div>
      <FeedbackBalk />
    </div>
  )
}
