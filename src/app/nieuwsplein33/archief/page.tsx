import Link from 'next/link'
import { hasTurso, q } from '@/lib/turso'
import { getTips } from '@/lib/dashboard/tipQueries'
import TipRegel from '../TipRegel'
import GeenDatabase from '../GeenDatabase'

export const dynamic = 'force-dynamic'

export default async function ArchiefPagina({
  searchParams,
}: {
  searchParams: Promise<{ eigen?: string }>
}) {
  if (!hasTurso()) return <GeenDatabase />
  const { eigen } = await searchParams
  const alleen = eigen === '1'

  // ?eigen=1 komt van de melding op de wachtrij: alleen de gepubliceerde tips
  // waarvan de redactie aangaf dat het artikel er zonder Stadsgeest niet was.
  // Zelfde telling als getMeetstand, zodat de melding en deze lijst kloppen.
  let tips = await getTips(alleen ? ['gepubliceerd'] : ['gepubliceerd', 'niet_gebruikt', 'afgekeurd'])
  if (alleen) {
    const rijen = await q<{ id: number }>(
      `SELECT id FROM tips WHERE status = 'gepubliceerd' AND eigen_vondst = 1`,
    )
    const ids = new Set(rijen.map((r) => Number(r.id)))
    tips = tips.filter((t) => ids.has(Number(t.id)))
  }

  return (
    <>
      {alleen ? (
        <p className="np-telling">
          {tips.length === 0
            ? 'Nog geen artikelen die er zonder Stadsgeest niet waren geweest.'
            : `${tips.length} ${tips.length === 1 ? 'artikel was' : 'artikelen waren'} zonder Stadsgeest niet geschreven. Dit zijn de tips waar ze uit voortkwamen.`}{' '}
          <Link href="/nieuwsplein33/archief" className="np-telling-link">Toon alle afgehandelde tips</Link>
        </p>
      ) : (
        <p className="np-telling">
          {tips.length === 0
            ? 'Nog niets afgehandeld.'
            : `${tips.length} afgehandelde ${tips.length === 1 ? 'tip' : 'tips'}. Afgewezen tips blijven bewaard; de reden telt mee bij het bijstellen van de selectie.`}
        </p>
      )}
      <div className="np-lijst">
        {tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
      </div>
    </>
  )
}
