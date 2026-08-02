import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getDwarsverbanden, type DwarsverbandItem } from '@/lib/dashboard/queries'
import { formatDate, SIGNAL_STATUS_META, BETROUWBAARHEID_META } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

const DETECTOR_META: Record<string, { label: string; desc: string }> = {
  KRUISBRON: { label: 'Kruisbron', desc: 'zelfde entiteit duikt op in meerdere bronklassen' },
  STAPELING: { label: 'Stapeling', desc: 'plotselinge concentratie documenten rond één entiteit' },
  SUBSIDIE: { label: 'Subsidie-anomalie', desc: 'opvallende mutatie of stapeling in subsidiebedragen' },
  ROLCONFLICT: { label: 'Rolconflict', desc: 'bestuurder en eigen organisatie samen genoemd in een tier 1-document' },
}

function DwarsverbandCard({ item }: { item: DwarsverbandItem }) {
  const betrouwbaarheid = item.betrouwbaarheid ? BETROUWBAARHEID_META[item.betrouwbaarheid] : null
  const detector = item.detector ? DETECTOR_META[item.detector] : null
  const statusMeta = SIGNAL_STATUS_META[item.signalStatus]

  return (
    <div className="dash-dwars-card">
      <div className="dash-dwars-card-top">
        <div className="dash-dwars-card-badges">
          {item.kind === 'label' ? (
            <span className="dash-pill" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>Gelabeld: dwarsverband</span>
          ) : (
            <span className="dash-pill" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }} title={detector?.desc}>
              {detector?.label ?? item.detector ?? 'Detectie'}
            </span>
          )}
          {betrouwbaarheid && (
            <span className="dash-pill" style={{ background: `${betrouwbaarheid.color}22`, color: betrouwbaarheid.color }}>
              Betrouwbaarheid: {betrouwbaarheid.label}
            </span>
          )}
        </div>
        <span className="dash-dwars-card-date">{formatDate(item.lastSeenAt)}</span>
      </div>

      {item.entity && <div className="dash-dwars-entity">{item.entity}</div>}
      {item.info && <p className="dash-dwars-info">{item.info}</p>}
      {item.vraag && (
        <p className="dash-dwars-vraag"><strong>Journalistieke vraag:</strong> {item.vraag}</p>
      )}

      {item.entities.length > 0 && (
        <div className="ents-list mt8">
          {item.entities.slice(0, 8).map((e) => (
            <span key={e} className="ent-chip" style={{ cursor: 'default' }}>{e}</span>
          ))}
        </div>
      )}

      <div className="dash-dwars-card-footer">
        <Link href={`/dashboard/signaal/${item.signalId}`} className="dash-dwars-signal-link">
          → {item.signalTitle}
        </Link>
        <div className="dash-dwars-card-meta">
          {statusMeta && (
            <span className="dash-pill" style={{ background: `${statusMeta.color}22`, color: statusMeta.color }}>
              {statusMeta.label}
            </span>
          )}
          {item.bronKlassen.map((b) => (
            <span key={b} className="dash-pr-card-category">{b}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default async function DwarsverbandenPage() {
  if (!hasTurso()) return <NoDatabase />

  const { items, supported } = await getDwarsverbanden()

  if (!supported) {
    return (
      <div className="empty-state">
        Dwarsverbanden-detectie is nog niet actief op deze database — de kolom <code>signals.crossref_briefing</code> ontbreekt.
      </div>
    )
  }

  return (
    <div>
      <p className="dash-sub mt8" style={{ maxWidth: 760, marginBottom: 24 }}>
        Signalen die de speurder als dwarsverband labelt, plus losse detecties van dwarsverbanden2.cjs (kruisbron, stapeling,
        subsidie-anomalie, rolconflict). Nooit een kant-en-klaar verhaal — wel een vertrekpunt om documenten naast elkaar te
        leggen. Gesorteerd op betrouwbaarheid, dan op datum.
      </p>

      {items.length === 0 ? (
        <div className="empty-state">Nog geen dwarsverbanden gevonden.</div>
      ) : (
        <div className="dash-dwars-list">
          {items.map((item, i) => (
            <DwarsverbandCard key={`${item.signalId}-${item.kind}-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
