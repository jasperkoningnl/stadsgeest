import { hasTurso } from '@/lib/turso'
import { getTips, getMeetstand } from '@/lib/dashboard/tipQueries'
import TipRegel from '../TipRegel'
import GeenDatabase from '../GeenDatabase'

export const revalidate = 30

export default async function BehandelingPagina() {
  if (!hasTurso()) return <GeenDatabase />
  const [tips, meetstand] = await Promise.all([
    getTips(['goedgekeurd', 'in_behandeling']),
    getMeetstand(),
  ])

  return (
    <>
      <div className="np-meter">
        <div className="np-meter-getal">{meetstand.eigenVondst}</div>
        <div className="np-meter-tekst">
          <strong>artikelen die er zonder Stadsgeest niet waren geweest</strong>
          <span>
            {meetstand.gepubliceerd} tips leidden tot een artikel. Het doel van de testperiode is drie tot vijf
            aangevinkte artikelen. Vink dat aan bij de tip zelf, zodra het stuk online staat.
          </span>
        </div>
      </div>

      <p className="np-telling">
        {tips.length === 0
          ? 'Niets in behandeling.'
          : `${tips.length} ${tips.length === 1 ? 'tip' : 'tips'} goedgekeurd of in behandeling.`}
      </p>
      <div className="np-lijst">
        {tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
      </div>
    </>
  )
}
