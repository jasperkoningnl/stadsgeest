import type { LeerAttributie, LeerDashboard, LeerVerdeling } from '@/lib/dashboard/beheerQueries'
import Maandreview from './Maandreview'

function pct(value: number | null) { return value === null ? '—' : `${Math.round(value * 100)}%` }
function label(value: string) { return value.replaceAll('_', ' ') }

function Verdeling({ titel, rijen }: { titel: string; rijen: LeerVerdeling[] }) {
  return <div className="np-beheer-kaart"><p className="np-beheer-trechter-titel">{titel}</p><ul className="np-leer-lijst">
    {rijen.map(rij => <li key={rij.label}><span>{label(rij.label)}</span><strong>{rij.aantal}</strong></li>)}
    {rijen.length === 0 && <li><span>Nog geen oordelen</span></li>}
  </ul></div>
}

function Attributie({ titel, rijen }: { titel: string; rijen: LeerAttributie[] }) {
  return <div><p className="np-telling">{titel}</p><div className="np-beheer-tabel-wrap"><table className="np-tabel">
    <thead><tr><th>Naam</th><th>Oordelen</th><th>Bruikbaar</th><th>Bewijsniveau</th></tr></thead>
    <tbody>{rijen.map(rij => <tr key={rij.sleutel}><td>{rij.naam}</td><td>{rij.beoordeeld}</td><td>{rij.bruikbaar}</td><td>{label(rij.bewijs)}</td></tr>)}</tbody>
  </table></div></div>
}

export default function LerenTab({ data, periodeLabel }: { data: LeerDashboard; periodeLabel: string }) {
  return <div>
    <div className="np-beheer-kaart">
      <p className="np-beheer-trechter-titel">Redactionele uitkomsten — {periodeLabel}</p>
      <div className="np-weging-stats">
        <div className="np-weging-stat"><span className="np-weging-stat-getal">{data.beoordeeld}</span><span className="np-weging-stat-label">unieke oordelen</span></div>
        <div className="np-weging-stat"><span className="np-weging-stat-getal np-weging-stat-groen">{pct(data.precision)}</span><span className="np-weging-stat-label">bruikbaar van meetbaar</span></div>
        <div className="np-weging-stat"><span className="np-weging-stat-getal">{pct(data.duplicateRate)}</span><span className="np-weging-stat-label">duplicaten</span></div>
        <div className="np-weging-stat"><span className="np-weging-stat-getal">{data.ongebruikt}/{data.signalen}</span><span className="np-weging-stat-label">signalen zonder tip</span></div>
        <div className="np-weging-stat"><span className="np-weging-stat-getal np-weging-stat-groen">{data.zonderStadsgeest}/{data.artikelen}</span><span className="np-weging-stat-label">zonder Stadsgeest gemist</span></div>
      </div>
      <p className="np-tekst np-stil">Bekende onderwerpen en timing tellen niet als kwaliteitsfout. Elk artikel telt één keer, ook als meerdere tips eraan bijdragen.</p>
    </div>
    {(data.beoordeeld < 30 || data.ontbrekendeContext > 0) && <div className="np-paneel np-paneel-let-op">
      <strong>Nog niet automatisch bijstellen.</strong>
      <p>{data.beoordeeld < 30 ? `Er zijn ${data.beoordeeld} unieke oordelen; pas vanaf 30 is handmatige kalibratie verantwoord.` : ''} {data.ontbrekendeContext ? `${data.ontbrekendeContext} oordelen missen attributie.` : ''}</p>
    </div>}
    <div className="np-leer-grid"><Verdeling titel="Uitkomsten" rijen={data.verdicten} /><Verdeling titel="Wat werd beoordeeld" rijen={data.dimensies} /></div>
    <Attributie titel="Bijdrage per bron" rijen={data.bronnen} />
    <Attributie titel="Uitkomsten per detectieregel" rijen={data.regels} />
    <div className="np-beheer-kaart" style={{ marginTop: 24 }}>
      <p className="np-beheer-trechter-titel">Maandreview</p>
      <p className="np-tekst">Laatste cyclus: {data.reviewMaand ?? 'nog niet aangemaakt'} — {label(data.reviewStatus ?? 'open')}.</p>
      <p className="np-tekst np-stil">Beoordeel false positives, gemiste entiteiten en brongezondheid. Een drempel, brongewicht of regel verandert nooit vanuit dit scherm; daarvoor zijn minstens 50 oordelen, twee maandcycli en expliciete menselijke goedkeuring nodig.</p>
      {data.reviewMaand && data.reviewStatus && <Maandreview maand={data.reviewMaand} status={data.reviewStatus} />}
      {data.onderdrukteDubbeleFeedback > 0 && <p className="np-tekst np-stil">{data.onderdrukteDubbeleFeedback} historische dubbele handeling is bewaard maar niet meegeteld.</p>}
    </div>
  </div>
}
