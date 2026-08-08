import { hasTurso } from '@/lib/turso'
import { getTips } from '@/lib/dashboard/tipQueries'
import TipRegel from '../TipRegel'
import GeenDatabase from '../GeenDatabase'

export const dynamic = 'force-dynamic'

export default async function GeparkeerdPagina() {
  if (!hasTurso()) return <GeenDatabase />
  const tips = await getTips(['geparkeerd'])

  return (
    <>
      <p className="np-telling">
        {tips.length === 0
          ? 'Niets geparkeerd.'
          : `${tips.length} ${tips.length === 1 ? 'tip' : 'tips'} voor later — hier blijven ze staan tot je ze alsnog oppakt of afwijst.`}
      </p>
      <div className="np-lijst">
        {tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
      </div>
    </>
  )
}
