import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hasTurso } from '@/lib/turso'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import {
  getIntakeRuns, getTierAggregates, getSourcesOverview, getSourceErrors,
  getIntakeFunnel, getIntakeDecisions, getTopFilterReasons, getTopEntities,
  getRecentTips, getAfgewezenSignalen, getWegingSamenvatting,
} from '@/lib/dashboard/beheerQueries'
import GeenDatabase from '../GeenDatabase'
import BronnenTabel from './BronnenTabel'
import BeheerTabs from './BeheerTabs'
import IntakeTab from './IntakeTab'
import WegingTab from './WegingTab'

export const metadata: Metadata = {
  title: 'Beheer — Nieuwsplein33',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function BeheerPagina() {
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)
  if (gebruiker !== 'jasper') redirect('/nieuwsplein33')

  if (!hasTurso()) return <GeenDatabase />

  // Alle data parallel ophalen — elke tab krijgt precies wat hij nodig heeft.
  const [
    runs, tiers, bronnen, bronFouten,
    funnel, decisions, filterReasons, topEntities,
    tips, afgewezen, wegingSamenvatting,
  ] = await Promise.all([
    getIntakeRuns(10),
    getTierAggregates(),
    getSourcesOverview(),
    getSourceErrors(),
    getIntakeFunnel(7),
    getIntakeDecisions(50),
    getTopFilterReasons(7, 10),
    getTopEntities(7, 10),
    getRecentTips(7, 20),
    getAfgewezenSignalen(7, 20),
    getWegingSamenvatting(7),
  ])

  const laatsteRun = runs[0] ?? null

  return (
    <BeheerTabs
      bronnenCount={bronnen.rows.length}
      bronnenContent={
        <BronnenContent tiers={tiers} bronnen={bronnen} />
      }
      intakeContent={
        <IntakeTab
          funnel={funnel}
          decisions={decisions}
          filterReasons={filterReasons}
          topEntities={topEntities}
          laatsteRun={laatsteRun}
        />
      }
      wegingContent={
        <WegingTab
          samenvatting={wegingSamenvatting}
          tips={tips}
          afgewezen={afgewezen}
        />
      }
    />
  )
}

// ── Bronnen-tab: tier-overzicht + BronnenTabel ──────────────────────────

import type { TierAggregate, SourcesOverview } from '@/lib/dashboard/beheerQueries'

function TierTabel({ tiers }: { tiers: TierAggregate[] }) {
  return (
    <div className="np-beheer-tabel-wrap">
      <table className="np-tabel">
        <thead>
          <tr><th>Tier</th><th>Bronnen</th><th>Items totaal</th></tr>
        </thead>
        <tbody>
          {tiers.map((t) => (
            <tr key={t.tier}>
              <td><span className="np-tier">tier {t.tier}</span></td>
              <td>{t.sourceCount}</td>
              <td>{t.items}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BronnenContent({
  tiers,
  bronnen,
}: {
  tiers: TierAggregate[]
  bronnen: SourcesOverview
}) {
  return (
    <div>
      <p className="np-telling">Bronnen per tier</p>
      <TierTabel tiers={tiers} />
      <p className="np-telling" style={{ marginTop: 32 }}>
        Alle bronnen ({bronnen.rows.length})
      </p>
      <BronnenTabel overzicht={bronnen} />
    </div>
  )
}
