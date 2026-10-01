import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import {
  getDossierBySlug, getDossierFeiten, getDossierTips, getTipsPerSignaal,
  OPEN_STATUSSEN, type DossierFeitVolledig, type DossierTip,
} from '@/lib/dashboard/dossierQueries'
import { formatDate, kalenderdagenGeleden, safeParseJsonArray } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import GeenDatabase from '../../GeenDatabase'
import { BronChip } from '../../tip/[id]/TipBlokken'
import Tijdas from '../Tijdas'

export const dynamic = 'force-dynamic'

// Eén dossier: afbakening en aandachtspunten van de weger, de tips die eruit
// voortkwamen, een tijdas en de volledige feitenlijst. Filters lopen via de
// URL, zodat een gefilterde weergave te delen is. Puur lezend.

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ soort?: string; zekerheid?: string; volgorde?: string }>
}

const STATUS_LABEL: Record<string, string> = {
  wachtrij: 'in de wachtrij',
  goedgekeurd: 'goedgekeurd',
  in_behandeling: 'in behandeling',
  gepubliceerd: 'gepubliceerd',
  niet_gebruikt: 'niets mee gedaan',
  geparkeerd: 'geparkeerd',
  afgekeurd: 'afgewezen',
}

const MAAND_LANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

function maandKop(datum: string | null): string {
  if (!datum) return 'Zonder datum'
  const m = Number(datum.slice(5, 7))
  return m >= 1 && m <= 12 ? `${MAAND_LANG[m - 1]} ${datum.slice(0, 4)}` : datum.slice(0, 4)
}

function tekst(s: string | null | undefined): string {
  if (!s || s === 'null') return ''
  return ontstreep(s).trim()
}

function secundair(raw: string | null): string[] {
  return (safeParseJsonArray<unknown>(raw) ?? []).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
}

const ZICHTBARE_TIPS = 5

