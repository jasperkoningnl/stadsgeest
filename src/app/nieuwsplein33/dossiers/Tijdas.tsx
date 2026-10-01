// Horizontale tijdas boven de feitenlijst van een dossier: één stip per feit,
// kleur naar zekerheid. Een klik op een stip springt naar het feit in de lijst.
// Puur server-gerenderd HTML met procentuele posities, zodat labels op elke
// schermbreedte leesbaar blijven en er geen JavaScript nodig is.
import { formatDate } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'

export interface TijdasFeit {
  id: number
  datum: string | null
  titel: string
  zekerheid: string
  superseded_by: number | null
}

const MAANDEN_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const STIP = 10 // px, diameter
const RIJ = 12 // px, verticale afstand tussen gestapelde stippen
const MAX_RIJEN = 8

/** Zekerheid → kleurgroep voor de stip. */
export function zekerheidGroep(zekerheid: string): string {
  if (zekerheid === 'officieel' || zekerheid === 'bevestigd') return 'vast'
  if (zekerheid === 'onbevestigd' || zekerheid === 'betwist') return 'open'
  if (zekerheid === 'claim_belanghebbende') return 'claim'
  return 'zacht' // verwachting, theoretisch
}

function dagGetal(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? '1')) / 86400000
}

export default function Tijdas({ feiten, vandaag }: { feiten: TijdasFeit[]; vandaag: string }) {
  const gedateerd = feiten
    .map((f) => ({ ...f, dag: f.datum ? dagGetal(f.datum) : null }))
    .filter((f): f is typeof f & { dag: number } => f.dag !== null)
  const zonderDatum = feiten.length - gedateerd.length
  if (gedateerd.length === 0) return null

  const vandaagDag = dagGetal(vandaag)!
  const min = Math.min(...gedateerd.map((f) => f.dag))
  const max = Math.max(vandaagDag, ...gedateerd.map((f) => f.dag))
  // Wat marge aan beide kanten, en minstens drie maanden bereik.
  const bereik = Math.max(max - min, 90)
  const marge = bereik * 0.03
  const start = min - marge
  const eind = min + bereik + marge
  const pos = (dag: number) => ((dag - start) / (eind - start)) * 100

  // Stapelen: stippen die binnen ~1,2% van elkaar vallen komen boven elkaar.
  const BAK = 1.2
  const hoogteInBak = new Map<number, number>()
  const stippen = [...gedateerd]
    .sort((a, b) => a.dag - b.dag || a.id - b.id)
    .map((f) => {
      const x = pos(f.dag)
      const bak = Math.round(x / BAK)
      const rij = hoogteInBak.get(bak) ?? 0
      hoogteInBak.set(bak, rij + 1)
      return { ...f, x, rij: Math.min(rij, MAX_RIJEN - 1) }
    })
  const rijen = Math.min(MAX_RIJEN, Math.max(1, ...Array.from(hoogteInBak.values())))
  const hoogte = rijen * RIJ + 6

  // Ticks: jaren, en bij een kort bereik ook kwartalen.
  const startJaar = new Date(start * 86400000).getUTCFullYear()
  const eindJaar = new Date(eind * 86400000).getUTCFullYear()
  // Korter dan een jaar: elke maand. Korter dan tweeënhalf jaar: kwartalen.
  const maandStappen = eind - start < 400 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : eind - start < 900 ? [0, 3, 6, 9] : [0]
  const ticks: { x: number; label: string; jaar: boolean }[] = []
  for (let j = startJaar; j <= eindJaar; j++) {
    for (const m of maandStappen) {
      const dag = Date.UTC(j, m, 1) / 86400000
      if (dag < start || dag > eind) continue
      ticks.push({ x: pos(dag), label: m === 0 ? String(j) : MAANDEN_KORT[m], jaar: m === 0 })
    }
  }

  // Zonder jaartick aan het begin weet je niet in welk jaar de as start.
  if (ticks.length > 0 && !ticks[0].jaar) ticks[0].label += ` ${startJaar}`

  const vandaagX = pos(vandaagDag)
  const toekomst = gedateerd.filter((f) => f.dag > vandaagDag).length

  return (
    <figure className="np-tijdas" aria-label="Tijdas van de feiten in dit dossier">
      <div className="np-tijdas-veld" style={{ height: hoogte }}>
        {vandaagX < 99.5 && (
          <div className={`np-tijdas-vandaag${vandaagX > 85 ? ' np-tijdas-vandaag-rechts' : ''}`} style={{ left: `${vandaagX}%` }}>
            <span>vandaag</span>
          </div>
        )}
        {stippen.map((s) => (
          <a
            key={s.id}
            href={`#feit-${s.id}`}
            className={`np-tijdas-stip np-tijdas-${zekerheidGroep(s.zekerheid)}${s.superseded_by ? ' np-tijdas-oud' : ''}`}
            style={{ left: `calc(${s.x}% - ${STIP / 2}px)`, bottom: 3 + s.rij * RIJ }}
            title={`${formatDate(s.datum)} · ${ontstreep(s.titel)}`}
            aria-label={`${formatDate(s.datum)}: ${ontstreep(s.titel)}`}
          />
        ))}
      </div>
      <div className="np-tijdas-as">
        {ticks.map((t) => (
          <span key={`${t.label}-${t.x}`} className={t.jaar ? 'np-tijdas-jaar' : undefined} style={{ left: `${t.x}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <figcaption className="np-tijdas-legenda">
        <span><i className="np-tijdas-stip np-tijdas-vast" /> officieel of bevestigd</span>
        <span><i className="np-tijdas-stip np-tijdas-open" /> onbevestigd of betwist</span>
        <span><i className="np-tijdas-stip np-tijdas-claim" /> claim van belanghebbende</span>
        <span><i className="np-tijdas-stip np-tijdas-zacht" /> verwachting of theoretisch</span>
        {toekomst > 0 && <span>{toekomst} gepland na vandaag</span>}
        {zonderDatum > 0 && <span>{zonderDatum} zonder datum, alleen in de lijst</span>}
      </figcaption>
    </figure>
  )
}
