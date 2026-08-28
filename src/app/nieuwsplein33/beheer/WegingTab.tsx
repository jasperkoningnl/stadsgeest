'use client'

import type {
  TipOverzicht, AfgewezenSignaal, WegingSamenvatting,
} from '@/lib/dashboard/beheerQueries'
import { formatDateTime, formatRelative } from '@/lib/dashboard/format'

const SOORT_KLEUR: Record<string, string> = {
  nieuwsfeit: 'np-soort-nieuwsfeit',
  patroon: 'np-soort-patroon',
  verdieping: 'np-soort-verdieping',
  dossiersignaal: 'np-soort-dossiersignaal',
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
}

export default function WegingTab({
  samenvatting,
  tips,
  afgewezen,
}: WegingTabProps) {
  return (
    <div>
      {/* Samenvatting */}
      <div className="np-beheer-kaart">
        <div className="np-weging-stats">
          <div className="np-weging-stat">
            <span className="np-weging-stat-getal">{samenvatting.signalenBeoordeeld}</span>
            <span className="np-weging-stat-label">Signalen beoordeeld</span>
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
        Tips (afgelopen 7 dagen): {tips.length}
      </p>
      <div className="np-weging-tiplijst">
        {tips.map((tip) => (
          <div key={tip.id} className="np-weging-tipkaart">
            <div className="np-weging-tipkaart-kop">
              <div>
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

            {/* Gekoppelde signalen */}
            {tip.signalen.length > 0 && (
              <div className="np-weging-signalen">
                {tip.signalen.map((s) => (
                  <span
                    key={s.signalId}
                    className={`np-weging-signaal-pil${s.rol === 'dragend' ? ' np-weging-signaal-dragend' : ''}`}
                  >
                    {s.rol === 'dragend' ? '▸' : '◦'} #{s.signalId} {s.signalTitle} ({s.rol})
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
          <p className="np-leeg">Geen tips in de afgelopen 7 dagen.</p>
        )}
      </div>

      {/* Afgewezen signalen */}
      <p className="np-telling" style={{ marginTop: 24 }}>
        Afgewezen signalen: {afgewezen.length}
      </p>
      <div className="np-weging-afgewezen">
        {afgewezen.map((s) => (
          <div key={s.id} className="np-weging-afgewezen-item">
            <span className="np-weging-afgewezen-titel">#{s.id} {s.title}</span>
            <span className="np-weging-afgewezen-reden">{s.decisionReason ?? '—'}</span>
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
          </div>
        ))}
        {afgewezen.length === 0 && (
          <p className="np-leeg" style={{ marginTop: 12 }}>Geen afgewezen signalen deze week.</p>
        )}
      </div>
    </div>
  )
}
