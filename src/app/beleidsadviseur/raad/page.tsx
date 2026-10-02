import { hasTurso } from '@/lib/turso'
import { formatDate } from '@/lib/dashboard/format'
import { getRaadOverzicht, getSubsidieOverzicht, getWoonDossier } from '@/lib/dashboard/wonenQueries'
import { BELEIDSDOELEN } from '@/lib/dashboard/woonBeleid'
import type { ZoekParams } from '@/lib/dashboard/vergunningenFilter'
import GeenDatabase from '../../nieuwsplein33/GeenDatabase'
import { Extern, Kaart, Kolommen, Onbeschikbaar, Staven, euro, maandLabel, nl, vang } from '../Onderdelen'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  besluit: 'besluit', plan: 'plan', contract: 'overeenkomst', bedrag: 'bedrag', maatregel: 'maatregel',
  realisatie: 'realisatie', incident: 'incident', subsidie: 'subsidie', claim: 'claim', overig: 'overig',
}

export default async function RaadPagina({ searchParams }: { searchParams: Promise<ZoekParams> }) {
  if (!hasTurso()) return <GeenDatabase />
  const params = await searchParams
  const bronFilter = (Array.isArray(params.bron) ? params.bron[0] : params.bron) ?? ''
  const [raad, subsidies, dossier] = await Promise.all([
    vang(getRaadOverzicht(), 'raad'),
    vang(getSubsidieOverzicht(), 'subsidies'),
    vang(getWoonDossier(), 'dossier'),
  ])
  const stukken = raad.ok ? raad.data.stukken.filter((s) => !bronFilter || s.bron.replace('Raad Amersfoort — ', '') === bronFilter) : []

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Raad, regelgeving en beleid</h2>
          <p>
            Wat de gemeenteraad over wonen agendeert, welke verordeningen en beleidsregels gelden, waar de woonsubsidies naartoe gaan,
            het feitenregister van het woondossier en de beleidsdoelen waartegen dit dashboard meet.
          </p>
        </div>
      </div>

      <div className="bd-raster">
        <Kaart titel="Raadsstukken over wonen" breed={8} sub={raad.ok ? `${nl(raad.data.totaal)} in 180 dagen` : undefined} kinderen={
          raad.ok ? (
            <>
              <form method="get" className="bd-filters">
                <label>Soort stuk
                  <select name="bron" defaultValue={bronFilter}>
                    <option value="">alle soorten</option>
                    {raad.data.perBron.map((b) => <option key={b.bron} value={b.bron}>{b.bron} ({b.n})</option>)}
                  </select>
                </label>
                <button type="submit" className="bd-knop bd-knop-accent">Toon</button>
              </form>
              {stukken.length === 0 ? <p className="bd-leeg">Geen raadsstukken over wonen in deze selectie.</p> : (
                <ul className="bd-lijst">
                  {stukken.map((s) => (
                    <li key={s.id}>
                      <span className="bd-datum">{formatDate(s.datum)}</span>
                      <span className="bd-inhoud"><Extern href={s.url}>{s.titel}</Extern><span className="bd-meta"><span>{s.bron.replace('Raad Amersfoort — ', '')}</span></span></span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : <Onbeschikbaar u={raad} />
        } voet="Raadsinformatie Amersfoort (Notubiz): stukken waarvan de titel over wonen, huur, huisvesting, corporaties, omgevingsplan of grondexploitatie gaat. Schriftelijke vragen vragen een antwoord van het college; moties en amendementen een reactie in de raad." />

        <Kaart titel="Per soort stuk" breed={4} sub="afgelopen 180 dagen" kinderen={
          raad.ok ? <Staven rijen={raad.data.perBron.map((b) => ({ label: b.bron, waarde: b.n, href: `/beleidsadviseur/raad?bron=${encodeURIComponent(b.bron)}`, markeer: b.bron === bronFilter }))} /> : <Onbeschikbaar u={raad} />
        } />

        <Kaart titel="Verordeningen, beleidsregels en besluiten" breed={6} sub="Gemeenteblad, over wonen" kinderen={
          raad.ok ? (
            raad.data.regels.length === 0 ? <p className="bd-leeg">Geen regelingen over wonen gevonden.</p> : (
              <ul className="bd-lijst">
                {raad.data.regels.map((s) => (
                  <li key={s.id}>
                    <span className="bd-datum">{formatDate(s.datum)}</span>
                    <span className="bd-inhoud"><Extern href={s.url}>{s.titel}</Extern><span className="bd-meta"><span>{s.bron.replace('Officiële Bekendmakingen — ', '')}</span></span></span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={raad} />
        } voet="De geldende tekst van elke regeling staat op lokaleregelgeving.overheid.nl; hier staat de bekendmaking." />

        <Kaart titel="Beleidsdoelen waartegen dit dashboard meet" breed={6} sub="met bron en datum" kinderen={
          <ul className="bd-lijst">
            {BELEIDSDOELEN.map((d) => (
              <li key={d.id}>
                <span className="bd-datum">{d.datum}</span>
                <span className="bd-inhoud">
                  <strong>{d.naam}</strong>
                  {d.status === 'in voorbereiding' && <span className="bd-badge bd-badge-let">in voorbereiding</span>}
                  <span className="bd-details">{d.doel}</span>
                  <span className="bd-meta"><a href={d.bronUrl} target="_blank" rel="noopener noreferrer">{d.bron}</a></span>
                </span>
              </li>
            ))}
          </ul>
        } voet="Deze doelen staan in een klein, met de hand bijgehouden bestand in de code. Klopt een doel niet meer, laat het weten; dan wordt het bijgewerkt met de nieuwe bron." />

        <Kaart titel="Subsidies wonen" breed={12} sub="gemeentelijk subsidieregister, per regeling en jaar" kinderen={
          subsidies.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead><tr><th>Regeling</th><th>Ontvanger</th><th className="bd-getal">jaar</th><th className="bd-getal">aantal</th><th className="bd-getal">bedrag</th></tr></thead>
                <tbody>
                  {subsidies.data.regelingen.map((r, i) => (
                    <tr key={i}>
                      <td className="bd-cel-lang">{r.regeling}</td>
                      <td>{r.ontvanger ?? '–'}</td>
                      <td className="bd-getal">{r.jaar}</td>
                      <td className="bd-getal">{nl(r.aantal)}</td>
                      <td className="bd-getal">{euro(r.totaal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Onbeschikbaar u={subsidies} />
        } voet="Deelprogramma Wonen plus de isolatiesubsidie en de doorstroomwoningen uit het programma Zorg. Verleende bedragen, geen uitgaven. Subsidies aan opvang en beschermd wonen staan op het tabblad Wonen en zorg." />

        <Kaart titel="Woondossier: nieuwe feiten per maand" breed={6} sub="feitenregister van Stadsgeest" kinderen={
          dossier.ok ? (
            dossier.data.perMaand.length > 0
              ? <Kolommen labels={dossier.data.perMaand.map((m) => maandLabel(m.maand))} reeksen={[{ label: 'feiten', klasse: 's1', waarden: dossier.data.perMaand.map((m) => m.n) }]} />
              : <p className="bd-leeg">Nog geen feiten in de afgelopen twaalf maanden.</p>
          ) : <Onbeschikbaar u={dossier} />
        } />

        <Kaart titel="Soort feit en aanpalende dossiers" breed={6} kinderen={
          dossier.ok ? (
            <>
              <Staven rijen={dossier.data.perType.map((t) => ({ label: TYPE_LABEL[t.type] ?? t.type, waarde: t.n }))} klasse="s3" />
              {dossier.data.aanpalend.length > 0 && (
                <ul className="bd-chips" style={{ marginTop: 12 }}>
                  {dossier.data.aanpalend.map((a) => (
                    <li key={a.slug} title={a.omschrijving ?? undefined}><strong>{a.naam}</strong> · {nl(a.feiten)} feiten{a.laatste && <>, laatste {formatDate(a.laatste)}</>}</li>
                  ))}
                </ul>
              )}
            </>
          ) : <Onbeschikbaar u={dossier} />
        } />

        <Kaart titel="Laatste feiten in het woondossier" breed={12} sub={dossier.ok ? `${nl(dossier.data.totaal)} officiële of bevestigde feiten` : undefined} kinderen={
          dossier.ok ? (
            <ul className="bd-lijst">
              {dossier.data.feiten.map((f) => (
                <li key={f.id}>
                  <span className="bd-datum">{f.datum ? formatDate(f.datum) : 'zonder datum'}</span>
                  <span className="bd-inhoud">
                    <strong>{f.titel}</strong>
                    {f.details && <span className="bd-details">{f.details}</span>}
                    <span className="bd-meta">
                      {f.locatie && <span>{f.locatie}</span>}
                      <span>{TYPE_LABEL[f.fact_type] ?? f.fact_type}</span>
                      <span className="bd-zekerheid">{f.zekerheid}</span>
                      {f.dossier_slug !== 'woningbouw-wonen' && <span>dossier {f.dossier}</span>}
                      {f.primaire_bron_url && <a href={f.primaire_bron_url} target="_blank" rel="noopener noreferrer">bron</a>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <Onbeschikbaar u={dossier} />
        } voet="Besluiten, plannen, overeenkomsten en bedragen uit raadsstukken, bekendmakingen, rechtspraak en corporatieberichten. Claims en onbevestigde meldingen blijven bij de redactie." />
      </div>
    </main>
  )
}
