import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import { getDossierBySlug } from '@/lib/dashboard/dossierQueries'
import { getDossierGraaf } from '@/lib/dashboard/dossierGraaf'
import { formatDate, formatDateTime } from '@/lib/dashboard/format'
import { ontstreep } from '@/lib/dashboard/briefing'
import GeenDatabase from '../../../GeenDatabase'
import DossierTabs from '../../DossierTabs'
import GraafTekening, { type TekenKnoop, type TekenLijn } from '../../GraafTekening'

export const dynamic = 'force-dynamic'

// Graaf van een dossier: de meest genoemde partijen en de brondocumenten
// waarin ze staan (partij → document). Een weergave met lijnen tussen partijen
// onderling is op 1 oktober 2026 weggelaten: met de huidige koppeling bleef er
// te weinig over. De verantwoording van de telling staat onderaan. Puur lezend.

interface Props {
  params: Promise<{ slug: string }>
}

const MAX_BRONPARTIJEN = 12
const MAX_BRONDOCS = 40

export default async function DossierGraafPagina({ params }: Props) {
  if (!hasTurso()) return <GeenDatabase />
  const { slug } = await params
  const dossier = await getDossierBySlug(slug)
  if (!dossier) notFound()

  const graaf = await getDossierGraaf(dossier.id)
  const partijOpId = new Map(graaf.partijen.map((p) => [p.id, p]))
  const docOpId = new Map(graaf.documenten.map((d) => [d.id, d]))
  const v = graaf.verantwoording

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

  return (
    <article className="np-dos">
      <Link href="/nieuwsplein33/dossiers" className="np-dos-terug">← Alle dossiers</Link>
      <header className="np-dos-kop">
        <h1>{ontstreep(dossier.naam, ' · ')}</h1>
      </header>
      <DossierTabs slug={dossier.slug} actief="graaf" />

      <section className="np-dos-context np-graaf-uitleg">
        <div className="np-dos-context-kop">Waar kijk je naar?</div>
        <p>
          De {bronPartijen.length} partijen die het vaakst voorkomen in de brondocumenten van dit dossier, en de
          documenten waarin ze worden genoemd. Een lijn betekent alleen: deze partij wordt in dat document genoemd.
          Dat zegt niets over een relatie tussen partijen, ook niet als ze aan hetzelfde document hangen.
        </p>
        <ul>
          <li><strong>Bollen</strong> zijn partijen: groen een organisatie, blauw een persoon. Hoe groter, hoe meer documenten.</li>
          <li><strong>Grijze blokjes</strong> zijn brondocumenten (raadsstukken, besluiten, bekendmakingen). Een blokje met veel lijnen noemt veel van deze partijen.</li>
          <li><strong>Een gestippelde rand</strong> betekent dat Stadsgeest de naam automatisch aan deze partij heeft gekoppeld en dat nog niemand dat heeft bevestigd.</li>
          <li>De gemeente zelf is weggelaten, omdat die in bijna elk document staat. Namen die Stadsgeest niet aan een bekende partij kan koppelen ontbreken ook; die staan onderaan.</li>
          <li>Zoom in met <strong>+</strong> en versleep de tekening om een drukke plek te lezen. Klik op een blokje voor het document, op een bol voor de partij.</li>
        </ul>
      </section>

      {bronKnopen.length === 0 ? (
        <div className="np-leeg">
          <p className="np-leeg-kop">Geen gekoppelde partijen</p>
          <p>In de documenten van dit dossier staan nog geen partijen die Stadsgeest kan koppelen. Zie de verantwoording hieronder.</p>
        </div>
      ) : (
        <GraafTekening
          knopen={bronKnopen}
          lijnen={bronLijnen}
          label={`Partijen en brondocumenten in het dossier ${dossier.naam}`}
        />
      )}
      <div className="np-tijdas-legenda">
        <span><i className="np-graaf-leg np-graaf-leg-org" /> organisatie</span>
        <span><i className="np-graaf-leg np-graaf-leg-pers" /> persoon</span>
        <span><i className="np-graaf-leg np-graaf-leg-stippel" /> automatisch gekoppeld, niet bevestigd</span>
        <span><i className="np-graaf-leg np-graaf-leg-doc" /> document</span>
        <span>berekend {formatDateTime(graaf.berekend)}</span>
      </div>

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

      <section className="np-dos-maand">
        <h2>Partijen ({graaf.partijen.length})</h2>
        <table className="np-graaf-tabel">
          <thead>
            <tr><th>Partij</th><th>Koppeling</th><th>Documenten</th><th>Signalen</th><th>Feiten</th></tr>
          </thead>
          <tbody>
            {graaf.partijen.map((p) => (
              <tr key={p.id} id={`partij-${p.id}`}>
                <td>{p.naam} <span className="np-stil">{p.soort === 'person' ? 'persoon' : p.soort === 'organization' ? 'organisatie' : 'locatie'}</span></td>
                <td>{p.koppeling === 'kandidaat' ? 'automatisch' : 'bevestigd'}</td>
                <td>{p.documenten}</td>
                <td>{p.signalen}</td>
                <td>{p.feiten}</td>
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
