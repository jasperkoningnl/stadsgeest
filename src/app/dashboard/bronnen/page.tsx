import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getSourcesOverview, type SourceRow } from '@/lib/dashboard/queries'
import { formatDate, TIER_META } from '@/lib/dashboard/format'
import NoDatabase from '../NoDatabase'

export const revalidate = 30

type SortKey = 'status' | 'name' | 'tier' | 'type' | 'last_item' | 'items_7d' | 'items_30d' | 'signals'

interface Props {
  searchParams: Promise<{ sort?: string; dir?: string; filter?: string; health?: string }>
}

const HEALTH_RANK: Record<SourceRow['healthStatus'], number> = { red: 0, grey: 1, green: 2 }

function sortSources(rows: SourceRow[], sort: SortKey, dir: 'asc' | 'desc'): SourceRow[] {
  const factor = dir === 'asc' ? 1 : -1
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name) * factor
      case 'tier':
        return ((a.tier ?? 99) - (b.tier ?? 99)) * factor
      case 'type':
        return (a.sourceType || '').localeCompare(b.sourceType || '') * factor
      case 'last_item':
        return ((a.lastItemAt ? new Date(a.lastItemAt.replace(' ', 'T')).getTime() : 0) - (b.lastItemAt ? new Date(b.lastItemAt.replace(' ', 'T')).getTime() : 0)) * factor
      case 'items_7d':
        return (a.items7d - b.items7d) * factor
      case 'items_30d':
        return (a.items30d - b.items30d) * factor
      case 'signals':
        return (a.signalCount - b.signalCount) * factor
      case 'status':
      default:
        return (HEALTH_RANK[a.healthStatus] - HEALTH_RANK[b.healthStatus]) * factor
    }
  })
  return sorted
}

function SortHeader({ label, sortKey, currentSort, currentDir }: { label: string; sortKey: SortKey; currentSort: string; currentDir: string }) {
  const isActive = currentSort === sortKey
  const nextDir = isActive && currentDir === 'asc' ? 'desc' : 'asc'
  return (
    <th>
      <Link href={`?sort=${sortKey}&dir=${nextDir}`}>
        {label}{isActive ? (currentDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </Link>
    </th>
  )
}

export default async function BronnenPage({ searchParams }: Props) {
  if (!hasTurso()) return <NoDatabase />

  const params = await searchParams
  const sort = (params.sort as SortKey) || 'status'
  const effectiveDir: 'asc' | 'desc' = params.dir === 'desc' ? 'desc' : 'asc'
  const filterNever = params.filter === 'never'
  const filterHealth = params.health as SourceRow['healthStatus'] | undefined

  const allSources = await getSourcesOverview()
  const neverCount = allSources.filter((s) => s.itemsTotal === 0).length

  let visible = allSources
  if (filterNever) visible = visible.filter((s) => s.itemsTotal === 0)
  if (filterHealth) visible = visible.filter((s) => s.healthStatus === filterHealth)

  const sorted = sortSources(visible, sort, effectiveDir)

  return (
    <div>
      <p className="dash-sub mt8" style={{ maxWidth: 760 }}>
        {allSources.length} bronnen actief. {neverCount} hebben nog nooit een item opgeleverd — meestal omdat de bron
        JavaScript of authenticatie vereist, of omdat het endpoint is veranderd. De precieze oorzaak staat er alleen bij
        als die uit de scraperlogs blijkt.
      </p>

      <div className="dash-filters mt24">
        <Link href="/dashboard/bronnen" className={`dash-filter-chip${!filterNever && !filterHealth ? ' dash-filter-chip-active' : ''}`}>
          Alle ({allSources.length})
        </Link>
        <Link href="/dashboard/bronnen?filter=never" className={`dash-filter-chip${filterNever ? ' dash-filter-chip-active' : ''}`}>
          Levert niets op ({neverCount})
        </Link>
        <Link href="/dashboard/bronnen?health=red" className={`dash-filter-chip${filterHealth === 'red' ? ' dash-filter-chip-active' : ''}`}>
          Rood ({allSources.filter((s) => s.healthStatus === 'red').length})
        </Link>
        <Link href="/dashboard/bronnen?health=grey" className={`dash-filter-chip${filterHealth === 'grey' ? ' dash-filter-chip-active' : ''}`}>
          Stil ≥14 dagen ({allSources.filter((s) => s.healthStatus === 'grey').length})
        </Link>
      </div>

      <div className="dash-table-wrap mt16">
        <table className="dash-table">
          <thead>
            <tr>
              <SortHeader label="Status" sortKey="status" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Bron" sortKey="name" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Tier" sortKey="tier" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Type" sortKey="type" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Laatste item" sortKey="last_item" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Items 7d" sortKey="items_7d" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Items 30d" sortKey="items_30d" currentSort={sort} currentDir={effectiveDir} />
              <SortHeader label="Signalen" sortKey="signals" currentSort={sort} currentDir={effectiveDir} />
              <th>Laatste fout</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id}>
                <td><span className={`dash-health-dot dash-health-${s.healthStatus}`} title={s.healthStatus === 'red' ? 'rood' : s.healthStatus === 'grey' ? 'stil' : 'actief'} /></td>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                    {s.url.length > 50 ? s.url.slice(0, 50) + '…' : s.url}
                  </a>
                </td>
                <td>
                  <span className="dash-tier-pill" title={s.tier ? TIER_META[s.tier]?.desc : ''}>
                    {s.tier ? `T${s.tier}` : '—'}
                  </span>
                </td>
                <td>{s.sourceType || '—'}</td>
                <td>{s.lastItemAt ? formatDate(s.lastItemAt) : 'nooit'}</td>
                <td>{s.items7d}</td>
                <td>{s.items30d}</td>
                <td>{s.signalCount}</td>
                <td style={{ maxWidth: 260, fontSize: 12.5, color: 'var(--t2)' }}>{s.lastErrorMessage || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dash-legend mt24">
        <div className="dash-legend-item"><strong>Tier 1</strong> — publicatiebron: zelfstandig artikelkandidaat</div>
        <div className="dash-legend-item"><strong>Tier 2</strong> — corroboratiebron</div>
        <div className="dash-legend-item"><strong>Tier 3</strong> — detectiebron, alleen trigger</div>
        <div className="dash-legend-item" style={{ marginTop: 6 }}>
          <span className="dash-health-dot dash-health-green" style={{ display: 'inline-block', marginRight: 6 }} /> recent actief ·
          <span className="dash-health-dot dash-health-grey" style={{ display: 'inline-block', margin: '0 6px 0 10px' }} /> actief maar ≥14 dagen stil ·
          <span className="dash-health-dot dash-health-red" style={{ display: 'inline-block', margin: '0 6px 0 10px' }} /> nooit iets opgeleverd of laatste run gaf een fout
        </div>
      </div>
    </div>
  )
}
