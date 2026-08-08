import Link from 'next/link'
import type { TipRij } from '@/lib/dashboard/tipQueries'
import { formatRelative } from '@/lib/dashboard/format'

export const SOORT_LABEL: Record<string, string> = {
  nieuwsfeit: 'Nieuwsfeit',
  patroon: 'Patroon',
  verdieping: 'Verdieping',
  dossiersignaal: 'Dossier',
}

/**
 * Eén regel in de wachtrij: de kop, waar hij vandaan komt, en hoe lang hij er
 * al ligt. Bewust één regel tekst — de redacteur beslist hier of hij verder
 * kijkt, niet of hij het verhaal maakt.
 */
export default function TipRegel({ tip }: { tip: TipRij }) {
  const dragend = tip.bronnen.filter((b) => !b.spiegel)
  const spiegels = tip.bronnen.filter((b) => b.spiegel)

  return (
    <Link href={`/nieuwsplein33/tip/${tip.id}`} className="np-regel">
      <div className="np-regel-hoofd">
        <span className={`np-soort np-soort-${tip.soort}`}>{SOORT_LABEL[tip.soort] ?? tip.soort}</span>
        <span className="np-regel-titel">{tip.titel}</span>
      </div>

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
        {tip.gemeente !== 'Amersfoort' && (
          <>
            <span className="np-regel-scheiding">·</span>
            <span className="np-gemeente">{tip.gemeente}</span>
          </>
        )}
        {tip.dossier_naam && (
          <>
            <span className="np-regel-scheiding">·</span>
            <span className="np-dossier">dossier {tip.dossier_naam}</span>
          </>
        )}
        <span className="np-regel-scheiding">·</span>
        <span>{formatRelative(tip.created_at)}</span>
      </div>
    </Link>
  )
}
