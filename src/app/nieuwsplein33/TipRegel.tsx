import Link from 'next/link'
import type { TipRij } from '@/lib/dashboard/tipQueries'
import { formatDate } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'

export const SOORT_LABEL: Record<string, string> = {
  nieuwsfeit: 'Nieuwsfeit',
  patroon: 'Patroon',
  verdieping: 'Verdieping',
  dossiersignaal: 'Dossier',
}

// Een supertip is (nog) geen apart veld: de weger of Jasper zet "Supertip:"
// voor de titel. Het dashboard haalt dat voorvoegsel weg en toont de tip
// opvallender.
const SUPERTIP = /^\s*supertip\s*[:\-–—]\s*/i
export function isSupertip(titel: string | null | undefined): boolean {
  return Boolean(titel && SUPERTIP.test(titel))
}
export function zonderSupertip(titel: string): string {
  return titel.replace(SUPERTIP, '')
}

/**
 * Eén kaart in de lijst, in dezelfde vormtaal als de blokken op de tippagina:
 * een gekleurde lijn links in de kleur van de soort, bronnen als chips.
 */
export default function TipRegel({ tip }: { tip: TipRij }) {
  const dragend = tip.bronnen.filter((b) => !b.spiegel)
  const spiegels = tip.bronnen.filter((b) => b.spiegel)
  const superTip = isSupertip(tip.titel)
  const titel = ontstreep(superTip ? zonderSupertip(tip.titel) : tip.titel)

  // Hoogste tier van de dragende bronnen (lager = belangrijker)
  const tier = dragend.reduce<number | null>(
    (min, b) => b.tier !== null ? (min === null ? b.tier : Math.min(min, b.tier)) : min,
    null,
  )

  return (
    <div className="np-lijst-item">
      <Link
        href={`/nieuwsplein33/tip/${tip.id}`}
        className={`np-regel np-regel-${tip.soort}${superTip ? ' np-regel-super' : ''}`}
      >
        {superTip && (
          <div className="np-super-band"><span aria-hidden>★</span> Supertip</div>
        )}
        <div className="np-regel-inhoud">
          <div className="np-regel-labels">
            <span className={`np-soort np-soort-${tip.soort}`}>{SOORT_LABEL[tip.soort] ?? tip.soort}</span>
            {tip.gemeente !== 'Amersfoort' && <span className="np-gemeente">{tip.gemeente}</span>}
            {tier !== null && (
              <span className={`np-tier np-tier-${tier}`} title={`Hoogste bron: tier ${tier}`}>tier {tier}</span>
            )}
            <span className="np-regel-datum">{formatDate(tip.created_at)}</span>
          </div>

          <span className="np-regel-titel">{titel}</span>
          {tip.kern && <p className="np-regel-kern">{ontstreep(tip.kern)}</p>}

          {tip.score_motivatie && (
            <div className="np-regel-waarom">
              <span className="np-regel-waarom-kop">Waarom</span>
              <p>{ontstreep(tip.score_motivatie)}</p>
            </div>
          )}

          <div className="np-regel-meta np-regel-bronnen">
            {dragend.slice(0, 3).map((b) => (
              <span key={b.naam} className="np-bron">{ontstreep(b.naam, ' · ')}</span>
            ))}
            {dragend.length > 3 && <span className="np-bron np-bron-rest">+{dragend.length - 3}</span>}
            {spiegels.length > 0 && (
              <span className="np-bron np-bron-spiegel" title="Media waarmee Nieuwsplein33 samenwerkt, hier al gepubliceerd">
                ook bij {spiegels.map((s) => ontstreep(s.naam, ' · ')).join(', ')}
              </span>
            )}
          </div>
          <div className="np-regel-meta">
            <span>{tip.aantal_documenten} {tip.aantal_documenten === 1 ? 'document' : 'documenten'}</span>
            {tip.dossier_naam && (
              <>
                <span className="np-regel-scheiding">·</span>
                <span className="np-dossier">dossier {ontstreep(tip.dossier_naam, ' · ')}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}
