import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { getDossierOverzicht, laatsteTwaalfMaanden } from '@/lib/dashboard/dossierQueries'
import { formatDate, kalenderdagenGeleden } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import GeenDatabase from '../GeenDatabase'

export const dynamic = 'force-dynamic'

// Overzicht van alle dossiers: terugkerende onderwerpen waarvoor Stadsgeest
// feiten bewaart, ook als die los geen nieuws zijn. Wat het laatst is
// aangevuld staat bovenaan. Puur lezend.

const MAAND_LETTER = ['j', 'f', 'm', 'a', 'm', 'j', 'j', 'a', 's', 'o', 'n', 'd']

function bijgewerkt(iso: string | null): string {
  const dagen = kalenderdagenGeleden(iso)
  if (dagen === null) return 'nog geen feiten'
  if (dagen === 0) return 'vandaag aangevuld'
  if (dagen === 1) return 'gisteren aangevuld'
  if (dagen < 14) return `${dagen} dagen geleden aangevuld`
  return `aangevuld ${formatDate(iso)}`
}

function jaarBereik(van: string | null, tot: string | null): string | null {
  if (!van) return null
  const a = van.slice(0, 4)
  const b = (tot ?? van).slice(0, 4)
  return a === b ? a : `${a}–${b}`
}

export default async function DossiersPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const dossiers = await getDossierOverzicht()
  const maanden = laatsteTwaalfMaanden()
  // Eén schaal voor alle stroken, zodat dossiers onderling vergelijkbaar zijn.
  const piek = Math.max(1, ...dossiers.flatMap((d) => d.per_maand))
  const totaalFeiten = dossiers.reduce((som, d) => som + d.feiten, 0)

  if (dossiers.length === 0) {
    return (
      <div className="np-leeg">
        <p className="np-leeg-kop">Nog geen dossiers</p>
        <p>Zodra de weger een terugkerend onderwerp afbakent, verschijnt het hier.</p>
      </div>
    )
  }

  return (
    <>
      <p className="np-telling">
        {dossiers.length} dossiers met samen {totaalFeiten} feiten. Een dossier bewaart wat Stadsgeest
        over een terugkerend onderwerp vond, ook als een feit los geen nieuws is. Het laatst aangevulde
        staat bovenaan.
      </p>
      <div className="np-lijst">
        {dossiers.map((d) => {
          const bereik = jaarBereik(d.van, d.laatste_datum)
          return (
            <Link key={d.id} href={`/nieuwsplein33/dossiers/${d.slug}`} className="np-dos-regel">
              <div className="np-dos-regel-hoofd">
                <div className="np-dos-regel-naam">{ontstreep(d.naam, ' · ')}</div>
                {d.laatste_feit && (
                  <div className="np-dos-regel-laatste">
                    <span className="np-dos-regel-laatste-label">laatst</span>
                    {d.laatste_feit.datum && <span className="np-stil">{formatDate(d.laatste_feit.datum)} · </span>}
                    {ontstreep(d.laatste_feit.titel)}
                  </div>
                )}
                <div className="np-dos-regel-meta">
                  <span>{d.feiten} {d.feiten === 1 ? 'feit' : 'feiten'}</span>
                  {bereik && <span>{bereik}</span>}
                  {d.tips > 0 && (
                    <span>
                      {d.tips} {d.tips === 1 ? 'tip' : 'tips'}
                      {d.open_tips > 0 && <strong className="np-dos-open"> · {d.open_tips} open</strong>}
                    </span>
                  )}
                  <span>{bijgewerkt(d.laatst_toegevoegd)}</span>
                  {d.nieuw_week > 0 && <span className="np-dos-nieuw">+{d.nieuw_week} deze week</span>}
                </div>
              </div>
              <div
                className="np-dos-strook"
                role="img"
                aria-label={`Feiten per maand, ${maanden[0]} tot ${maanden[11]}: ${d.per_maand.join(', ')}`}
              >
                {d.per_maand.map((n, i) => (
                  <span key={maanden[i]} className="np-dos-strook-maand" title={`${maanden[i]}: ${n} ${n === 1 ? 'feit' : 'feiten'}`}>
                    <span className="np-dos-strook-bak">
                      <span
                        className="np-dos-strook-balk"
                        style={{ height: n === 0 ? 0 : `${Math.max(12, Math.round(Math.sqrt(n / piek) * 100))}%` }}
                      />
                    </span>
                    <span className="np-dos-strook-letter">{MAAND_LETTER[Number(maanden[i].slice(5, 7)) - 1]}</span>
                  </span>
                ))}
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
