import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getPressReleasesOverview, type PressReleaseListRow } from '@/lib/dashboard/queries'
import { formatDate, safeParseJsonArray, TIER_META, BETROUWBAARHEID_META, type PressReleaseFact, type PressReleaseSource } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

function PersberichtCard({ r, tip }: { r: PressReleaseListRow; tip?: boolean }) {
  const factCount = safeParseJsonArray<PressReleaseFact>(r.facts)?.length ?? 0
  const sourceCount = safeParseJsonArray<PressReleaseSource>(r.sources)?.length ?? 0
  const openQuestionCount = safeParseJsonArray<string>(r.open_questions)?.length ?? 0
  const betrouwbaarheid = r.betrouwbaarheid ? BETROUWBAARHEID_META[r.betrouwbaarheid] : null

  return (
    <Link href={`/dashboard/persbericht/${r.id}`} className={`dash-pr-card${tip ? ' dash-pr-card-tip' : ''}`}>
      <div className="dash-pr-card-headline">{r.headline || r.signal_title}</div>
      <div className="dash-pr-card-meta">
        <span>{formatDate(r.created_at)}</span>
        <span>·</span>
        <span>{sourceCount} bron{sourceCount === 1 ? '' : 'nen'}</span>
        <span>·</span>
        <span>{openQuestionCount} open vra{openQuestionCount === 1 ? 'ag' : 'gen'}</span>
        {factCount > 0 && (
          <>
            <span>·</span>
            <span>{factCount} feit{factCount === 1 ? '' : 'en'}</span>
          </>
        )}
      </div>
      <div className="dash-pr-card-tags">
        {r.eff_tier ? (
          <span className="dash-tier-pill" title={TIER_META[r.eff_tier]?.desc}>T{r.eff_tier}</span>
        ) : (
          <span className="dash-tier-pill" style={{ opacity: 0.5 }}>Tier onbekend</span>
        )}
        <span className="dash-pr-card-category">{r.signal_category || 'Geen categorie'}</span>
        {betrouwbaarheid && (
          <span className="dash-pill" style={{ background: `${betrouwbaarheid.color}22`, color: betrouwbaarheid.color }}>
            Betrouwbaarheid: {betrouwbaarheid.label}
          </span>
        )}
      </div>
    </Link>
  )
}

export default async function PersberichtenPage() {
  if (!hasTurso()) return <NoDatabase />

  const allReleases = await getPressReleasesOverview()
  const releases = allReleases.filter((r) => r.type !== 'tip')
  const tips = allReleases.filter((r) => r.type === 'tip')

  return (
    <div>
      <p className="dash-sub mt8" style={{ marginBottom: 24 }}>
        Elke dag om 13:00 werkt de redactieassistent maximaal drie signalen uit tot een persbureaubericht — kant-en-klaar om over te nemen.
      </p>

      {releases.length === 0 ? (
        <div className="empty-state">Nog geen persberichten. De redactieassistent draait dagelijks om 13:00.</div>
      ) : (
        <div className="dash-pr-list">
          {releases.map((r) => <PersberichtCard key={r.id} r={r} />)}
        </div>
      )}

      {tips.length > 0 && (
        <section className="mt24">
          <h2 className="dash-tip-section-title">Tips voor de redactie</h2>
          <p className="dash-sub" style={{ maxWidth: 760, marginBottom: 16 }}>
            Halfharde vondsten — dunne of nog niet hard onderbouwde signalen, vaak vanuit een dwarsverband. Geen conclusies over
            personen, wel de moeite van het checken waard. Beoordeel de betrouwbaarheid voordat je verder gaat.
          </p>
          <div className="dash-pr-list">
            {tips.map((r) => <PersberichtCard key={r.id} r={r} tip />)}
          </div>
        </section>
      )}
    </div>
  )
}
