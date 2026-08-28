'use client'

import { useState } from 'react'
import type {
  TipOverzicht, AfgewezenSignaal, WegingSamenvatting,
} from '@/lib/dashboard/beheerQueries'
import { formatRelative } from '@/lib/dashboard/format'

const SOORT_KLEUR: Record<string, string> = {
  nieuwsfeit: 'np-soort-nieuwsfeit',
  patroon: 'np-soort-patroon',
  verdieping: 'np-soort-verdieping',
  dossiersignaal: 'np-soort-dossiersignaal',
}

const ROL_LABEL: Record<string, string> = {
  dragend: 'dragend',
  bevestigend: 'bevestigend',
  context: 'context',
}

function scoreKleur(score: number | null): string {
  if (score === null) return ''
  if (score >= 7) return 'np-weging-score-hoog'
  if (score >= 5) return 'np-weging-score-midden'
  return 'np-weging-score-laag'
}

function scoreBalkBreedte(score: number | null): string {
  if (score === null) return '0%'
  return `${Math.min(Math.round(score * 10), 100)}%`
}

interface WegingTabProps {
  samenvatting: WegingSamenvatting
  tips: TipOverzicht[]
  afgewezen: AfgewezenSignaal[]
  periodeLabel: string
}

export default function WegingTab({
  samenvatting,
  tips,
  afgewezen,
  periodeLabel,
}: WegingTabProps) {
  return (
    <div>
      {/* Samenvatting */}
      <div className="np-beheer-kaart">
        <div className="np-weging-stats">
          <div className="np-weging-stat">
            <span className="np-weging-stat-getal">{samenvatting.signalenBeoordeeld}</span>
            <span className="np-weging-stat-label">Beoordeeld</span>
          </div>
          <div className="np-weging-stat">
            <span className="np-weging-stat-getal np-weging-stat-groen">{samenvatting.tipsMade}</span>
            <span className="np-weging-stat-label">Tips gemaakt</span>
          </div>
          <div className="np-weging-stat">
            <span className="np-weging-stat-getal np-weging-stat-rood">{samenvatting.afgewezen}</span>
            <span className="np-weging-stat-label">Afgewezen</span>
          </div>
          <div className="np-weging-stat">
            <span className="np-weging-stat-getal np-weging-stat-amber">{samenvatting.watching}</span>
            <span className="np-weging-stat-label">Watching</span>
          </div>
        </div>
      </div>

      {/* Tips */}
      <p className="np-telling" style={{ marginTop: 24 }}>
        Tips ({periodeLabel}): {tips.length}
      </p>
      <div className="np-weging-tiplijst">
        {tips.map((tip) => (
          <div key={tip.id} className="np-weging-tipkaart">
            <div className="np-weging-tipkaart-kop">
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="np-weging-tiptitel">{tip.titel}</span>
                <div className="np-weging-tipmeta">
                  {tip.soort && (
                    <span className={`np-soort ${SOORT_KLEUR[tip.soort] ?? ''}`}>
                      {tip.soort}
                    </span>
                  )}
                  <span>{tip.signalen.length} signaal{tip.signalen.length !== 1 ? 'en' : ''}</span>
                  <span className="np-regel-scheiding">·</span>
                  <span>{formatRelative(tip.createdAt)}</span>
                </div>
              </div>
              {tip.score !== null && (
                <span className={`np-weging-score ${scoreKleur(tip.score)}`}>
                  {tip.score.toFixed(1)}
                </span>
              )}
            </div>

            {/* Gekoppelde signalen met roluitleg */}
            {tip.signalen.length > 0 && (
              <div className="np-weging-signalen">
                {tip.signalen.map((s) => (
                  <span
                    key={s.signalId}
                    className={`np-weging-signaal-pil np-weging-rol-${s.rol}`}
                    title={`Rol: ${ROL_LABEL[s.rol] ?? s.rol}`}
                  >
                    #{s.signalId} {s.signalTitle}
                    <span className="np-weging-rol-tag">{ROL_LABEL[s.rol] ?? s.rol}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Motivatie */}
            {tip.scoreMotivatie && (
              <div className="np-weging-motivatie">
                {tip.scoreMotivatie}
              </div>
            )}
          </div>
        ))}
        {tips.length === 0 && (
          <p className="np-leeg">Geen tips in deze periode.</p>
        )}
      </div>

      {/* Afgewezen signalen */}
      <p className="np-telling" style={{ marginTop: 24 }}>
        Afgewezen signalen: {afgewezen.length}
      </p>
      <div className="np-weging-afgewezen">
        {afgewezen.map((s) => (
          <AfgewezenKaart key={s.id} signaal={s} />
        ))}
        {afgewezen.length === 0 && (
          <p className="np-leeg" style={{ marginTop: 12 }}>Geen afgewezen signalen in deze periode.</p>
        )}
      </div>
    </div>
  )
}

/** Uitklapbare kaart voor een afgewezen signaal. */
function AfgewezenKaart({ signaal: s }: { signaal: AfgewezenSignaal }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="np-weging-afgewezen-kaart">
      <button
        type="button"
        className="np-weging-afgewezen-kop"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="np-weging-afgewezen-titel">#{s.id} {s.title}</span>
        <div className="np-weging-scorebalk-wrap">
          <div className="np-weging-scorebalk">
            <div
              className={`np-weging-scorebalk-vul ${scoreKleur(s.noveltyScore)}`}
              style={{ width: scoreBalkBreedte(s.noveltyScore) }}
            />
          </div>
          <span className={`np-weging-scorebalk-getal ${scoreKleur(s.noveltyScore)}`}>
            {s.noveltyScore?.toFixed(1) ?? '—'}
          </span>
        </div>
        <span className="np-weging-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="np-weging-afgewezen-detail">
          {s.summary && (
            <p className="np-weging-afgewezen-samenvatting">{s.summary}</p>
          )}
          <div className="np-weging-afgewezen-meta">
            <span><strong>Reden:</strong> {s.decisionReason ?? 'onbekend'}</span>
            <span><strong>Bevestigingen:</strong> {s.confirmations}</span>
            <span><strong>Laatst gezien:</strong> {formatRelative(s.lastSeenAt)}</span>
            {s.firstSeenAt && (
              <span><strong>Eerst gezien:</strong> {formatRelative(s.firstSeenAt)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
