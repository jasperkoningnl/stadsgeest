import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getTips, getGeparkeerdDezeWeek, getMeetstand } from '@/lib/dashboard/tipQueries'
import TipRegel from './TipRegel'
import GeenDatabase from './GeenDatabase'

export const revalidate = 30

export default async function WachtrijPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const [tips, geparkeerd, meetstand] = await Promise.all([
    getTips(['wachtrij']),
    getGeparkeerdDezeWeek(),
    getMeetstand(),
  ])

  return (
    <>
      {(geparkeerd > 0 || meetstand.gepubliceerd > 0) && (
        <div className="np-strook">
          {geparkeerd > 0 && (
            <Link href="/nieuwsplein33/geparkeerd" className="np-strook-item">
              {geparkeerd} {geparkeerd === 1 ? 'tip is' : 'tips zijn'} deze week geparkeerd
            </Link>
          )}
          {meetstand.gepubliceerd > 0 && (
            <span className="np-strook-item np-strook-stil">
              {meetstand.eigenVondst} van {meetstand.gepubliceerd} gepubliceerde tips waren zonder Stadsgeest niet gevonden
            </span>
          )}
        </div>
      )}

      {tips.length === 0 ? (
        <div className="np-leeg">
          <p className="np-leeg-kop">Niets in de wachtrij</p>
          <p>
            Er liggen op dit moment geen nieuwe tips. Stadsgeest doorzoekt de bronnen elke ochtend;
            wat eruit komt verschijnt hier vanzelf.
          </p>
        </div>
      ) : (
        <>
          <p className="np-telling">
            {tips.length} {tips.length === 1 ? 'tip' : 'tips'} — sterkste eerst
          </p>
          <div className="np-lijst">
            {tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
          </div>
        </>
      )}
    </>
  )
}
