import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getTips, getGeparkeerdDezeWeek, getMeetstand, type TipRij } from '@/lib/dashboard/tipQueries'
import { kalenderdagenGeleden, supertipVastgezet } from '@/lib/dashboard/format'
import TipRegel from './TipRegel'
import WachtrijFilters from './WachtrijFilters'
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

  // Soorten met hun aantal, voor de filterknoppen.
  const perSoort = new Map<string, number>()
  for (const t of tips) perSoort.set(t.soort, (perSoort.get(t.soort) ?? 0) + 1)
  const soorten = [...perSoort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([soort, aantal]) => ({ soort, aantal }))

  // Een supertip staat tot de maandag na de run bovenaan, daarna gewoon in de
  // chronologie.
  const vast = tips.filter((t) => supertipVastgezet(t))

  // Vier dagkopjes: vandaag, gisteren, deze week, eerder.
  const groepen: { kop: string; tips: TipRij[] }[] = [
    { kop: 'Vandaag', tips: [] },
    { kop: 'Gisteren', tips: [] },
    { kop: 'Deze week', tips: [] },
    { kop: 'Eerder', tips: [] },
  ]
  for (const tip of tips) {
    if (vast.includes(tip)) continue
    const dagen = kalenderdagenGeleden(tip.created_at)
    if (dagen !== null && dagen <= 0) groepen[0].tips.push(tip)
    else if (dagen === 1) groepen[1].tips.push(tip)
    else if (dagen !== null && dagen <= 7) groepen[2].tips.push(tip)
    else groepen[3].tips.push(tip)
  }

  return (
    <>
      {/* Werkbalk: filters links, meldingen rechts. Eén regel in plaats van
          een losse strook plus een filterbalk tussen lijnen. */}
      <div className="np-werkbalk">
        <WachtrijFilters soorten={soorten} totaal={tips.length} />
        {(geparkeerd > 0 || meetstand.eigenVondst > 0) && (
          <div className="np-meldingen">
            {meetstand.eigenVondst > 0 && (
              <Link href="/nieuwsplein33/archief?eigen=1" className="np-melding np-melding-winst"
                title="Bekijk de tips waar deze artikelen uit voortkwamen">
                <span aria-hidden="true">✓</span>
                {meetstand.eigenVondst} {meetstand.eigenVondst === 1 ? 'artikel was' : 'artikelen waren'} zonder
                Stadsgeest niet geschreven
                <span aria-hidden="true" className="np-melding-pijl">→</span>
              </Link>
            )}
            {geparkeerd > 0 && (
              <Link href="/nieuwsplein33/geparkeerd" className="np-melding np-melding-let-op">
                {geparkeerd} deze week geparkeerd
              </Link>
            )}
          </div>
        )}
      </div>

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
        {vast.length > 0 && (
          <section className="np-daggroep np-daggroep-super">
            <h2 className="np-daggroep-kop">Supertip van deze week</h2>
            <div className="np-lijst">
              {vast.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
            </div>
          </section>
        )}
        {groepen.filter((g) => g.tips.length > 0).map((g) => (
          <section key={g.kop} className="np-daggroep">
            <h2 className="np-daggroep-kop">
              {g.kop}
              <span className="np-daggroep-tel">{g.tips.length}</span>
            </h2>
            <div className="np-lijst">
              {g.tips.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
            </div>
          </section>
        ))}</>
      )}
    </>
  )
}
