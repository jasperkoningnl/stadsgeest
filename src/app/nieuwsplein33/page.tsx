import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getTips, getGeparkeerdDezeWeek, getMeetstand, type TipRij } from '@/lib/dashboard/tipQueries'
import { kalenderdagenGeleden } from '@/lib/dashboard/format'
import TipRegel from './TipRegel'
import GeenDatabase from './GeenDatabase'

// Geen caching: een redacteur die net een tip heeft geparkeerd moet dat meteen
// terugzien. Met een revalidate van 30 seconden bleef een afgehandelde tip in de
// wachtrij staan en verscheen hij nog niet bij Geparkeerd.
export const dynamic = 'force-dynamic'

export default async function WachtrijPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const [tips, geparkeerd, meetstand] = await Promise.all([
    getTips(['wachtrij']),
    getGeparkeerdDezeWeek(),
    getMeetstand(),
  ])

  // Drie dagkopjes, aansluitend op het ochtendritme van de weger: wat is er
  // vandaag bijgekomen, wat gisteren, en wat ligt er nog van eerder. "Eerder"
  // blijft één groep — de kaarten tonen daar hun eigen datum al.
  const groepen: { kop: string; tips: TipRij[] }[] = [
    { kop: 'Vandaag', tips: [] },
    { kop: 'Gisteren', tips: [] },
    { kop: 'Eerder', tips: [] },
  ]
  for (const tip of tips) {
    const dagen = kalenderdagenGeleden(tip.created_at)
    if (dagen !== null && dagen <= 0) groepen[0].tips.push(tip)
    else if (dagen === 1) groepen[1].tips.push(tip)
    else groepen[2].tips.push(tip)
  }

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
        groepen.filter((g) => g.tips.length > 0).map((g) => (
          <section key={g.kop} className="np-daggroep">
            <h2 className="np-daggroep-kop">
              {g.kop}
              <span className="np-daggroep-tel">{g.tips.length}</span>
            </h2>
            <div className="np-lijst">
              {g.tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
            </div>
          </section>
        ))
      )}
    </>
  )
}
