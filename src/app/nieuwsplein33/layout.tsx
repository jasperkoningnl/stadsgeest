import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import RedactieNav from './RedactieNav'
import { hasTurso } from '@/lib/turso'
import { getStatusTellingen } from '@/lib/dashboard/tipQueries'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'

export const metadata: Metadata = {
  title: 'Redactie — Nieuwsplein33',
  robots: { index: false, follow: false },
}

// De tellers in de navigatie moeten meelopen met de beslissingen van de redactie.
export const dynamic = 'force-dynamic'

export default async function RedactieLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const [tellingen, gebruiker] = await Promise.all([
    hasTurso() ? getStatusTellingen() : Promise.resolve({}),
    sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value),
  ])

  return (
    <div className="wrap page-in" style={{ paddingBottom: 80 }}>
      <header className="np-hdr">
        <div className="np-hdr-titel">Nieuwstips</div>
        <p className="np-hdr-sub">
          Stadsgeest doorzoekt dagelijks openbare bronnen van Amersfoort en Leusden — bekendmakingen,
          raadsstukken, registers, rechtspraak, aanbestedingen — en legt hier voor wat de moeite van
          het bekijken waard lijkt. Bij elke tip staat waar hij vandaan komt en hoe hij is gevonden.
        </p>
      </header>
      <RedactieNav tellingen={tellingen} gebruiker={gebruiker} />
      {children}
    </div>
  )
}
