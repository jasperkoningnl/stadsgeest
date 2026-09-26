import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hasTurso } from '@/lib/turso'
import { AUTH_COOKIE, sessieGebruiker } from '@/lib/dashboardAuth'
import {
  getIntakeRuns, getTierAggregates, getSourcesOverview,
  getIntakeFunnel, getIntakeDecisions, getTopFilterReasons, getTopEntities,
  getRecentTips, getAfgewezenSignalen, getWegingSamenvatting,
  getLeerDashboard,
} from '@/lib/dashboard/beheerQueries'
import type { TierAggregate, SourcesOverview } from '@/lib/dashboard/beheerQueries'
import { getVerbruikDetail, getVerbruikSamenvatting, isQuotumBlokkade } from '@/lib/dashboard/tursoVerbruik'
import GeenDatabase from '../GeenDatabase'
import BronnenTabel from './BronnenTabel'
import BeheerWerkbalk, { BEHEER_TABS, type BeheerTab } from './BeheerWerkbalk'
import IntakeTab from './IntakeTab'
import WegingTab from './WegingTab'
import LerenTab from './LerenTab'
import ControlerenTab from './ControlerenTab'
import VerbruikTab from './VerbruikTab'

export const metadata: Metadata = {
  title: 'Beheer · Nieuwsplein33',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

interface BeheerPaginaProps {
  searchParams: Promise<{ periode?: string; tab?: string }>
}

// Elk tabblad haalt alleen zijn eigen data op. Voorheen liepen bij elke
// weergave van Beheer elf queries voor alle tabs tegelijk, ook voor tabs die je
// niet opende — en elke rij die Turso daarvoor bekijkt telt mee in het
// leesquotum. Verbruik is de standaard: die kost geen enkele databaseread.
export default async function BeheerPagina({ searchParams }: BeheerPaginaProps) {
  const cookieStore = await cookies()
  const gebruiker = await sessieGebruiker(cookieStore.get(AUTH_COOKIE)?.value)
  if (gebruiker !== 'jasper') redirect('/nieuwsplein33')

  const params = await searchParams
  const tab: BeheerTab = (BEHEER_TABS.map(t => t.id) as string[]).includes(params.tab ?? '')
    ? (params.tab as BeheerTab)
    : 'verbruik'
  const dagen = [7, 14, 30].includes(Number(params.periode)) ? Number(params.periode) : 7
  const periodeLabel = `afgelopen ${dagen} dagen`

  const samenvatting = await getVerbruikSamenvatting()

  let inhoud: React.ReactNode
  if (tab === 'verbruik') {
    inhoud = <VerbruikTab verbruik={await getVerbruikDetail()} />
  } else if (!hasTurso()) {
    inhoud = <GeenDatabase />
  } else {
    try {
      inhoud = await tabInhoud(tab, dagen, periodeLabel)
    } catch (e) {
      inhoud = <DatabaseFout geblokkeerd={isQuotumBlokkade(e)} />
    }
  }

  return (
    <div>
      <BeheerWerkbalk tab={tab} periode={dagen} verbruik={samenvatting} />
      {inhoud}
    </div>
  )
}

async function tabInhoud(tab: Exclude<BeheerTab, 'verbruik'>, dagen: number, periodeLabel: string) {
  switch (tab) {
    case 'bronnen': {
      const [tiers, bronnen] = await Promise.all([getTierAggregates(), getSourcesOverview()])
      return <BronnenContent tiers={tiers} bronnen={bronnen} />
    }
    case 'intake': {
      const [runs, funnel, decisions, filterReasons, topEntities] = await Promise.all([
        getIntakeRuns(1), getIntakeFunnel(dagen), getIntakeDecisions(50),
        getTopFilterReasons(dagen, 10), getTopEntities(dagen, 10),
      ])
      return (
        <IntakeTab
          funnel={funnel}
          decisions={decisions}
          filterReasons={filterReasons}
          topEntities={topEntities}
          laatsteRun={runs[0] ?? null}
          periodeLabel={periodeLabel}
        />
      )
    }
    case 'weging': {
      const [samenvatting, tips, afgewezen] = await Promise.all([
        getWegingSamenvatting(dagen), getRecentTips(dagen, 20), getAfgewezenSignalen(dagen, 20),
      ])
      return <WegingTab samenvatting={samenvatting} tips={tips} afgewezen={afgewezen} periodeLabel={periodeLabel} />
    }
    case 'leren':
      return <LerenTab data={await getLeerDashboard(dagen)} periodeLabel={periodeLabel} />
    case 'controleren':
      return <ControlerenTab />
  }
}

function DatabaseFout({ geblokkeerd }: { geblokkeerd: boolean }) {
  return (
    <div className="np-leeg">
      <p className="np-leeg-kop">{geblokkeerd ? 'Turso blokkeert leesopdrachten' : 'De database gaf een fout'}</p>
      <p>
        {geblokkeerd
          ? 'Het leesquotum van het account is op. Onder Verbruik staat hoeveel er is gelezen en wanneer de teller weer op nul gaat.'
          : 'Deze gegevens konden niet worden geladen. De foutmelding staat in de Vercel-logs.'}
      </p>
    </div>
  )
}

// ── Bronnen-tab: tier-overzicht + BronnenTabel ──────────────────────────

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

function BronnenContent({ tiers, bronnen }: { tiers: TierAggregate[]; bronnen: SourcesOverview }) {
  return (
    <div>
      <section className="np-blok np-blok-wie">
        <h2 className="np-blok-kop">Bronnen per tier</h2>
        <TierTabel tiers={tiers} />
      </section>
      <section className="np-blok np-blok-wie">
        <h2 className="np-blok-kop">Alle bronnen ({bronnen.rows.length})</h2>
        <BronnenTabel overzicht={bronnen} />
      </section>
    </div>
  )
}
