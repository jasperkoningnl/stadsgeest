import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { hasTurso } from '@/lib/turso'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import { getLogboek } from '@/lib/dashboard/logboek'
import { getDashboardFeedback, type DashboardFeedback } from '@/lib/dashboard/feedbackQueries'
import { formatDate, formatDateTime } from '@/lib/dashboard/format'
import FeedbackFormulier from '../FeedbackFormulier'
import LogboekGelezen from './LogboekGelezen'

export const metadata: Metadata = {
  title: 'Logboek — Nieuwsplein33',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const SOORT_LABEL: Record<string, string> = {
  onduidelijk: 'onduidelijk',
  ontbreekt: 'ontbreekt',
  werkt_niet: 'werkt niet',
  werkt_goed: 'werkt goed',
  anders: 'anders',
}

export default async function LogboekPagina() {
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)

  const items = await getLogboek()
  const feedback =
    gebruiker === 'jasper' && hasTurso() ? await getDashboardFeedback() : []

  return (
    <div>
      <LogboekGelezen datum={items[0]?.datum ?? null} />

      <p className="np-telling">Wat er is veranderd</p>

      {items.length === 0 ? (
        <p className="np-leeg">Nog niets vastgelegd.</p>
      ) : (
        <ol className="np-logboek">
          {items.map((item) => (
            <li key={`${item.datum}-${item.kop}`} className="np-logboek-item">
              {/* Middaguur toevoegen: formatDate rekent naar Europe/Amsterdam en een
                  kale datum zou anders per tijdzone een dag kunnen verspringen. */}
              <div className="np-logboek-datum">{formatDate(`${item.datum}T12:00:00Z`)}</div>
              <div className="np-logboek-inhoud">
                <h3 className="np-logboek-kop">{item.kop}</h3>
                {item.blokken.map((blok, i) =>
                  blok.soort === 'lijst' ? (
                    <ul key={i} className="np-logboek-lijst">
                      {blok.regels.map((r, j) => <li key={j}>{r}</li>)}
                    </ul>
                  ) : (
                    blok.regels.map((r, j) => <p key={`${i}-${j}`} className="np-tekst">{r}</p>)
                  ),
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <section className="np-fb-blok">
        <p className="np-telling">Laat iets weten</p>
        <p className="np-tekst np-stil">
          Dit gaat over het dashboard zelf: wat onduidelijk is, wat ontbreekt, wat niet werkt.
          Het komt bij Jasper terecht, en wat eruit volgt komt hierboven te staan. Gaat het over
          één tip — waarom die wel of niet bruikbaar was — gebruik dan de knoppen onder die tip.
        </p>
        <FeedbackFormulier aanleiding="logboek" />
      </section>

      {gebruiker === 'jasper' && <BinnengekomenFeedback rijen={feedback} />}
    </div>
  )
}

/** Alleen voor Jasper: wat er is binnengekomen, nieuwste bovenaan. */
function BinnengekomenFeedback({ rijen }: { rijen: DashboardFeedback[] }) {
  return (
    <section style={{ marginTop: 32 }}>
      <p className="np-telling">Binnengekomen feedback ({rijen.length})</p>
      {rijen.length === 0 ? (
        <p className="np-leeg">Nog niets binnengekomen.</p>
      ) : (
        <ul className="np-fb-lijst">
          {rijen.map((f) => (
            <li key={f.id}>
              <div className="np-fb-meta">
                <strong>{f.gebruiker}</strong>
                <span className="np-stil">{formatDateTime(f.created_at)}</span>
                {f.soort && <span className="np-badge">{SOORT_LABEL[f.soort] ?? f.soort}</span>}
                {f.pagina && <span className="np-bron">{f.pagina}</span>}
                {f.aanleiding === 'balk' && <span className="np-bron-rest">via de balk</span>}
              </div>
              <p className="np-tekst">{f.tekst}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
