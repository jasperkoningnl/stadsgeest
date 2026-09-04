import Link from 'next/link'
import { hasTurso } from '@/lib/turso'
import { verken } from '@/lib/dashboard/verkennerQueries'
import { formatDate } from '@/lib/dashboard/format'
import GeenDatabase from '../GeenDatabase'

export const dynamic = 'force-dynamic'

// De verkenner: alles wat Stadsgeest over een naam of onderwerp heeft. De
// ingang is een klik op een betrokkene bij een tip, of een losse zoekopdracht.
// Puur lezend; er verandert hier niets aan de data.

const SIGNAAL_STATUS: Record<string, string> = {
  new: 'nieuw',
  watching: 'in de gaten',
  researching: 'in onderzoek',
  published: 'artikel geworden',
  discarded: 'afgevoerd',
}

function euro(bedrag: number): string {
  return bedrag.toLocaleString('nl-NL')
}

export default async function VerkennerPagina({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  if (!hasTurso()) return <GeenDatabase />

  const { q } = await searchParams
  const term = (q ?? '').trim()
  const resultaat = term.length >= 2 ? await verken(term) : null

  return (
    <div className="np-verkenner">
      <form method="GET" className="np-zoekbalk" role="search">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Zoek een persoon, organisatie, straat of onderwerp…"
          aria-label="Zoeken in alles wat Stadsgeest heeft"
        />
        <button type="submit">Zoeken</button>
      </form>

      {!resultaat && (
        <div className="np-leeg">
          <p className="np-leeg-kop">De verkenner</p>
          <p>
            Zoek hier door alles wat Stadsgeest heeft verzameld: tips, sporen uit de bronnen,
            dossierfeiten, het subsidieregister en de onderliggende documenten. Klik bij een tip
            op een naam onder &ldquo;Wie hierin voorkomen&rdquo; om hier direct uit te komen.
          </p>
        </div>
      )}

      {resultaat && (
        <>
          <p className="np-telling">
            Resultaten voor &ldquo;{resultaat.term}&rdquo;
            {resultaat.verbreedNaar && <> — niets gevonden op de volledige naam, gezocht op &ldquo;{resultaat.verbreedNaar}&rdquo;</>}
          </p>

          {/* Springnavigatie: ankers naar de secties met resultaten */}
          {(() => {
            const secties = [
              resultaat.tips.length > 0 && { id: 'v-tips', label: `Tips (${resultaat.tips.length})` },
              resultaat.subsidieTotalen.length > 0 && { id: 'v-subsidies', label: 'Subsidies' },
              resultaat.feiten.length > 0 && { id: 'v-feiten', label: `Feiten (${resultaat.feiten.length})` },
              resultaat.signalen.length > 0 && { id: 'v-signalen', label: `Sporen (${resultaat.signalen.length})` },
              resultaat.documenten.length > 0 && { id: 'v-documenten', label: `Documenten (${resultaat.documenten.length})` },
            ].filter(Boolean) as { id: string; label: string }[]
            if (secties.length <= 1) return null
            return (
              <nav className="np-verkenner-spring" aria-label="Spring naar sectie">
                {secties.map((s) => (
                  <a key={s.id} href={`#${s.id}`}>{s.label}</a>
                ))}
              </nav>
            )
          })()}

          {resultaat.tips.length > 0 && (
            <section id="v-tips" className="np-verkenner-blok">
              <h3 className="np-kopje">Tips ({resultaat.tips.length})</h3>
              <div className="np-lijst">
                {resultaat.tips.map((t) => (
                  <Link key={t.id} href={`/nieuwsplein33/tip/${t.id}`} className="np-regel">
                    <span className="np-regel-titel">{t.titel}</span>
                    <p className="np-regel-kern">{t.kern}</p>
                    <div className="np-regel-meta">
                      <span>{t.status.replace(/_/g, ' ')}</span>
                      <span className="np-regel-scheiding">·</span>
                      <span>{formatDate(t.created_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {resultaat.subsidieTotalen.length > 0 && (
            <section id="v-subsidies" className="np-verkenner-blok">
              <h3 className="np-kopje">Subsidieregister</h3>
              <p className="np-tekst np-stil">
                Gemeentelijke subsidies waarvan de ontvanger op de zoekterm lijkt.
                Totaal per jaar: {resultaat.subsidieTotalen.map((t) => `${t.jaar}: € ${euro(t.totaal)} (${t.aantal}×)`).join(' — ')}.
              </p>
              <div className="np-beheer-tabel-wrap">
                <table className="np-tabel">
                  <thead>
                    <tr><th>Jaar</th><th>Ontvanger</th><th>Omschrijving</th><th>Programma</th><th>Bedrag</th></tr>
                  </thead>
                  <tbody>
                    {resultaat.subsidies.map((s, i) => (
                      <tr key={i}>
                        <td>{s.jaar}</td>
                        <td>{s.ontvanger}</td>
                        <td className="np-cel-lang">{s.omschrijving}</td>
                        <td>{s.deelprogramma}</td>
                        <td>€ {euro(s.bedrag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {resultaat.feiten.length > 0 && (
            <section id="v-feiten" className="np-verkenner-blok">
              <h3 className="np-kopje">Dossierfeiten ({resultaat.feiten.length})</h3>
              <ol className="np-tijdlijn">
                {resultaat.feiten.map((f) => (
                  <li key={f.id}>
                    <div className="np-tijdlijn-datum">{f.datum ? formatDate(f.datum) : 'datum onbekend'}</div>
                    <div className="np-tijdlijn-inhoud">
                      <strong>{f.titel}</strong>
                      <div className="np-tijdlijn-meta">
                        <span>dossier {f.dossier}</span>
                        <span className={`np-zekerheid np-zekerheid-${f.zekerheid}`}>{f.zekerheid.replace(/_/g, ' ')}</span>
                      </div>
                      {f.details && <p className="np-tekst">{f.details}</p>}
                      {f.primaire_bron_url && (
                        <a href={f.primaire_bron_url} target="_blank" rel="noreferrer">brondocument</a>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {resultaat.signalen.length > 0 && (
            <section id="v-signalen" className="np-verkenner-blok">
              <h3 className="np-kopje">Sporen uit de bronnen ({resultaat.signalen.length})</h3>
              <p className="np-tekst np-stil">
                Onderwerpen die Stadsgeest volgt of heeft gevolgd; niet elk spoor werd een tip.
              </p>
              <ul className="np-verkenner-signalen">
                {resultaat.signalen.map((s) => (
                  <li key={s.id}>
                    <span className="np-verkenner-signaal-titel">{s.title}</span>
                    <span className="np-regel-meta">
                      <span>{SIGNAAL_STATUS[s.status] ?? s.status}</span>
                      <span className="np-regel-scheiding">·</span>
                      <span>{s.confirmations} {s.confirmations === 1 ? 'bevestiging' : 'bevestigingen'}</span>
                      <span className="np-regel-scheiding">·</span>
                      <span>sinds {formatDate(s.first_seen_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {resultaat.documenten.length > 0 && (
            <section id="v-documenten" className="np-verkenner-blok">
              <h3 className="np-kopje">
                Documenten
                {resultaat.documentenTotaal > resultaat.documenten.length
                  ? ` (nieuwste ${resultaat.documenten.length} van ${resultaat.documentenTotaal})`
                  : ` (${resultaat.documenten.length})`}
              </h3>
              <ol className="np-doclijst">
                {resultaat.documenten.map((d, i) => (
                  <li key={i} className="np-doc">
                    <div className="np-doc-kop">
                      {d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.titel}</a> : <span>{d.titel}</span>}
                    </div>
                    <div className="np-doc-meta">
                      <span className="np-bron">{d.bron}</span>
                      <span className="np-regel-scheiding">·</span>
                      <span>{formatDate(d.datum)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {resultaat.tips.length + resultaat.signalen.length + resultaat.feiten.length
            + resultaat.subsidies.length + resultaat.documenten.length === 0 && (
            <div className="np-leeg">
              <p className="np-leeg-kop">Niets gevonden</p>
              <p>
                Stadsgeest heeft niets over &ldquo;{resultaat.term}&rdquo;. Probeer een kortere
                schrijfwijze — alleen een achternaam werkt vaak beter dan een volledige naam.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
