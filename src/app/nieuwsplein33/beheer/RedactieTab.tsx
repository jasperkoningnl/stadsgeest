import type { Doorstroom } from '@/lib/dashboard/beheerQueries'
import { formatDate } from '@/lib/dashboard/format'

// Beheer > Redactie: de doorstroom van tips. Niet hoeveel de machine maakt,
// maar hoe snel de redactie beslist en hoe oud de wachtrij is. Alleen Jasper.

function uren(u: number | null): string {
  if (u === null) return '–'
  if (u < 48) return `${Math.round(u)} u`
  return `${Math.round(u / 24)} d`
}

export default function RedactieTab({ data }: { data: Doorstroom }) {
  const w = data.wachtrij
  const maxWeek = Math.max(1, ...data.weken.map((x) => Math.max(x.gemaakt, x.beslist)))
  return (
    <div>
      <div className="np-beheer-kaart">
        <p className="np-beheer-trechter-titel">Wachtrij nu</p>
        <div className="np-weging-stats">
          <div className="np-weging-stat"><span className="np-weging-stat-getal">{w.totaal}</span><span className="np-weging-stat-label">in de wachtrij</span></div>
          <div className="np-weging-stat"><span className="np-weging-stat-getal np-weging-stat-groen">{w.totWeek}</span><span className="np-weging-stat-label">tot een week</span></div>
          <div className="np-weging-stat"><span className="np-weging-stat-getal np-weging-stat-amber">{w.totMaand}</span><span className="np-weging-stat-label">een week tot een maand</span></div>
          <div className="np-weging-stat"><span className="np-weging-stat-getal np-weging-stat-rood">{w.ouder}</span><span className="np-weging-stat-label">ouder dan een maand</span></div>
          <div className="np-weging-stat"><span className="np-weging-stat-getal">{w.oudsteDagen ?? '–'}</span><span className="np-weging-stat-label">dagen, oudste tip</span></div>
        </div>
        <p className="np-tekst np-stil">
          Van alle {data.tipsTotaal} tips kregen er {data.beslistTotaal} een eerste beslissing, mediaan na {uren(data.mediaanUrenTotaal)}.
          Een supertip of een tip die via &ldquo;ouder dan een maand&rdquo; wordt afgesloten telt gewoon mee.
        </p>
      </div>

      <p className="np-telling" style={{ marginTop: 24 }}>Per week: gemaakt tegenover beslist</p>
      <div className="np-beheer-tabel-wrap">
        <table className="np-tabel np-doorstroom">
          <thead>
            <tr><th>Week van</th><th>Gemaakt</th><th>Beslist</th><th>Mediaan tot beslissing</th><th></th></tr>
          </thead>
          <tbody>
            {data.weken.map((x) => (
              <tr key={x.week}>
                <td>{formatDate(`${x.week}T12:00:00Z`)}</td>
                <td>{x.gemaakt}</td>
                <td>{x.beslist}{x.gemaakt > 0 && <span className="np-stil"> ({Math.round((x.beslist / x.gemaakt) * 100)}%)</span>}</td>
                <td>{uren(x.mediaanUren)}</td>
                <td className="np-doorstroom-balk-cel">
                  <div className="np-doorstroom-balk" aria-hidden>
                    <span className="np-doorstroom-gemaakt" style={{ width: `${(x.gemaakt / maxWeek) * 100}%` }} />
                    <span className="np-doorstroom-beslist" style={{ width: `${(x.beslist / maxWeek) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="np-tekst np-stil">
        &ldquo;Beslist&rdquo; telt de tips uit die week die inmiddels een eerste beslissing hebben, ook als die later viel.
        Heropenen telt niet als beslissing.
      </p>

      <p className="np-telling" style={{ marginTop: 24 }}>Beslissingen per gebruiker, afgelopen 30 dagen</p>
      {data.gebruikers.length === 0 ? (
        <p className="np-leeg">Geen beslissingen in de afgelopen 30 dagen.</p>
      ) : (
        <div className="np-beheer-tabel-wrap">
          <table className="np-tabel">
            <thead>
              <tr><th>Gebruiker</th><th>Opgepakt</th><th>Geparkeerd</th><th>Afgewezen</th><th>Heropend</th><th>Totaal</th></tr>
            </thead>
            <tbody>
              {data.gebruikers.map((g) => (
                <tr key={g.gebruiker}>
                  <td>{g.gebruiker}</td><td>{g.goedgekeurd}</td><td>{g.geparkeerd}</td><td>{g.afgekeurd}</td><td>{g.heropend}</td><td><strong>{g.totaal}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
