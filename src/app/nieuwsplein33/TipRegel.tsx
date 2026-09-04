import Link from 'next/link'
import type { TipRij } from '@/lib/dashboard/tipQueries'
import { formatDate } from '@/lib/dashboard/format'
import InlineTriage from './InlineTriage'

export const SOORT_LABEL: Record<string, string> = {
  nieuwsfeit: 'Nieuwsfeit',
  patroon: 'Patroon',
  verdieping: 'Verdieping',
  dossiersignaal: 'Dossier',
}

/**
 * Eén kaart in de lijst: etiketten, de kop, de kern in één of twee regels,
 * bronnen, tier-badge en inline triage-knoppen. De redacteur kan nu direct
 * vanuit de lijst beslissen of doorlezen.
 */
export default function TipRegel({ tip, toonTriage = true }: { tip: TipRij; toonTriage?: boolean }) {
  const dragend = tip.bronnen.filter((b) => !b.spiegel)
  const spiegels = tip.bronnen.filter((b) => b.spiegel)

  // Hoogste tier van de dragende bronnen (lager = belangrijker)
  const tier = dragend.reduce<number | null>(
    (min, b) => b.tier !== null ? (min === null ? b.tier : Math.min(min, b.tier)) : min,
    null,
  )

  return (
    <div className="np-lijst-item">
      <Link href={`/nieuwsplein33/tip/${tip.id}`} className="np-regel">
        <div className="np-regel-labels">
          <span className={`np-soort np-soort-${tip.soort}`}>{SOORT_LABEL[tip.soort] ?? tip.soort}</span>
          {tier !== null && (
            <span className={`np-tier np-tier-${tier}`} title={`Hoogste bron: tier ${tier}`}>tier {tier}</span>
          )}
          {tip.gemeente !== 'Amersfoort' && <span className="np-gemeente">{tip.gemeente}</span>}
          <span className="np-regel-datum">{formatDate(tip.created_at)}</span>
        </div>

        <span className="np-regel-titel">{tip.titel}</span>
        {tip.kern && <p className="np-regel-kern">{tip.kern}</p>}

        {tip.score_motivatie && (
          <div className="np-regel-waarom">
            <strong>Waarom:</strong> {tip.score_motivatie}
          </div>
        )}

        <div className="np-regel-meta">
          {dragend.slice(0, 3).map((b) => (
            <span key={b.naam} className="np-bron">{b.naam}</span>
          ))}
          {dragend.length > 3 && <span className="np-bron np-bron-rest">+{dragend.length - 3}</span>}
          {spiegels.length > 0 && (
            <span className="np-bron np-bron-spiegel" title="Media waarmee Nieuwsplein33 samenwerkt — hier al gepubliceerd">
              ook bij {spiegels.map((s) => s.naam).join(', ')}
            </span>
          )}
          <span className="np-regel-scheiding">·</span>
          <span>{tip.aantal_documenten} {tip.aantal_documenten === 1 ? 'document' : 'documenten'}</span>
          {tip.dossier_naam && (
            <>
              <span className="np-regel-scheiding">·</span>
              <span className="np-dossier">dossier {tip.dossier_naam}</span>
            </>
          )}
        </div>
      </Link>

      {/* Inline triage: alleen in de wachtrij */}
      {toonTriage && tip.status === 'wachtrij' && (
        <InlineTriage tipId={tip.id} />
      )}
    </div>
  )
}
