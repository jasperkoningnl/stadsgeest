// Kleine, statische grafieken voor het woondashboard. Servercomponenten zonder
// bibliotheek: de aantallen zijn klein en de pagina moet ook zonder JavaScript
// leesbaar zijn. Kleuren komen uit globals.css (--wo-a, --wo-b, --wo-rest) en
// zijn voor licht en donker apart gecontroleerd op kleurenblindheid en contrast.

export interface StapelReeks {
  label: string
  waarden: number[]
  klasse: 'a' | 'b' | 'rest'
}

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export function maandLabel(maand: string): string {
  const m = Number(maand.slice(5, 7))
  return `${MAANDEN[m - 1] ?? maand} ’${maand.slice(2, 4)}`
}

function nl(n: number): string {
  return n.toLocaleString('nl-NL')
}

/**
 * Gestapelde kolommen per periode. Elke kolom heeft een native tooltip met de
 * uitsplitsing; de totalen staan boven de kolom, de reeksen in een legenda.
 */
export function StapelKolommen({ labels, reeksen, eenheid = '' }: { labels: string[]; reeksen: StapelReeks[]; eenheid?: string }) {
  const totalen = labels.map((_, i) => reeksen.reduce((s, r) => s + (r.waarden[i] ?? 0), 0))
  const piek = Math.max(1, ...totalen)
  return (
    <figure className="np-wo-figuur">
      <div className="np-wo-kolommen" role="img" aria-label={labels.map((l, i) => `${l}: ${nl(totalen[i])}${eenheid}`).join('; ')}>
        {labels.map((label, i) => (
          <div
            key={label}
            className="np-wo-kolom"
            title={`${label}: ${nl(totalen[i])}${eenheid}\n${reeksen.map((r) => `${r.label}: ${nl(r.waarden[i] ?? 0)}`).join('\n')}`}
          >
            <span className="np-wo-kolom-getal">{nl(totalen[i])}</span>
            <span className="np-wo-kolom-bak">
              {reeksen.map((r) => {
                const w = r.waarden[i] ?? 0
                if (w <= 0) return null
                return <span key={r.label} className={`np-wo-segment np-wo-${r.klasse}`} style={{ height: `${(w / piek) * 100}%` }} />
              })}
            </span>
            <span className="np-wo-kolom-label">{label}</span>
          </div>
        ))}
      </div>
      <figcaption className="np-wo-legenda">
        {reeksen.map((r) => (
          <span key={r.label}><i className={`np-wo-stip np-wo-${r.klasse}`} />{r.label}</span>
        ))}
      </figcaption>
    </figure>
  )
}

/** Liggende staven, één kleur, van groot naar klein. Het getal staat direct achter de staaf. */
export function Staven({ rijen, klasse = 'a', max }: { rijen: { label: string; waarde: number; detail?: string }[]; klasse?: 'a' | 'b'; max?: number }) {
  const piek = Math.max(1, max ?? Math.max(...rijen.map((r) => r.waarde)))
  return (
    <ul className="np-wo-staven" role="list">
      {rijen.map((r) => (
        <li key={r.label} title={r.detail ?? `${r.label}: ${nl(r.waarde)}`}>
          <span className="np-wo-staaf-label">{r.label}</span>
          <span className="np-wo-staaf-bak">
            <span className={`np-wo-staaf np-wo-${klasse}`} style={{ width: `${Math.max(1, (r.waarde / piek) * 100)}%` }} />
          </span>
          <span className="np-wo-staaf-getal">{nl(r.waarde)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Tegel met één kerncijfer. */
export function Tegel({ getal, label, toelichting }: { getal: string | number; label: string; toelichting?: string }) {
  return (
    <div className="np-wo-tegel" title={toelichting}>
      <div className="np-wo-tegel-getal">{typeof getal === 'number' ? nl(getal) : getal}</div>
      <div className="np-wo-tegel-label">{label}</div>
      {toelichting && <div className="np-wo-tegel-toel">{toelichting}</div>}
    </div>
  )
}
