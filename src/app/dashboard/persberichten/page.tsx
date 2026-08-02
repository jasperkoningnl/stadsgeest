import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getPressReleasesOverview } from '@/lib/dashboard/queries'
import { formatDate, safeParseJsonArray, TIER_META, type PressReleaseFact, type PressReleaseSource } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

export default async function PersberichtenPage() {
  if (!hasTurso()) return <NoDatabase />

  const releases = await getPressReleasesOverview()

  return (
    <div>
      <p className="dash-sub mt8" style={{ marginBottom: 24 }}>
        Elke dag om 13:00 werkt de redactieassistent maximaal drie signalen uit tot een persbureaubericht — kant-en-klaar om over te nemen.
      </p>

      {releases.length === 0 ? (
        <div className="empty-state">Nog geen persberichten. De redactieassistent draait dagelijks om 13:00.</div>
      ) : (
        <div className="dash-pr-list">
          {releases.map((r) => {
            const factCount = safeParseJsonArray<PressReleaseFact>(r.facts)?.length ?? 0
            const sourceCount = safeParseJsonArray<PressReleaseSource>(r.sources)?.length ?? 0
            const openQuestionCount = safeParseJsonArray<string>(r.open_questions)?.length ?? 0

            return (
              <Link key={r.id} href={`/dashboard/persbericht/${r.id}`} className="dash-pr-card">
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
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
