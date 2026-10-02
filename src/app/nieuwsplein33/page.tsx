import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getTips, getGeparkeerdDezeWeek, getMeetstand, type TipRij } from '@/lib/dashboard/tipQueries'
import { getRecenteDossiers } from '@/lib/dashboard/dossierQueries'
import { kortDossierNaam } from '@/lib/dashboard/dossierNamen'
import { formatDate, kalenderdagenGeleden, supertipVastgezet } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import TipRegel from './TipRegel'
import GeenDatabase from './GeenDatabase'
import VerouderdeTips from './VerouderdeTips'

// Na zoveel kalenderdagen in de wachtrij schuift een tip naar de ingeklapte
// groep "Ouder dan een maand", met één knop om alles daarin af te sluiten.
const OUD_NA_DAGEN = 30

// Geen caching: een redacteur die net een tip heeft geparkeerd moet dat meteen
// terugzien. Met een revalidate van 30 seconden bleef een afgehandelde tip in de
// wachtrij staan en verscheen hij nog niet bij Geparkeerd.
export const dynamic = 'force-dynamic'

export default async function WachtrijPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const [tips, geparkeerd, meetstand, dossiers] = await Promise.all([
    getTips(['wachtrij']),
    getGeparkeerdDezeWeek(),
    getMeetstand(),
    // Een fout hier mag de wachtrij niet omleggen; dan blijft de strook weg.
    getRecenteDossiers().catch(() => []),
  ])

  // Een supertip staat tot de maandag na de run bovenaan, daarna gewoon in de
  // chronologie.
  const vast = tips.filter((t) => supertipVastgezet(t))

  // Vier dagkopjes: vandaag, gisteren, deze week, eerder. Wat langer dan een
  // maand ligt gaat naar een ingeklapte groep onderaan (sinds 3 oktober 2026).
  const groepen: { kop: string; tips: TipRij[] }[] = [
    { kop: 'Vandaag', tips: [] },
    { kop: 'Gisteren', tips: [] },
    { kop: 'Deze week', tips: [] },
    { kop: 'Eerder', tips: [] },
  ]
  const oud: TipRij[] = []
  for (const tip of tips) {
    if (vast.includes(tip)) continue
    const dagen = kalenderdagenGeleden(tip.created_at)
    if (dagen !== null && dagen <= 0) groepen[0].tips.push(tip)
    else if (dagen === 1) groepen[1].tips.push(tip)
    else if (dagen !== null && dagen <= 7) groepen[2].tips.push(tip)
    else if (dagen !== null && dagen > OUD_NA_DAGEN) oud.push(tip)
    else groepen[3].tips.push(tip)
  }

  return (
    <>
      {/* Werkbalk: recent aangevulde dossiers links, meldingen rechts. Het
          soortfilter (Alles/Nieuwsfeit/Patroon/Verdieping) is op 1 oktober
          2026 vervangen door deze dossierstrook. */}
      <div className="np-werkbalk np-werkbalk-wachtrij">
        {dossiers.length > 0 && (
          <nav className="np-dos-recent" aria-label="Recent aangevulde dossiers">
            <Link href="/nieuwsplein33/dossiers" className="np-dos-recent-label">Dossiers</Link>
            {dossiers.map((d) => (
              <Link key={d.slug} href={`/nieuwsplein33/dossiers/${d.slug}`} className="np-chip np-chip-klein"
                title={`${ontstreep(d.naam, ' · ')} · laatst aangevuld ${formatDate(d.laatst_toegevoegd)}`}>
                {kortDossierNaam(d.slug, d.naam)}
                {d.nieuw_week > 0 && <span className="np-dos-recent-tel">+{d.nieuw_week}</span>}
              </Link>
            ))}
          </nav>
        )}
        {(geparkeerd > 0 || meetstand.eigenVondst > 0) && (
          <div className="np-meldingen">
            {meetstand.eigenVondst > 0 && (
              <Link href="/nieuwsplein33/archief?eigen=1" className="np-melding np-melding-winst"
                title={`${meetstand.eigenVondst} ${meetstand.eigenVondst === 1 ? 'artikel was' : 'artikelen waren'} zonder Stadsgeest niet geschreven. Bekijk de tips waar ze uit voortkwamen.`}>
                <span aria-hidden="true">✓</span>
                {meetstand.eigenVondst} {meetstand.eigenVondst === 1 ? 'artikel' : 'artikelen'} dankzij Stadsgeest
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
        ))}
        {oud.length > 0 && (
          <details className="np-daggroep np-daggroep-oud">
            <summary className="np-daggroep-kop">
              Ouder dan een maand
              <span className="np-daggroep-tel">{oud.length}</span>
              <span className="np-daggroep-uitleg">ingeklapt; klik om te bekijken of af te sluiten</span>
            </summary>
            <VerouderdeTips tipIds={oud.map((t) => t.id)} />
            <div className="np-lijst">
              {oud.map((tip) => <TipRegel key={tip.id} tip={tip} />)}
            </div>
          </details>
        )}</>
      )}
    </>
  )
}
