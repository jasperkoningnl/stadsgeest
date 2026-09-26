import Link from 'next/link'
import { mln, pct, type Onbeschikbaar, type VerbruikSamenvatting } from '@/lib/dashboard/tursoVerbruik'

// Werkbalk van Beheer in de vormtaal van de wachtrij: tabs als segment links,
// periode als tweede segment, meldingen rechts. De keuze staat in de URL
// (?tab=…&periode=…), zodat de server alleen de data van dat tabblad ophaalt.
export const BEHEER_TABS = [
  { id: 'verbruik', label: 'Verbruik' },
  { id: 'bronnen', label: 'Bronnen' },
  { id: 'intake', label: 'Intake' },
  { id: 'weging', label: 'Weging' },
  { id: 'leren', label: 'Leren' },
  { id: 'controleren', label: 'Controleren' },
] as const
export type BeheerTab = (typeof BEHEER_TABS)[number]['id']

const MET_PERIODE: BeheerTab[] = ['intake', 'weging', 'leren']
const PERIODES = [7, 14, 30]

function href(tab: BeheerTab, periode: number) {
  const p = new URLSearchParams({ tab })
  if (MET_PERIODE.includes(tab) && periode !== 7) p.set('periode', String(periode))
  return `/nieuwsplein33/beheer?${p.toString()}`
}

export default function BeheerWerkbalk({
  tab,
  periode,
  verbruik,
}: {
  tab: BeheerTab
  periode: number
  verbruik: VerbruikSamenvatting | Onbeschikbaar
}) {
  const waarschuwing = verbruik.beschikbaar && verbruik.status !== 'ok'
  return (
    <div className="np-werkbalk">
      <nav className="np-segment" aria-label="Onderdelen van Beheer">
        {BEHEER_TABS.map(t => (
          <Link
            key={t.id}
            href={href(t.id, periode)}
            className={`np-segment-knop${tab === t.id ? ' np-segment-knop-actief' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
            {t.id === 'verbruik' && waarschuwing && <span className="np-nav-stip" aria-label="waarschuwing" />}
          </Link>
        ))}
      </nav>

      {MET_PERIODE.includes(tab) && (
        <nav className="np-segment" aria-label="Periode">
          {PERIODES.map(d => (
            <Link
              key={d}
              href={href(tab, d)}
              className={`np-segment-knop${periode === d ? ' np-segment-knop-actief' : ''}`}
            >
              {d} dagen
            </Link>
          ))}
        </nav>
      )}

      {waarschuwing && tab !== 'verbruik' && (
        <div className="np-meldingen">
          <Link
            href={href('verbruik', periode)}
            className={`np-melding ${verbruik.status === 'let-op' || verbruik.status === 'boven-gratis' ? 'np-melding-let-op' : 'np-melding-kritiek'}`}
          >
            {verbruik.status === 'geblokkeerd'
              ? 'Turso blokkeert de database'
              : verbruik.status === 'boven-gratis'
              ? `Boven het gratis quotum (${pct(verbruik.gelezen)}) · geen blokkade op ${verbruik.plan}`
              : `Leesquotum ${pct(verbruik.gelezen)} · prognose ${mln(verbruik.prognose)}`}
            <span className="np-melding-pijl">→</span>
          </Link>
        </div>
      )}
    </div>
  )
}
