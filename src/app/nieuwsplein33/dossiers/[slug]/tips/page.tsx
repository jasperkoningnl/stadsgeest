import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { getDossierBySlug, getDossierTips, OPEN_STATUSSEN } from '@/lib/dashboard/dossierQueries'
import { formatDate } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import { SOORT_LABEL } from '../../../TipRegel'
import GeenDatabase from '../../../GeenDatabase'
import DossierTabs from '../../DossierTabs'

export const dynamic = 'force-dynamic'

// Tab Tips van een dossier: alle tips die uit het dossier voortkwamen, open
// tips eerst. Tot 3 oktober 2026 stond dit als blok boven de feiten; nu een
// eigen tab, zodat de feiten direct in beeld zijn. Puur lezend.

interface Props { params: Promise<{ slug: string }> }

const STATUS_LABEL: Record<string, string> = {
  wachtrij: 'in de wachtrij',
  goedgekeurd: 'goedgekeurd',
  in_behandeling: 'in behandeling',
  gepubliceerd: 'gepubliceerd',
  niet_gebruikt: 'niets mee gedaan',
  geparkeerd: 'geparkeerd',
  afgekeurd: 'afgewezen',
}

export default async function DossierTipsPagina({ params }: Props) {
  if (!hasTurso()) return <GeenDatabase />
  const { slug } = await params
  const dossier = await getDossierBySlug(slug)
  if (!dossier) notFound()

  const tips = await getDossierTips(dossier.id)
  const open = tips.filter((t) => OPEN_STATUSSEN.includes(t.status))
  const afgehandeld = tips.filter((t) => !OPEN_STATUSSEN.includes(t.status))

  const lijst = (rij: typeof tips) => (
    <ul className="np-dos-tiplijst">
      {rij.map((t) => (
        <li key={t.id}>
          <Link href={`/nieuwsplein33/tip/${t.id}`}>{ontstreep(t.titel)}</Link>
          <span className="np-dos-tip-meta">
            <span className={`np-soort np-soort-${t.soort}`}>{SOORT_LABEL[t.soort] ?? t.soort}</span>{' '}
            {formatDate(t.created_at)} · score {t.score} ·{' '}
            <span className={OPEN_STATUSSEN.includes(t.status) ? 'np-dos-open' : undefined}>
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <article className="np-dos">
      <Link href="/nieuwsplein33/dossiers" className="np-dos-terug">← Alle dossiers</Link>
      <header className="np-dos-kop">
        <h1>{ontstreep(dossier.naam, ' · ')}</h1>
        <div className="np-dos-regel-meta">
          <span>{tips.length} {tips.length === 1 ? 'tip' : 'tips'}</span>
          {open.length > 0 && <strong className="np-dos-open">{open.length} open</strong>}
        </div>
      </header>
      <DossierTabs slug={dossier.slug} actief="tips" tips={tips.length} />

      {tips.length === 0 && (
        <div className="np-leeg">
          <p className="np-leeg-kop">Nog geen tips uit dit dossier</p>
          <p>De weger legt hier wel feiten vast; een tip volgt zodra een feit of patroon nieuwswaarde heeft.</p>
        </div>
      )}

      {open.length > 0 && (
        <section className="np-dos-tips">
          <div className="np-dos-tips-kop">Nog bij de redactie ({open.length})</div>
          {lijst(open)}
        </section>
      )}
      {afgehandeld.length > 0 && (
        <section className="np-dos-tips">
          <div className="np-dos-tips-kop">Afgehandeld ({afgehandeld.length})</div>
          {lijst(afgehandeld)}
        </section>
      )}
    </article>
  )
}
