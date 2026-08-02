import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { getPressRelease } from '@/lib/dashboard/queries'
import { formatDate, TIER_META } from '@/lib/dashboard/format'
import NoDatabase from '../../NoDatabase'
import PersberichtView from '@/components/dashboard/PersberichtView'

export const revalidate = 30

interface Props {
  params: Promise<{ id: string }>
}

export default async function PersberichtDetailPage({ params }: Props) {
  if (!hasTurso()) return <NoDatabase />

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) notFound()

  const pressRelease = await getPressRelease(id)
  if (!pressRelease) notFound()

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="crumb mt8">
        <Link href="/dashboard/persberichten" className="crumb-link">Persberichten</Link>
        <span>›</span>
        <span>#{pressRelease.id}</span>
      </div>

      <div className="dash-pr-card-meta mt16" style={{ marginBottom: 4 }}>
        <span>{formatDate(pressRelease.created_at)}</span>
        <span>·</span>
        {pressRelease.eff_tier ? (
          <span className="dash-tier-pill" title={TIER_META[pressRelease.eff_tier]?.desc}>T{pressRelease.eff_tier}</span>
        ) : (
          <span>Tier onbekend</span>
        )}
        <span>·</span>
        <span>{pressRelease.signal_category || 'Geen categorie'}</span>
      </div>

      <div className="dash-card mt16">
        <PersberichtView
          pressRelease={{
            id: pressRelease.id,
            signal_id: pressRelease.signal_id,
            job_id: pressRelease.job_id,
            headline: pressRelease.headline,
            lead: pressRelease.lead,
            body: pressRelease.body,
            facts: pressRelease.facts,
            open_questions: pressRelease.open_questions,
            sources: pressRelease.sources,
            status: pressRelease.status,
            created_at: pressRelease.created_at,
            type: pressRelease.type,
            betrouwbaarheid: pressRelease.betrouwbaarheid,
          }}
        />
      </div>

      <p className="mt16" style={{ fontSize: 13.5, color: 'var(--t3)' }}>
        <Link href={`/dashboard/signaal/${pressRelease.signal_id}`} style={{ color: 'var(--accent)' }}>
          → Naar het signaaldossier
        </Link>
        {' '}— zie waar dit persbericht vandaan komt: bronitems, entiteiten en de volledige tijdlijn.
      </p>
    </div>
  )
}