function TipLijst({ tips }: { tips: DossierTip[] }) {
  return (
    <ul>
      {tips.map((t) => (
        <li key={t.id}>
          <Link href={`/nieuwsplein33/tip/${t.id}`}>{ontstreep(t.titel)}</Link>
          <span className="np-dos-tip-meta">
            {formatDate(t.created_at)} · score {t.score} ·{' '}
            <span className={OPEN_STATUSSEN.includes(t.status) ? 'np-dos-open' : undefined}>
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function telPer(feiten: DossierFeitVolledig[], sleutel: 'fact_type' | 'zekerheid'): [string, number][] {
  const m = new Map<string, number>()
  for (const f of feiten) m.set(f[sleutel], (m.get(f[sleutel]) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export default async function DossierPagina({ params, searchParams }: Props) {
  if (!hasTurso()) return <GeenDatabase />

  const { slug } = await params
  const dossier = await getDossierBySlug(slug)
  if (!dossier) notFound()

  const { soort, zekerheid, volgorde } = await searchParams
  const oudsteEerst = volgorde === 'oud'

  const [feiten, tips] = await Promise.all([getDossierFeiten(dossier.id), getDossierTips(dossier.id)])
  const tipsPerSignaal = await getTipsPerSignaal(tips.map((t) => Number(t.id)))
  const tipOpId = new Map(tips.map((t) => [Number(t.id), t]))

  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
  const gefilterd = feiten.filter(
    (f) => (!soort || f.fact_type === soort) && (!zekerheid || f.zekerheid === zekerheid),
  )
  const gesorteerd = [...gefilterd].sort((a, b) => {
    // Zonder datum altijd achteraan.
    if (!a.datum !== !b.datum) return a.datum ? -1 : 1
    const v = (a.datum ?? a.created_at).localeCompare(b.datum ?? b.created_at) || a.id - b.id
    return oudsteEerst ? v : -v
  })

  // Groeperen per maand, in de gekozen volgorde.
  const groepen: { kop: string; feiten: DossierFeitVolledig[] }[] = []
  for (const f of gesorteerd) {
    const kop = maandKop(f.datum)
    const laatste = groepen[groepen.length - 1]
    if (laatste && laatste.kop === kop) laatste.feiten.push(f)
    else groepen.push({ kop, feiten: [f] })
  }

  const openTips = tips.filter((t) => OPEN_STATUSSEN.includes(t.status)).length
  // Open tips eerst, daarna nieuwste eerst. Na vijf klapt de rest in.
  const tipsGesorteerd = [...tips].sort((a, b) =>
    Number(OPEN_STATUSSEN.includes(b.status)) - Number(OPEN_STATUSSEN.includes(a.status))
    || b.created_at.localeCompare(a.created_at))
  const datums = feiten.map((f) => f.datum).filter((d): d is string => !!d).sort()
  const laatstToegevoegd = feiten.reduce<string | null>((m, f) => (!m || f.created_at > m ? f.created_at : m), null)
  const ids = new Set(feiten.map((f) => f.id))

  const basis = `/nieuwsplein33/dossiers/${dossier.slug}`
  const link = (wijziging: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const huidig = { soort, zekerheid, volgorde, ...wijziging }
    for (const [k, v] of Object.entries(huidig)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `${basis}?${s}` : basis
  }

  const omschrijving = tekst(dossier.omschrijving)

  return (
    <article className="np-dos">
      <Link href="/nieuwsplein33/dossiers" className="np-dos-terug">← Alle dossiers</Link>

      <header className="np-dos-kop">
        <h1>{ontstreep(dossier.naam, ' · ')}</h1>
        <div className="np-dos-regel-meta">
          <span>{feiten.length} {feiten.length === 1 ? 'feit' : 'feiten'}</span>
          {datums.length > 0 && <span>{formatDate(datums[0])} tot {formatDate(datums[datums.length - 1])}</span>}
          <span>
            {tips.length} {tips.length === 1 ? 'tip' : 'tips'}
            {openTips > 0 && <strong className="np-dos-open"> · {openTips} open</strong>}
          </span>
          {laatstToegevoegd && <span>laatst aangevuld {formatDate(laatstToegevoegd)}</span>}
        </div>
      </header>

      {omschrijving && (
        <section className="np-dos-context">
          <div className="np-dos-context-kop">Afbakening en aandachtspunten</div>
          <p>{omschrijving}</p>
          {dossier.trefwoorden && (
            <p className="np-dos-trefwoorden">
              Trefwoorden waarop de weger koppelt: {dossier.trefwoorden.split(',').map((t) => t.trim()).filter(Boolean).join(', ')}
            </p>
          )}
        </section>
      )}

      {tips.length > 0 && (
        <section className="np-dos-tips">
          <div className="np-dos-tips-kop">
            Tips uit dit dossier ({tips.length}{openTips > 0 ? `, ${openTips} open` : ''})
          </div>
          <TipLijst tips={tipsGesorteerd.slice(0, ZICHTBARE_TIPS)} />
          {tipsGesorteerd.length > ZICHTBARE_TIPS && (
            <details>
              <summary>Nog {tipsGesorteerd.length - ZICHTBARE_TIPS} tips</summary>
              <TipLijst tips={tipsGesorteerd.slice(ZICHTBARE_TIPS)} />
            </details>
          )}
        </section>
      )}

      <Tijdas feiten={gefilterd} vandaag={vandaag} />

      <div className="np-dos-filters">
        <div className="np-dos-filterrij">
          <span className="np-dos-filterlabel">Soort</span>
          <Link href={link({ soort: undefined })} className={`np-chip np-chip-klein${!soort ? ' np-dos-actief' : ''}`}>alle</Link>
          {telPer(feiten, 'fact_type').map(([s, n]) => (
            <Link key={s} href={link({ soort: s })} className={`np-chip np-chip-klein${soort === s ? ' np-dos-actief' : ''}`}>
              {s} <span className="np-chip-prefix">{n}</span>
            </Link>
          ))}
        </div>
        <div className="np-dos-filterrij">
          <span className="np-dos-filterlabel">Zekerheid</span>
          <Link href={link({ zekerheid: undefined })} className={`np-chip np-chip-klein${!zekerheid ? ' np-dos-actief' : ''}`}>alle</Link>
          {telPer(feiten, 'zekerheid').map(([z, n]) => (
            <Link key={z} href={link({ zekerheid: z })} className={`np-chip np-chip-klein${zekerheid === z ? ' np-dos-actief' : ''}`}>
              {z.replace(/_/g, ' ')} <span className="np-chip-prefix">{n}</span>
            </Link>
          ))}
        </div>
        <div className="np-dos-filterrij">
          <span className="np-dos-filterlabel">Volgorde</span>
          <Link href={link({ volgorde: undefined })} className={`np-chip np-chip-klein${!oudsteEerst ? ' np-dos-actief' : ''}`}>nieuwste eerst</Link>
          <Link href={link({ volgorde: 'oud' })} className={`np-chip np-chip-klein${oudsteEerst ? ' np-dos-actief' : ''}`}>oudste eerst</Link>
        </div>
      </div>

      {gefilterd.length < feiten.length && (
        <p className="np-telling">
          {gefilterd.length} van {feiten.length} feiten.{' '}
          <Link href={link({ soort: undefined, zekerheid: undefined })} className="np-telling-link">Filters wissen</Link>
        </p>
      )}

      {groepen.length === 0 && <p className="np-tekst np-stil">Geen feiten met deze filters.</p>}

      {groepen.map((g) => (
        <section key={g.kop} className="np-dos-maand">
          <h2>{g.kop}</h2>
          <ol className="np-tijdlijn">
            {g.feiten.map((f) => {
              const details = tekst(f.details)
              const tegen = tekst(f.tegenstrijdigheid)
              const classificatie = tekst(f.classificatie)
              const nieuw = (kalenderdagenGeleden(f.created_at) ?? 99) < 7
              const gepland = !!f.datum && f.datum > vandaag
              const tipIds = f.signal_id ? tipsPerSignaal.get(Number(f.signal_id)) ?? [] : []
              return (
                <li key={f.id} id={`feit-${f.id}`} className={f.superseded_by ? 'np-tijdlijn-oud' : undefined}>
                  <div className="np-tijdlijn-datum">
                    {f.datum ? formatDate(f.datum) : 'datum onbekend'}
                    {gepland && <div className="np-dos-gepland">gepland</div>}
                  </div>
                  <div className="np-tijdlijn-inhoud">
                    <strong>{ontstreep(f.titel ?? '')}</strong>
                    {nieuw && <span className="np-dos-nieuw"> nieuw</span>}
                    <div className="np-tijdlijn-meta">
                      <span>{f.fact_type}</span>
                      {classificatie && <span>· {classificatie}</span>}
                      {f.locatie && <span>· {f.locatie}</span>}
                      <span className={`np-zekerheid np-zekerheid-${f.zekerheid}`}>{f.zekerheid.replace(/_/g, ' ')}</span>
                      {f.superseded_by && (
                        ids.has(Number(f.superseded_by))
                          ? <a href={`#feit-${f.superseded_by}`} className="np-stil">· later gecorrigeerd</a>
                          : <span className="np-stil">· later gecorrigeerd</span>
                      )}
                    </div>
                    {details && <p className="np-tekst">{details}</p>}
                    {tegen && <p className="np-let-op-klein">Bronnen spreken elkaar tegen: {tegen}</p>}
                    {(f.primaire_bron_url || secundair(f.secundaire_bronnen).length > 0 || tipIds.length > 0) && (
                      <div className="np-chips">
                        {f.primaire_bron_url && <BronChip label="Brondocument" url={f.primaire_bron_url} />}
                        {secundair(f.secundaire_bronnen).map((u) => <BronChip key={u} url={u} />)}
                        {tipIds.map((id) => (
                          <Link key={id} href={`/nieuwsplein33/tip/${id}`} className="np-chip np-chip-klein">
                            <span className="np-chip-prefix">tip</span> {ontstreep(tipOpId.get(id)?.titel ?? `#${id}`).slice(0, 70)}
                          </Link>
                        ))}
                      </div>
                    )}
                    <div className="np-dos-herkomst">
                      vastgelegd {formatDate(f.created_at)}{f.actor ? ` door ${f.actor}` : ''}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </article>
  )
}
