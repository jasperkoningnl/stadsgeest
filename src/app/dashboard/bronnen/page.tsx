import { Fragment } from 'react'
import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getSourcesOverview, getTierAggregates, type SourceRow } from '@/lib/dashboard/queries'
import { formatDate, SOURCE_HEALTH_META } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

const TIER_INTRO: Record<number, { title: string; body: string }> = {
  1: {
    title: 'Tier 1 — publicatiebronnen',
    body: 'Officiële documenten en registers: rechtspraakuitspraken, bekendmakingen, raadsstukken, inspectierapporten, aanbestedingen, subsidieregisters. Hier staat nieuws in dat nog nergens is gepubliceerd. Eén item uit zo’n bron is genoeg om een verhaal op te bouwen.',
  },
  2: {
    title: 'Tier 2 — corroboratiebronnen',
    body: 'Organisaties die over zichzelf publiceren: de gemeente, woningcorporaties, het ziekenhuis, de veiligheidsregio, het waterschap. Betrouwbaar, maar met een eigen belang. Ze bevestigen en verrijken wat elders is gevonden.',
  },
  3: {
    title: 'Tier 3 — detectiebronnen',
    body: 'Lokale media, 112-meldingen, buurtberichten, sociale media. Deze signaleren dát er iets speelt. Nooit op zichzelf een verhaal, wel vaak de snelste tip.',
  },
}

function HealthBadge({ source }: { source: SourceRow }) {
  if (!source.health) return null
  const meta = SOURCE_HEALTH_META[source.health] ?? { label: source.health, color: 'var(--t3)', desc: '' }
  const title = source.healthNote ? `${meta.desc ? `${meta.desc} — ` : ''}${source.healthNote}` : meta.desc
  return (
    <span className="dash-pill" style={{ background: `${meta.color}22`, color: meta.color }} title={title || undefined}>
      {meta.label}
    </span>
  )
}

function LastRunCell({ source }: { source: SourceRow }) {
  if (!source.lastRun) return <span style={{ color: 'var(--t3)' }}>nog geen run gelogd</span>
  const { itemsFound, status, startedAt } = source.lastRun
  const failed = status === 'error' || status === 'timeout'
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ color: failed ? 'var(--red, #c0392b)' : 'var(--t1)' }}>
        {itemsFound ?? 0} item{itemsFound === 1 ? '' : 's'}{status ? ` · ${status}` : ''}
      </div>
      <div style={{ color: 'var(--t3)' }}>{formatDate(startedAt)}</div>
    </div>
  )
}

function SourceProof({ source, defaultOpen }: { source: SourceRow; defaultOpen: boolean }) {
  if (source.topSignals.length === 0) return null
  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid var(--border-s)' }}>
        <details open={defaultOpen} style={{ padding: '0 14px 12px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--t3)', padding: '4px 0' }}>
            Laatste signalen uit deze bron
          </summary>
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {source.topSignals.map((sig) => (
              <li key={sig.id}>
                <Link href={`/dashboard/signaal/${sig.id}`} style={{ fontSize: 13.5, color: 'var(--accent)' }}>
                  {sig.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </td>
    </tr>
  )
}

function TierSection({ tier, aggregate, sources }: { tier: number; aggregate: { sourceCount: number; items: number; signals: number; published: number }; sources: SourceRow[] }) {
  const intro = TIER_INTRO[tier]
  return (
    <section className="mt24">
      <h2 style={{ fontFamily: 'var(--f-d)', fontWeight: 800, fontSize: 20, letterSpacing: '-0.01em', marginBottom: 6 }}>
        {intro.title}
      </h2>
      <p className="dash-sub" style={{ maxWidth: 760, marginBottom: 12 }}>{intro.body}</p>
      <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
        <strong style={{ color: 'var(--t1)' }}>{aggregate.sourceCount}</strong> bronnen ·{' '}
        <strong style={{ color: 'var(--t1)' }}>{aggregate.items.toLocaleString('nl-NL')}</strong> items ·{' '}
        <strong style={{ color: 'var(--t1)' }}>{aggregate.signals}</strong> signalen ·{' '}
        <strong style={{ color: 'var(--t1)' }}>{aggregate.published}</strong> gepubliceerde artikelen
      </p>

      {sources.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--t3)' }}>Nog geen bron in deze tier met opbrengst.</p>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Bron</th>
                <th>Type</th>
                <th>Items 30d</th>
                <th>Items totaal</th>
                <th>Signalen</th>
                <th>Gepubliceerd</th>
                <th>Gezondheid</th>
                <th>Laatste run</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <Fragment key={s.id}>
                  <tr>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        {s.url.length > 50 ? s.url.slice(0, 50) + '…' : s.url}
                      </a>
                    </td>
                    <td>{s.sourceType || '—'}</td>
                    <td>{s.items30d}</td>
                    <td>{s.itemsTotal}</td>
                    <td>{s.signalCount}</td>
                    <td>{s.publishedCount}</td>
                    <td><HealthBadge source={s} /></td>
                    <td style={{ maxWidth: 220 }}><LastRunCell source={s} /></td>
                  </tr>
                  <SourceProof source={s} defaultOpen={i < 3} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function BronnenPage() {
  if (!hasTurso()) return <NoDatabase />

  const [{ rows: allSources }, aggregates] = await Promise.all([getSourcesOverview(), getTierAggregates()])

  const producing = allSources.filter((s) => s.signalCount > 0)
  const noYield = allSources
    .filter((s) => s.signalCount === 0)
    .sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.name.localeCompare(b.name))

  const aggByTier = new Map(aggregates.map((a) => [a.tier, a]))

  return (
    <div>
      <p className="dash-sub mt8" style={{ maxWidth: 760 }}>
        {allSources.length} bronnen actief, verdeeld over drie tiers naar bewijskracht. {producing.length} daarvan hebben
        minstens één signaal opgeleverd.
      </p>

      {[1, 2, 3].map((tier) => {
        const sources = producing
          .filter((s) => s.tier === tier)
          .sort((a, b) => b.signalCount - a.signalCount || a.name.localeCompare(b.name))
        const aggregate = aggByTier.get(tier) ?? { sourceCount: 0, items: 0, signals: 0, published: 0 }
        return <TierSection key={tier} tier={tier} aggregate={aggregate} sources={sources} />
      })}

      <details className="mt24">
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 500, color: 'var(--t2)', padding: '8px 0' }}>
          {noYield.length} bronnen leverden nog geen signaal op
        </summary>
        <div className="dash-table-wrap mt16">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Bron</th>
                <th>Tier</th>
                <th>Type</th>
                <th>Items totaal</th>
                <th>Gezondheid</th>
                <th>Laatste run</th>
              </tr>
            </thead>
            <tbody>
              {noYield.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.name}</div>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                      {s.url.length > 50 ? s.url.slice(0, 50) + '…' : s.url}
                    </a>
                  </td>
                  <td>{s.tier ? `T${s.tier}` : '—'}</td>
                  <td>{s.sourceType || '—'}</td>
                  <td>{s.itemsTotal}</td>
                  <td><HealthBadge source={s} /></td>
                  <td style={{ maxWidth: 220 }}><LastRunCell source={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
