import { hasTurso } from '@/lib/turso'
import { getTips } from '@/lib/dashboard/tipQueries'
import TipRegel from '../TipRegel'
import GeenDatabase from '../GeenDatabase'

export const revalidate = 30

export default async function ArchiefPagina() {
  if (!hasTurso()) return <GeenDatabase />
  const tips = await getTips(['gepubliceerd', 'niet_gebruikt', 'afgekeurd'])

  return (
    <>
      <p className="np-telling">
        {tips.length === 0
          ? 'Nog niets afgehandeld.'
          : `${tips.length} afgehandelde ${tips.length === 1 ? 'tip' : 'tips'}. Afgewezen tips blijven bewaard — de reden telt mee bij het bijstellen van de selectie.`}
      </p>
      <div className="np-lijst">
        {tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
      </div>
    </>
  )
}
