import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { getDossierBySlug } from '@/lib/dashboard/dossierQueries'
import { getDossierGraaf, type GraafLijn } from '@/lib/dashboard/dossierGraaf'
import { formatDate, formatDateTime } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import GeenDatabase from '../../../GeenDatabase'
import DossierTabs from '../../DossierTabs'
import GraafTekening, { type TekenKnoop, type TekenLijn } from '../../GraafTekening'

export const dynamic = 'force-dynamic'

// Partijengraaf van een dossier. Twee weergaven: partijen onderling (lijnen
// alleen bij samen genoemd in een passage of een vastgelegde KG-relatie) en
// bronnen (partij → document). Daaronder de onderbouwing van elke lijn en de
// verantwoording van de telling. Puur lezend.

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ weergave?: string }>
}

const MAX_PARTIJEN = 40
const MAX_BRONPARTIJEN = 12
const MAX_BRONDOCS = 40

const VORM: Record<string, string> = {
  alinea: 'zelfde alinea',
  regel: 'zelfde regel of tabelrij',
  venster: 'binnen 400 tekens',
}

function lijnId(l: GraafLijn): string {
  return `lijn-${l.soort}-${l.a}-${l.b}`
}

export default async function DossierGraafPagina({ params, searchParams }: Props) {
  if (!hasTurso()) return <GeenDatabase />
  const { slug } = await params
  const dossier = await getDossierBySlug(slug)
  if (!dossier) notFound()
  const { weergave } = await searchParams
  const bronnen = weergave === 'bronnen'

  const graaf = await getDossierGraaf(dossier.id)
  const partijOpId = new Map(graaf.partijen.map((p) => [p.id, p]))
  const zichtbareLijnen = graaf.lijnen.filter((l) => partijOpId.has(l.a) && partijOpId.has(l.b))
  const docOpId = new Map(graaf.documenten.map((d) => [d.id, d]))
  const v = graaf.verantwoording

  // ── Partijenweergave ──
  const metLijn = new Set(zichtbareLijnen.flatMap((l) => [l.a, l.b]))
  const getoond = graaf.partijen.filter((p) => metLijn.has(p.id)).slice(0, MAX_PARTIJEN)
  const getoondSet = new Set(getoond.map((p) => p.id))
  const partijKnopen: TekenKnoop[] = getoond.map((p) => ({
    id: `p${p.id}`, label: p.naam, grootte: p.documenten, soort: p.soort, stippel: p.koppeling === 'kandidaat',
    href: `#partij-${p.id}`,
    titel: `${p.naam} · ${p.documenten} documenten, ${p.signalen} signalen · ${p.koppeling === 'kandidaat' ? 'kandidaatkoppeling' : 'bevestigd'}`,
  }))
  const partijLijnen: TekenLijn[] = zichtbareLijnen
    .filter((l) => getoondSet.has(l.a) && getoondSet.has(l.b))
    .map((l) => ({
      van: `p${l.a}`, naar: `p${l.b}`, dikte: l.soort === 'relatie' ? 2 : l.documenten, soort: l.soort, href: `#${lijnId(l)}`,
      titel: l.soort === 'relatie'
        ? `${partijOpId.get(l.a)!.naam} – ${partijOpId.get(l.b)!.naam}: ${l.relatie}`
        : `${partijOpId.get(l.a)!.naam} – ${partijOpId.get(l.b)!.naam}: samen genoemd in ${l.documenten} ${l.documenten === 1 ? 'document' : 'documenten'}`,
    }))

  // ── Bronnenweergave ──
  const bronPartijen = graaf.partijen.slice(0, MAX_BRONPARTIJEN)
  const bronSet = new Set(bronPartijen.map((p) => p.id))
  const bronDocs = graaf.documenten
    .map((d) => ({ ...d, gekozen: d.partijen.filter((id) => bronSet.has(id)) }))
    .filter((d) => d.gekozen.length > 0)
    .sort((a, b) => b.gekozen.length - a.gekozen.length)
    .slice(0, MAX_BRONDOCS)
  const bronKnopen: TekenKnoop[] = [
    ...bronPartijen.map((p) => ({
      id: `p${p.id}`, label: p.naam, grootte: p.documenten, soort: p.soort, stippel: p.koppeling === 'kandidaat',
      href: `#partij-${p.id}`, titel: `${p.naam} · ${p.documenten} documenten`,
    })),
    ...bronDocs.map((d) => ({
      id: `d${d.id}`, label: ontstreep(d.titel), grootte: 1, soort: 'document' as const, stippel: false,
      href: `#doc-${d.id}`, titel: `${ontstreep(d.titel)}${d.datum ? ` · ${formatDate(d.datum)}` : ''}`,
    })),
  ]
  const bronLijnen: TekenLijn[] = bronDocs.flatMap((d) => d.gekozen.map((id) => ({
    van: `p${id}`, naar: `d${d.id}`, dikte: 1, soort: 'bron' as const, titel: `${partijOpId.get(id)?.naam} genoemd in ${ontstreep(d.titel)}`,
  })))

  const passageLijnen = zichtbareLijnen.filter((l) => l.soort === 'passage')
  const relatieLijnen = zichtbareLijnen.filter((l) => l.soort === 'relatie')

  return (
    <article className="np-dos">
      <Link href="/nieuwsplein33/dossiers" className="np-dos-terug">← Alle dossiers</Link>
      <header className="np-dos-kop">
        <h1>{ontstreep(dossier.naam, ' · ')}</h1>
      </header>
      <DossierTabs slug={dossier.slug} actief="graaf" />

      <div className="np-dos-filters">
        <div className="np-dos-filterrij">
          <span className="np-dos-filterlabel">Weergave</span>
          <Link href={`/nieuwsplein33/dossiers/${dossier.slug}/graaf`} className={`np-chip np-chip-klein${!bronnen ? ' np-dos-actief' : ''}`}>partijen</Link>
          <Link href={`/nieuwsplein33/dossiers/${dossier.slug}/graaf?weergave=bronnen`} className={`np-chip np-chip-klein${bronnen ? ' np-dos-actief' : ''}`}>partijen en bronnen</Link>
        </div>
      </div>

      <p className="np-telling">
        {bronnen
          ? `De ${bronPartijen.length} meest genoemde partijen en de documenten waarin ze staan. Een lijn betekent: genoemd in dit document.`
          : `Een lijn betekent: samen genoemd in dezelfde alinea, tabelrij of opsomming (gestreept), of een vastgelegde relatie (doorgetrokken). Alleen in hetzelfde document staan is geen lijn. Dikte = aantal documenten.`}
      </p>

      {!bronnen && partijKnopen.length === 0 ? (
        <div className="np-leeg">
          <p className="np-leeg-kop">Nog geen lijnen</p>
          <p>In de documenten van dit dossier staan geen gekoppelde partijen samen in een passage. Bekijk de weergave met bronnen of de verantwoording hieronder.</p>
        </div>
      ) : (
        <GraafTekening
          knopen={bronnen ? bronKnopen : partijKnopen}
          lijnen={bronnen ? bronLijnen : partijLijnen}
          label={`Netwerk van partijen in het dossier ${dossier.naam}`}
        />
      )}
      <div className="np-tijdas-legenda">
        <span><i className="np-graaf-leg np-graaf-leg-org" /> organisatie</span>
        <span><i className="np-graaf-leg np-graaf-leg-pers" /> persoon</span>
        <span><i className="np-graaf-leg np-graaf-leg-stippel" /> kandidaatkoppeling (niet bevestigd)</span>
        {bronnen && <span><i className="np-graaf-leg np-graaf-leg-doc" /> document</span>}
        <span>berekend {formatDateTime(graaf.berekend)}</span>
      </div>

      {!bronnen && (
        <section className="np-dos-maand">
          <h2>Lijnen ({passageLijnen.length + relatieLijnen.length})</h2>
          {passageLijnen.length + relatieLijnen.length === 0 && <p className="np-tekst np-stil">Geen.</p>}
          <ol className="np-tijdlijn">
            {[...relatieLijnen, ...passageLijnen].map((l) => (
              <li key={lijnId(l)} id={lijnId(l)}>
                <div className="np-tijdlijn-datum">
                  {l.soort === 'relatie' ? 'relatie' : `${l.documenten} ${l.documenten === 1 ? 'document' : 'documenten'}`}
                </div>
                <div className="np-tijdlijn-inhoud">
                  <strong>{partijOpId.get(l.a)!.naam} – {partijOpId.get(l.b)!.naam}</strong>
                  <div className="np-tijdlijn-meta">
                    {l.soort === 'relatie'
                      ? <span>vastgelegd in de kennisgraaf: {l.relatie}</span>
                      : <span>{l.passages} {l.passages === 1 ? 'passage' : 'passages'} · sterkst: {VORM[l.vorm ?? 'alinea']}</span>}
                  </div>
                  {l.voorbeelden.map((p, i) => {
                    const d = docOpId.get(p.doc)
                    return (
                      <div key={i} className="np-graaf-passage">
                        <p className="np-tekst">{p.tekst}</p>
                        <div className="np-dos-herkomst">
                          {VORM[p.vorm]} ·{' '}
                          {d?.url ? <a href={d.url} target="_blank" rel="noreferrer">{ontstreep(d.titel)} ↗</a> : ontstreep(d?.titel ?? `document ${p.doc}`)}
                          {d?.datum && ` · ${formatDate(d.datum)}`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {bronnen && (
        <section className="np-dos-maand">
          <h2>Documenten ({bronDocs.length})</h2>
          <ol className="np-tijdlijn">
            {bronDocs.map((d) => (
              <li key={d.id} id={`doc-${d.id}`}>
                <div className="np-tijdlijn-datum">{d.datum ? formatDate(d.datum) : '–'}</div>
                <div className="np-tijdlijn-inhoud">
                  <strong>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{ontstreep(d.titel)} ↗</a> : ontstreep(d.titel)}</strong>
                  <div className="np-tijdlijn-meta"><span>{d.gekozen.map((id) => partijOpId.get(id)?.naam).join(', ')}</span></div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="np-dos-maand">
        <h2>Partijen ({graaf.partijen.length})</h2>
        <table className="np-graaf-tabel">
          <thead>
            <tr><th>Partij</th><th>Koppeling</th><th>Documenten</th><th>Signalen</th><th>Feiten</th><th>Lijnen</th></tr>
          </thead>
          <tbody>
            {graaf.partijen.map((p) => (
              <tr key={p.id} id={`partij-${p.id}`}>
                <td>{p.naam} <span className="np-stil">{p.soort === 'person' ? 'persoon' : p.soort === 'organization' ? 'organisatie' : 'locatie'}</span></td>
                <td>{p.koppeling}</td>
                <td>{p.documenten}</td>
                <td>{p.signalen}</td>
                <td>{p.feiten}</td>
                <td>{zichtbareLijnen.filter((l) => l.a === p.id || l.b === p.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="np-dos-maand">
        <h2>Verantwoording</h2>
        <p className="np-tekst">
          Dit dossier heeft {v.feiten} feiten met een signaal, {v.signalen} signalen en {v.documenten} unieke
          brondocumenten. Elk document telt één keer, ook als het onder meerdere feiten hangt.
        </p>
        <div className="np-graaf-kolommen">
          <div>
            <h3 className="np-kopje">1. Naïeve telling (per feit)</h3>
            <ol className="np-graaf-telling">{v.naief.map((r) => <li key={r.naam}>{r.naam} <span className="np-stil">{r.feiten}</span></li>)}</ol>
          </div>
          <div>
            <h3 className="np-kopje">2. Na deduplicatie (per document)</h3>
            <ol className="np-graaf-telling">{v.naDeduplicatie.map((r) => <li key={r.naam}>{r.naam} <span className="np-stil">{r.documenten}</span></li>)}</ol>
          </div>
        </div>
        <h3 className="np-kopje">3. Paren</h3>
        <p className="np-tekst">
          {v.paren.zelfdeDocument} paren staan samen in minstens één document; daarvan blijven er{' '}
          {v.paren.naPassagefilter} over die samen in een passage staan. {v.paren.relaties} vastgelegde relaties uit de kennisgraaf.
        </p>
        <h3 className="np-kopje">Uitgesloten lijstpassages ({v.lijstpassages.aantal})</h3>
        <p className="np-tekst np-stil">Passages met meer dan vijf partijen, en opsommingen of ondertekeningen waarin namen alleen door andere namen, partijnamen of komma&apos;s gescheiden zijn. Ze maken geen lijnen.</p>
        <ul className="np-graaf-voorbeelden">
          {v.lijstpassages.voorbeelden.map((x, i) => (
            <li key={i}><strong>{x.partijen.join(', ')}</strong><br /><span className="np-stil">{docOpId.get(x.doc) ? ontstreep(docOpId.get(x.doc)!.titel) : `document ${x.doc}`}: </span>{x.tekst}</li>
          ))}
        </ul>
        <h3 className="np-kopje">Uitgesloten boilerplate ({v.boilerplate.aantal})</h3>
        <p className="np-tekst np-stil">Dezelfde passage in drie of meer documenten, zoals afzenderblokken en vergaderkoppen.</p>
        <ul className="np-graaf-voorbeelden">
          {v.boilerplate.voorbeelden.map((x, i) => <li key={i}><span className="np-stil">in {x.documenten} documenten: </span>{x.tekst}</li>)}
        </ul>
        {v.verborgen.length > 0 && (
          <p className="np-tekst np-stil">Verborgen omdat ze overal in staan: {v.verborgen.map((x) => `${x.naam} (${x.documenten} documenten)`).join(', ')}.</p>
        )}
        {v.geschrapteNaamvormen.length > 0 && (
          <>
            <h3 className="np-kopje">Niet gebruikte naamvormen</h3>
            <p className="np-tekst np-stil">{v.geschrapteNaamvormen.map((x) => `${x.vorm} (${x.reden})`).join(' · ')}</p>
          </>
        )}
        {v.nietGekoppeld.length > 0 && (
          <>
            <h3 className="np-kopje">Vaak genoemd, maar niet gekoppeld</h3>
            <p className="np-tekst np-stil">
              Organisatienamen die de naamherkenning vond maar die niet in de kennisgraaf staan. Ze doen niet mee in de graaf.
              Echte partijen hiertussen kunnen later aan de kennisgraaf worden toegevoegd.
            </p>
            <p className="np-tekst">{v.nietGekoppeld.map((x) => `${x.naam} (${x.documenten})`).join(' · ')}</p>
          </>
        )}
      </section>
    </article>
  )
}
