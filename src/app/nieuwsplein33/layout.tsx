import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import RedactieNav from './RedactieNav'
import ThemaSchakelaar from './ThemaSchakelaar'
import FeedbackBalk from './FeedbackBalk'
import UitlegToggle from './UitlegToggle'
import { hasTurso } from '@/lib/turso'
import { getStatusTellingen } from '@/lib/dashboard/tipQueries'
import { getIntakeRuns } from '@/lib/dashboard/beheerQueries'
import { laatsteLogboekDatum } from '@/lib/dashboard/logboek'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import { formatDateTime } from '@/lib/dashboard/format'
import { getVerbruikSamenvatting, isQuotumBlokkade } from '@/lib/dashboard/tursoVerbruik'

export const metadata: Metadata = {
  title: 'Redactie · Nieuwsplein33',
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
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)

  // Een databasefout in de kop mag niet het hele dashboard omleggen. Op 26
  // september blokkeerde Turso alle reads (quotum op) en gaf elke pagina een
  // 500 zonder uitleg. Nu toont de kop een melding en blijft Beheer > Verbruik,
  // dat de database niet nodig heeft, bereikbaar.
  const fout: { soort: 'geblokkeerd' | 'fout' | null } = { soort: null }
  const opvangen = <T,>(p: Promise<T>, leeg: T) => p.catch((e: unknown) => {
    fout.soort = isQuotumBlokkade(e) ? 'geblokkeerd' : (fout.soort ?? 'fout')
    console.error('[layout] databasefout:', e)
    return leeg
  })
  const [tellingen, laatsteLogDatum, runs, verbruik] = await Promise.all([
    hasTurso() ? opvangen(getStatusTellingen(), {}) : Promise.resolve({}),
    laatsteLogboekDatum(),
    hasTurso() ? opvangen(getIntakeRuns(1), []) : Promise.resolve([]),
    gebruiker === 'jasper' ? getVerbruikSamenvatting() : Promise.resolve(null),
  ])
  const beheerLetOp = !!verbruik?.beschikbaar && verbruik.status !== 'ok'
  const dbFout = fout.soort

  const laatsteRun = runs[0] ?? null

  return (
    <div className="np-vlak">
      <script dangerouslySetInnerHTML={{ __html: THEMA_SCRIPT }} />
      <div className="np-kolom page-in">
        {/* Kop: merk en titel op één regel, sessie rechts, runregel eronder.
            Daarna direct de tabs; alles samen vormt één blok. */}
        <header className="np-kop">
          <div className="np-kop-rij">
            <div className="np-kop-titel">
              <Link href="/" className="np-merk" title="Naar de voorpagina van Stadsgeest">
                Stadsgeest<span>*</span>
              </Link>
              <div className="np-hdr-titel">Nieuwstips</div>
            </div>
            <div className="np-top-rechts">
              <ThemaSchakelaar />
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

        {/* Runregel: laatste intake + pipelinestatistieken */}
        <div className="np-runregel">
          {laatsteRun && (
            <>
              <span>
                Laatste intake{' '}
                <span className="np-runregel-tijd">{formatDateTime(laatsteRun.started_at)}</span>
              </span>
              {laatsteRun.items_in !== null && (
                <span><strong>{laatsteRun.items_in}</strong> items → <strong>{laatsteRun.signals_created ?? 0}</strong> signalen</span>
              )}
              {laatsteRun.status === 'error' && (
                <a href="/nieuwsplein33/beheer" title="Bekijk de foutmelding in Beheer">fout bij intake</a>
              )}
            </>
          )}
          <UitlegToggle>
            <p className="np-hdr-sub" style={{ marginTop: 8 }}>
              Stadsgeest doorzoekt dagelijks de openbare bronnen van Amersfoort en Leusden
              (bekendmakingen, raadsstukken, registers, rechtspraak) en legt hier voor wat de
              moeite van het bekijken waard lijkt.
            </p>
          </UitlegToggle>
        </div>

        <RedactieNav tellingen={tellingen} gebruiker={gebruiker} laatsteLogDatum={laatsteLogDatum} beheerLetOp={beheerLetOp} />
        {dbFout && (
          <div className="np-strook np-strook-fout" role="alert">
            <span className="np-strook-item">
              {dbFout === 'geblokkeerd'
                ? 'De database weigert op dit moment leesopdrachten: het leesquotum van Turso is op.'
                : 'De database gaf een fout. Niet alles hieronder is actueel.'}
            </span>
            {gebruiker === 'jasper' && (
              <a className="np-strook-item" href="/nieuwsplein33/beheer?tab=verbruik">Bekijk verbruik →</a>
            )}
          </div>
        )}
        {children}
      </div>
      <FeedbackBalk />
    </div>
  )
}
