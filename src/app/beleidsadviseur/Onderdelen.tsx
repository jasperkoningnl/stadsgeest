// Bouwstenen van het woondashboard: tegels, kaarten, grafieken zonder
// bibliotheek (servercomponenten; de pagina blijft zonder JavaScript
// leesbaar) en kleine opmaakhulpen. Kleuren komen uit woon.css.
import type { ReactNode } from 'react'
import { isQuotumBlokkade } from '@/lib/dashboard/tursoVerbruik'

export type Reeks = 's1' | 's2' | 's3' | 'rest'

export type Uitkomst<T> = { ok: true; data: T } | { ok: false; geblokkeerd: boolean; fout: string }

export async function vang<T>(p: Promise<T>, naam: string): Promise<Uitkomst<T>> {
  try {
    return { ok: true, data: await p }
  } catch (e) {
    console.error(`[beleidsadviseur] ${naam}:`, e)
    return { ok: false, geblokkeerd: isQuotumBlokkade(e), fout: e instanceof Error ? e.message : String(e) }
  }
}

export function nl(n: number | null | undefined, decimalen = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return n.toLocaleString('nl-NL', { maximumFractionDigits: decimalen, minimumFractionDigits: decimalen })
}

export function euro(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function pct(n: number | null | undefined, decimalen = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  return `${nl(n, decimalen)}%`
}

export function plusmin(n: number, decimalen = 0): string {
  return `${n > 0 ? '+' : ''}${nl(n, decimalen)}`
}

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const MAANDEN_LANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

export function maandLabel(maand: string): string {
  const m = Number(maand.slice(5, 7))
  return `${MAANDEN[m - 1] ?? maand} ’${maand.slice(2, 4)}`
}

export function maandNaam(nr: number): string {
  return MAANDEN_LANG[nr - 1] ?? String(nr)
}

export function Onbeschikbaar({ u }: { u: { geblokkeerd: boolean; fout?: string } }) {
  return (
    <p className="bd-onbeschikbaar">
      {u.geblokkeerd
        ? 'Tijdelijk niet beschikbaar: de database heeft haar maandelijkse leesquotum bereikt.'
        : 'Dit onderdeel kon niet worden geladen. Probeer het later opnieuw.'}
    </p>
  )
}

export function Kaart({ titel, sub, breed = 12, kinderen, voet, tekst }: {
  titel: string
  sub?: ReactNode
  breed?: 3 | 4 | 6 | 8 | 12
  kinderen: ReactNode
  voet?: ReactNode
  tekst?: ReactNode
}) {
  return (
    <section className={`bd-kaart bd-kaart-${breed}`}>
      <div className="bd-kaart-kop">
        <h3>{titel}</h3>
        {sub && <span className="bd-kaart-sub">{sub}</span>}
      </div>
      {tekst && <p className="bd-kaart-tekst">{tekst}</p>}
      {kinderen}
      {voet && <p className="bd-kaart-voet">{voet}</p>}
    </section>
  )
}

/** Tegel met één kerncijfer; `delta` toont het verschil met een vergelijkingsperiode. */
export function Tegel({ getal, label, toelichting, delta, deltaLabel }: {
  getal: string | number
  label: string
  toelichting?: string
  delta?: number | null
  deltaLabel?: string
}) {
  const d = delta ?? null
  return (
    <div className="bd-tegel" title={toelichting}>
      <div className="bd-tegel-getal">
        {typeof getal === 'number' ? nl(getal) : getal}
        {d !== null && (
          <span className={`bd-delta ${d > 0 ? 'bd-delta-plus' : d < 0 ? 'bd-delta-min' : 'bd-delta-stil'}`} title={deltaLabel}>
            {plusmin(d)}
          </span>
        )}
      </div>
      <div className="bd-tegel-label">{label}</div>
      {toelichting && <div className="bd-tegel-toel">{toelichting}</div>}
    </div>
  )
}

export interface StapelReeks { label: string; waarden: (number | null)[]; klasse: Reeks }

/**
 * Gestapelde kolommen in SVG met een vaste viewBox; schaalt mee met de kaart.
 * Alleen de laatste kolom (en de kolom met `markeer`) krijgt een getal; de
 * rest zit in de tooltip en de legenda. Bij veel kolommen worden labels
 * overgeslagen zodat ze niet botsen.
 */
export function Kolommen({ labels, reeksen, eenheid = '', markeer, getallen = 'laatste' }: {
  labels: string[]
  reeksen: StapelReeks[]
  eenheid?: string
  /** Index van een kolom die extra aandacht krijgt (bijvoorbeeld het lopende jaar). */
  markeer?: number
  getallen?: 'laatste' | 'alle' | 'geen'
}) {
  const B = 640, H = 200, links = 8, rechts = 8, boven = 18, onder = 24
  const totalen = labels.map((_, i) => reeksen.reduce((s, r) => s + (r.waarden[i] ?? 0), 0))
  const piek = Math.max(1, ...totalen)
  const n = Math.max(1, labels.length)
  const stap = (B - links - rechts) / n
  const breedte = Math.min(44, stap * 0.68)
  const hoogte = (v: number) => (v / piek) * (H - boven - onder)
  const labelStap = Math.max(1, Math.ceil(n / 12))
  return (
    <figure className="bd-figuur">
      <svg className="bd-kolommen" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={labels.map((l, i) => `${l}: ${nl(totalen[i])}${eenheid}`).join('; ')}>
        <line className="bd-as" x1={links} x2={B - rechts} y1={H - onder} y2={H - onder} />
        {labels.map((label, i) => {
          const x = links + stap * i + (stap - breedte) / 2
          const toonGetal = getallen === 'alle' || (getallen === 'laatste' && (i === n - 1 || i === markeer))
          let y = H - onder
          return (
            <g key={`${label}-${i}`} className={i === markeer ? 'bd-kolom-markeer' : undefined}>
              <title>{`${label}: ${nl(totalen[i])}${eenheid}${reeksen.length > 1 ? '\n' + reeksen.map((r) => `${r.label}: ${nl(r.waarden[i] ?? 0)}`).join('\n') : ''}`}</title>
              <rect className="bd-kolom-vang" x={links + stap * i} y={boven} width={stap} height={H - boven - onder} />
              {reeksen.map((r) => {
                const w = r.waarden[i] ?? 0
                if (w <= 0) return null
                const h = Math.max(1.5, hoogte(w))
                y -= h
                const rect = <rect key={r.label} className={`bd-segment bd-${r.klasse}`} x={x} y={y} width={breedte} height={Math.max(0, h - 1.5)} rx={1.5} />
                return rect
              })}
              {toonGetal && totalen[i] > 0 && <text className="bd-kolom-getal" x={x + breedte / 2} y={y - 4} textAnchor="middle">{nl(totalen[i])}</text>}
              {(i % labelStap === 0 || i === n - 1) && <text className="bd-kolom-label" x={x + breedte / 2} y={H - onder + 15} textAnchor="middle">{label}</text>}
            </g>
          )
        })}
      </svg>
      {reeksen.length > 1 && (
        <figcaption className="bd-legenda">
          {reeksen.map((r) => <span key={r.label}><i className={`bd-stip bd-${r.klasse}`} />{r.label}</span>)}
        </figcaption>
      )}
    </figure>
  )
}

export interface LijnReeks { label: string; waarden: (number | null)[]; klasse: Reeks }

/**
 * Lijngrafiek in SVG met een vaste viewBox; schaalt mee met de kaart. Eén
 * y-as, hairline-grid, eindlabel per reeks, tooltip per punt via <title>.
 */
export function Lijn({ labels, reeksen, eenheid = '', vanNul = false, formatteer = (v: number) => nl(v) }: {
  labels: string[]
  reeksen: LijnReeks[]
  eenheid?: string
  vanNul?: boolean
  formatteer?: (v: number) => string
}) {
  const B = 640, H = 220, links = 46, rechts = 70, boven = 14, onder = 28
  const alle = reeksen.flatMap((r) => r.waarden).filter((v): v is number => v !== null && Number.isFinite(v))
  if (alle.length === 0 || labels.length === 0) return <p className="bd-leeg">Geen cijfers beschikbaar.</p>
  let min = vanNul ? 0 : Math.min(...alle)
  let max = Math.max(...alle)
  if (max === min) { max += 1; min -= 1 }
  const marge = (max - min) * 0.08
  min = vanNul ? 0 : min - marge
  max += marge
  const x = (i: number) => links + (labels.length === 1 ? 0 : (i / (labels.length - 1)) * (B - links - rechts))
  const y = (v: number) => boven + (1 - (v - min) / (max - min)) * (H - boven - onder)
  const stappen = 4
  const grid = Array.from({ length: stappen + 1 }, (_, i) => min + ((max - min) * i) / stappen)
  const labelStap = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <figure className="bd-figuur">
      <svg className="bd-lijn" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={reeksen.map((r) => `${r.label}: ${labels.map((l, i) => `${l} ${r.waarden[i] === null ? '–' : formatteer(r.waarden[i] as number)}`).join(', ')}`).join('. ')}>
        {grid.map((g, i) => (
          <g key={i}>
            <line className="bd-grid" x1={links} x2={B - rechts} y1={y(g)} y2={y(g)} />
            <text x={links - 6} y={y(g) + 4} textAnchor="end">{formatteer(Math.round(g))}</text>
          </g>
        ))}
        <line className="bd-as" x1={links} x2={B - rechts} y1={H - onder} y2={H - onder} />
        {labels.map((l, i) => (i % labelStap === 0 || i === labels.length - 1) && (
          <text key={l} x={x(i)} y={H - onder + 16} textAnchor="middle">{l}</text>
        ))}
        {reeksen.map((r) => {
          const punten = r.waarden.map((v, i) => (v === null ? null : [x(i), y(v)] as const))
          let d = ''
          let open = false
          punten.forEach((p) => {
            if (!p) { open = false; return }
            d += `${open ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `
            open = true
          })
          const laatsteIdx = (() => { for (let i = r.waarden.length - 1; i >= 0; i--) if (r.waarden[i] !== null) return i; return -1 })()
          return (
            <g key={r.label}>
              <path className={`bd-pad-${r.klasse}`} d={d.trim()} />
              {punten.map((p, i) => p && (
                <circle key={i} className={`bd-punt-${r.klasse}`} cx={p[0]} cy={p[1]} r={3}>
                  <title>{`${r.label} · ${labels[i]}: ${formatteer(r.waarden[i] as number)}${eenheid}`}</title>
                </circle>
              ))}
              {laatsteIdx >= 0 && (
                <text className="bd-lijn-eind" x={x(laatsteIdx) + 8} y={y(r.waarden[laatsteIdx] as number) + 4}>{formatteer(r.waarden[laatsteIdx] as number)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {reeksen.length > 1 && (
        <figcaption className="bd-legenda">
          {reeksen.map((r) => <span key={r.label}><i className={`bd-stip bd-stip-lijn bd-${r.klasse}`} />{r.label}</span>)}
        </figcaption>
      )}
    </figure>
  )
}

/** Liggende staven, optioneel gestapeld (meerdere segmenten per rij). */
export function Staven({ rijen, klasse = 's1', max, formatteer = (v: number) => nl(v) }: {
  rijen: { label: string; waarde: number; detail?: string; href?: string; markeer?: boolean; segmenten?: { waarde: number; klasse: Reeks }[] }[]
  klasse?: Reeks
  max?: number
  formatteer?: (v: number) => string
}) {
  const piek = Math.max(1, max ?? Math.max(...rijen.map((r) => r.waarde)))
  return (
    <ul className="bd-staven" role="list">
      {rijen.map((r) => (
        <li key={r.label} title={r.detail ?? `${r.label}: ${formatteer(r.waarde)}`} className={r.markeer ? 'bd-staaf-markeer' : undefined}>
          <span className="bd-staaf-label">{r.href ? <a href={r.href}>{r.label}</a> : r.label}</span>
          <span className="bd-staaf-bak">
            {r.segmenten
              ? r.segmenten.filter((s) => s.waarde > 0).map((s, i) => <span key={i} className={`bd-staaf bd-${s.klasse}`} style={{ width: `${(s.waarde / piek) * 100}%` }} />)
              : <span className={`bd-staaf bd-${klasse}`} style={{ width: `${Math.max(0.5, (r.waarde / piek) * 100)}%` }} />}
          </span>
          <span className="bd-staaf-getal">{formatteer(r.waarde)}</span>
        </li>
      ))}
    </ul>
  )
}

export type Status = 'let' | 'ernst' | 'goed' | 'info'

const STATUS_TEKST: Record<Status, string> = { let: 'let op', ernst: 'termijn', goed: 'op koers', info: 'nieuw' }
const STATUS_TEKEN: Record<Status, string> = { let: '!', ernst: '⏱', goed: '✓', info: '•' }

/** Lijst met aandachtspunten; status altijd met teken én woord, nooit alleen kleur. */
export function Aandacht({ punten }: {
  punten: { status: Status; statusTekst?: string; titel: ReactNode; waarom?: ReactNode; datum?: string }[]
}) {
  if (punten.length === 0) return <p className="bd-leeg">Niets dat nu aandacht vraagt.</p>
  return (
    <ul className="bd-aandacht">
      {punten.map((p, i) => (
        <li key={i}>
          <span className={`bd-aandacht-status bd-status-${p.status}`}><span aria-hidden="true">{STATUS_TEKEN[p.status]}</span>{p.statusTekst ?? STATUS_TEKST[p.status]}</span>
          <div className="bd-aandacht-inhoud">
            {p.titel}
            {p.datum && <span className="bd-aandacht-datum">{p.datum}</span>}
            {p.waarom && <span className="bd-aandacht-waarom">{p.waarom}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Voortgangsmeter tegen een doel. */
export function Meter({ waarde, doel, label, formatteer = (v: number) => nl(v) }: { waarde: number; doel: number; label?: string; formatteer?: (v: number) => string }) {
  const max = Math.max(doel, waarde) * 1.05
  return (
    <div className="bd-meter" title={label}>
      <span className="bd-meter-bak">
        <span className="bd-meter-vul" style={{ width: `${Math.min(100, (waarde / max) * 100)}%` }} />
        <span className="bd-meter-doel" style={{ left: `${(doel / max) * 100}%` }} />
      </span>
      <span className="bd-meter-getal">{formatteer(waarde)} van {formatteer(doel)}</span>
    </div>
  )
}

export function Extern({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}
