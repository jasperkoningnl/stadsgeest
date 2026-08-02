/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { client } from '@/lib/sanity'
import { getSignalDossier } from '@/lib/dashboard/queries'
import {
  formatDate,
  formatDateTime,
  parseBriefing,
  parseSpeurderNote,
  NO_HISTORY_MESSAGE,
  SIGNAL_STATUS_META,
  TIER_META,
} from '@/lib/dashboard/format'
import NoDatabase from '../../NoDatabase'

export const revalidate = 30

interface Props {
  params: Promise<{ id: string }>
}

const SECTION_HEADING_CLASS: Record<string, string> = {
  main: 'dash-briefing-heading-main',
  onderzoeksopdracht: 'dash-briefing-heading-onderzoek',
  'research-aanvulling': 'dash-briefing-heading-research',
}

export default async function SignaalDossierPage({ params }: Props) {
  if (!hasTurso()) return <NoDatabase />

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) notFound()

  const dossier = await getSignalDossier(id)
  if (!dossier) notFound()

  const { signal, effectiveTier, effectiveSource, rawItems, entitiesByType, events, article } = dossier
  const briefing = parseBriefing(signal.summary)

  let articleSlug: string | null = null
  if (article) {
    const doc = await client
      .fetch<{ slug?: { current: string } } | null>(`*[_id == $id][0]{ slug }`, { id: article.sanity_document_id })
      .catch(() => null)
    articleSlug = doc?.slug?.current ?? null
  }

  const statusMeta = SIGNAL_STATUS_META[signal.status]

  const distinctSourceCount = new Set(rawItems.map((it: any) => it.source_name)).size
  const speurderNote = parseSpeurderNote(signal.summary)
  const statusJustifications: string[] = []
  if (signal.threshold != null && signal.confirmations != null) {
    const reached = signal.confirmations >= signal.threshold
    statusJustifications.push(
      `${signal.confirmations} bevestiging${signal.confirmations === 1 ? '' : 'en'} uit ${distinctSourceCount} bron${distinctSourceCount === 1 ? '' : 'nen'}, drempel van ${signal.threshold} ${reached ? 'bereikt' : 'nog niet bereikt'}`
    )
  }
  if (speurderNote) statusJustifications.push(speurderNote)
  if (events.length > 0) {
    const lastEvent = events[events.length - 1]
    statusJustifications.push(
      `Laatste wijziging: ${lastEvent.reason || `${lastEvent.status_from ?? '?'} → ${lastEvent.status_to ?? '?'}`} (${formatDate(lastEvent.created_at)})`
    )
  }

  return (
    <div>
      <div className="crumb mt8">
        <Link href="/dashboard/signalen" className="crumb-link">Signalen</Link>
        <span>›</span>
        <span>#{signal.id}</span>
      </div>

      <div className="dash-grid mt16">
          <div>
            <h1 style={{ fontFamily: 'var(--f-d)', fontWeight: 800, fontSize: 'clamp(22px,3vw,30px)', letterSpacing: '-0.02em', marginBottom: 16, lineHeight: 1.25 }}>
              {signal.title}
            </h1>

            {briefing.tags.length > 0 && (
              <div className="dash-briefing-tags">
                {briefing.tags.map((t) => (
                  <span key={t.key} className={`dash-briefing-tag${t.emphasis ? ' dash-briefing-tag-emph' : ''}`}>{t.label}</span>
                ))}
              </div>
            )}

            <div className="dash-card">
              <div className="dash-card-title">Briefing</div>
              {briefing.sections.length === 0 ? (
                <p style={{ color: 'var(--t2)', fontFamily: 'var(--f-b)' }}>Geen briefingtekst beschikbaar.</p>
              ) : (
                briefing.sections.map((s, i) => (
                  <div
                    key={i}
                    className={`dash-briefing-section${s.kind !== 'main' ? ' dash-briefing-box' : ''}${s.kind === 'onderzoeksopdracht' ? ' dash-briefing-box-onderzoek' : ''}${s.kind === 'research-aanvulling' ? ' dash-briefing-box-research' : ''}`}
                  >
                    <div className={`dash-briefing-heading ${SECTION_HEADING_CLASS[s.kind]}`}>{s.heading}</div>
                    {s.paragraphs.map((p, j) => (
                      <p key={j} className="dash-briefing-body" style={{ marginBottom: j < s.paragraphs.length - 1 ? 16 : 0 }}>{p}</p>
                    ))}
                  </div>
                ))
              )}

              {signal.crossref_briefing && (
                <div className="dash-briefing-section dash-briefing-box" style={{ borderLeftColor: 'var(--t2)', marginTop: 20 }}>
                  <div className="dash-briefing-heading" style={{ color: 'var(--t2)' }}>Crossref-briefing</div>
                  <p className="dash-briefing-body">{signal.crossref_briefing}</p>
                </div>
              )}
            </div>

            <div className="dash-card mt24">
              <div className="dash-card-title">Bronitems ({rawItems.length})</div>
              {rawItems.length === 0 ? (
                <p style={{ color: 'var(--t3)', fontSize: 14 }}>Geen gekoppelde bronitems.</p>
              ) : (
                rawItems.map((it: any) => (
                  <div key={it.id} className="source-row">
                    <a href={it.external_url} target="_blank" rel="noopener noreferrer" className="source-link">
                      {it.title || '(geen titel)'}
                    </a>
                    <span className="source-pub">{it.source_name} {it.tier ? `· T${it.tier}` : ''} · {formatDate(it.scraped_at)}</span>
                  </div>
                ))
              )}
            </div>

            {entitiesByType.length > 0 && (
              <div className="dash-card mt24">
                <div className="dash-card-title">Entiteiten</div>
                {entitiesByType.map((group) => (
                  <div key={group.type} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 6, textTransform: 'capitalize' }}>{group.type}</div>
                    <div className="ents-list">
                      {group.entities.map((e) => (
                        <span key={e.id} className="ent-chip" style={{ cursor: 'default' }}>{e.name}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="dash-card mt24">
              <div className="dash-card-title">Tijdlijn</div>
              {events.length === 0 ? (
                <p style={{ color: 'var(--t2)', fontSize: 14, fontStyle: 'italic' }}>{NO_HISTORY_MESSAGE}</p>
              ) : (
                events.map((ev: any) => (
                  <div key={ev.id} className="dash-timeline-item">
                    <span className="dash-timeline-dot" />
                    <div className="dash-timeline-body">
                      <div style={{ fontSize: 14 }}>
                        <strong>{ev.actor}</strong> — {ev.event_type}
                        {ev.status_from || ev.status_to ? ` (${ev.status_from ?? '?'} → ${ev.status_to ?? '?'})` : ''}
                      </div>
                      {ev.reason && <div style={{ fontSize: 13, color: 'var(--t2)', marginTop: 2 }}>{ev.reason}</div>}
                      <div className="dash-timeline-meta">{formatDateTime(ev.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="sidebar-box">
              <div className="sidebar-title">Status</div>
              <span className="dash-pill" style={{ background: `${statusMeta?.color || 'var(--t3)'}22`, color: statusMeta?.color || 'var(--t3)' }}>
                {statusMeta?.label || signal.status}
              </span>
              {statusJustifications.length > 0 ? (
                <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {statusJustifications.map((j, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: 'var(--t2)' }}>{j}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6, fontStyle: 'italic' }}>{NO_HISTORY_MESSAGE}</p>
              )}
            </div>

            <div className="sidebar-box">
              <div className="sidebar-title">Kenmerken</div>
              <div style={{ fontSize: 13.5, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>Tier: {effectiveTier ? <span className="dash-tier-pill" title={TIER_META[effectiveTier]?.desc}>T{effectiveTier}</span> : '—'}</div>
                <div>Bron: {effectiveSource || '—'}</div>
                <div>Bevestigingen: {signal.confirmations}</div>
                <div>Eerst gezien: {formatDate(signal.first_seen_at)}</div>
                <div>Laatst gezien: {formatDate(signal.last_seen_at)}</div>
              </div>
            </div>

            {article && (
              <div className="sidebar-box">
                <div className="sidebar-title">Artikel</div>
                {articleSlug ? (
                  <Link href={`/artikel/${articleSlug}`} target="_blank" style={{ color: 'var(--accent)', fontSize: 14 }}>
                    {article.title} →
                  </Link>
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--t2)' }}>{article.title}</span>
                )}
              </div>
            )}
          </div>
      </div>
    </div>
  )
}
