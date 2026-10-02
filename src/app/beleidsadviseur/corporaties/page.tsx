import { hasTurso } from '@/lib/turso'
import { formatDate, formatDateTime } from '@/lib/dashboard/format'
import { getDpiOverzicht, getCorporatieNieuws } from '@/lib/dashboard/wonenQueries'
import { getEigendom, getWaarde, cbsUrl } from '@/lib/dashboard/cbsWonen'
import { WOONDEAL_GRENZEN } from '@/lib/dashboard/woonBeleid'
import GeenDatabase from '../../nieuwsplein33/GeenDatabase'
import { Extern, Kaart, Kolommen, Lijn, Onbeschikbaar, Staven, Tegel, euro, nl, pct, plusmin, vang } from '../Onderdelen'

export const dynamic = 'force-dynamic'

export default async function CorporatiesPagina() {
  if (!hasTurso()) return <GeenDatabase />
  const [dpi, nieuws, eigendom, waarde] = await Promise.all([
    vang(getDpiOverzicht(), 'dpi'),
    vang(getCorporatieNieuws(), 'corporatienieuws'),
    vang(getEigendom(), 'cbs eigendom'),
    vang(getWaarde(), 'cbs waarde'),
  ])
  const eerste = dpi.ok ? dpi.data.jaren[0] : null
  const laatste = dpi.ok ? dpi.data.jaren[dpi.data.jaren.length - 1] : null
  const totaalEerste = dpi.ok && dpi.data.totaalPerJaar[0] ? dpi.data.totaalPerJaar[0].daeb + dpi.data.totaalPerJaar[0].nietDaeb : null
  const totaalLaatste = dpi.ok && dpi.data.totaalPerJaar.length > 0 ? dpi.data.totaalPerJaar[dpi.data.totaalPerJaar.length - 1].daeb + dpi.data.totaalPerJaar[dpi.data.totaalPerJaar.length - 1].nietDaeb : null
  const cbsLaatste = eigendom.ok ? eigendom.data[eigendom.data.length - 1] : null
  const segmenten = dpi.ok && dpi.data.corporaties[0]
    ? dpi.data.corporaties[0].segmenten.map((_, i) => ({ label: dpi.data.corporaties[0].segmenten[i].label, waarde: dpi.data.corporaties.reduce((s, c) => s + (c.segmenten[i]?.aantal ?? 0), 0) }))
    : []
  const segTotaal = segmenten.reduce((s, x) => s + x.waarde, 0)

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Woningcorporaties</h2>
          <p>
            Wat de corporaties met bezit in Amersfoort bij de Autoriteit woningcorporaties opgeven over hun voorraad en plannen (dPi),
            naast wat het CBS telt aan corporatiebezit. Prognoses zijn verwachtingen van de corporaties zelf, geen gerealiseerde aantallen.
          </p>
        </div>
      </div>

      <div className="bd-tegels">
        {dpi.ok && totaalEerste !== null && totaalLaatste !== null && (
          <>
            <Tegel getal={totaalEerste} label={`zelfstandige corporatiewoningen ${eerste}`} toelichting={`opgave dPi ${dpi.data.dpiJaar}, ${dpi.data.corporaties.length} corporaties`} />
            <Tegel getal={plusmin(totaalLaatste - totaalEerste)} label={`gepland tot ${laatste}`} toelichting="saldo van nieuwbouw, aankoop, verkoop en sloop volgens de prognose" />
            <Tegel getal={pct((dpi.data.totaalPerJaar[0].daeb / Math.max(1, totaalEerste)) * 100)} label={`DAEB (sociaal) in ${eerste}`} toelichting="gereguleerde huur onder de liberalisatiegrens" />
          </>
        )}
        {cbsLaatste && (
          <Tegel getal={cbsLaatste.corporatie} label={`corporatiewoningen volgens CBS, ${cbsLaatste.jaar}`} toelichting={`${pct((cbsLaatste.corporatie / cbsLaatste.totaal) * 100, 1)} van de voorraad; Nederland ${pct(cbsLaatste.nlCorporatiePct, 1)}`} delta={eigendom.ok && eigendom.data.length > 1 ? cbsLaatste.corporatie - eigendom.data[eigendom.data.length - 2].corporatie : null} deltaLabel="verschil met een jaar eerder" />
        )}
      </div>

      <div className="bd-raster">
        <Kaart titel="Zelfstandige woonruimte, alle corporaties samen" breed={6} sub={dpi.ok ? `prognose dPi ${dpi.data.dpiJaar}` : undefined} kinderen={
          dpi.ok ? (
            <Kolommen
              labels={dpi.data.totaalPerJaar.map((j) => String(j.jaar))}
              reeksen={[
                { label: 'DAEB (sociaal)', klasse: 's1', waarden: dpi.data.totaalPerJaar.map((j) => j.daeb) },
                { label: 'niet-DAEB', klasse: 's2', waarden: dpi.data.totaalPerJaar.map((j) => j.nietDaeb) },
              ]}
              eenheid=" woningen"
              getallen="alle"
            />
          ) : <Onbeschikbaar u={dpi} />
        } voet={dpi.ok && dpi.data.opgehaald ? `Bron opgehaald op ${formatDateTime(dpi.data.opgehaald)} via data.overheid.nl.` : undefined} />

        <Kaart titel={`Huurklassen in ${eerste ?? ''}`} breed={6} sub="zelfstandige woonruimte, alle corporaties" kinderen={
          dpi.ok ? (
            <>
              <Staven rijen={segmenten.map((s) => ({ label: s.label, waarde: s.waarde, detail: `${s.label}: ${nl(s.waarde)} woningen (${pct((s.waarde / Math.max(1, segTotaal)) * 100)})` }))} />
              <p className="bd-kaart-tekst" style={{ marginTop: 10 }}>
                Woondeal-grenzen (prijspeil 2022/2023): sociale huur tot {euro(WOONDEAL_GRENZEN.socialeHuur)}, middenhuur tot {euro(WOONDEAL_GRENZEN.middenhuur)} per maand,
                betaalbare koop tot {euro(WOONDEAL_GRENZEN.betaalbareKoop)}.
              </p>
            </>
          ) : <Onbeschikbaar u={dpi} />
        } voet="De dPi-klassen volgen de huurtoeslaggrenzen van het opgavejaar; 'goedkoop' en 'betaalbaar' zijn samen het sociale segment onder de aftoppingsgrenzen." />

        <Kaart titel="Per corporatie" breed={12} sub="zelfstandige woonruimte per doeljaar" kinderen={
          dpi.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead>
                  <tr>
                    <th>Corporatie</th>
                    {dpi.data.jaren.map((j) => <th key={j} className="bd-getal">{j}</th>)}
                    <th className="bd-getal">verschil</th>
                    <th className="bd-getal">DAEB {eerste}</th>
                    <th className="bd-getal">onzelfstandig {eerste}</th>
                  </tr>
                </thead>
                <tbody>
                  {dpi.data.corporaties.map((c) => {
                    const e = (c.perJaar[0]?.daeb ?? 0) + (c.perJaar[0]?.nietDaeb ?? 0)
                    const l = (c.perJaar[c.perJaar.length - 1]?.daeb ?? 0) + (c.perJaar[c.perJaar.length - 1]?.nietDaeb ?? 0)
                    const verschil = l - e
                    return (
                      <tr key={c.kvk}>
                        <td title={`KVK ${c.kvk}`}>{c.naam}</td>
                        {dpi.data.jaren.map((j) => {
                          const r = c.perJaar.find((x) => x.jaar === j)
                          return <td key={j} className="bd-getal" title={r ? `DAEB ${nl(r.daeb)} · niet-DAEB ${nl(r.nietDaeb)}` : undefined}>{r ? nl(r.daeb + r.nietDaeb) : '–'}</td>
                        })}
                        <td className={`bd-getal ${verschil > 0 ? 'bd-plus' : verschil < 0 ? 'bd-min' : 'bd-stil'}`}>{plusmin(verschil)}</td>
                        <td className="bd-getal bd-stil">{e > 0 ? pct(((c.perJaar[0]?.daeb ?? 0) / e) * 100) : '–'}</td>
                        <td className="bd-getal bd-stil">{nl(c.onzelfstandig)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {totaalEerste !== null && totaalLaatste !== null && (
                  <tfoot>
                    <tr>
                      <td>Totaal</td>
                      {dpi.data.totaalPerJaar.map((j) => <td key={j.jaar} className="bd-getal">{nl(j.daeb + j.nietDaeb)}</td>)}
                      <td className="bd-getal">{plusmin(totaalLaatste - totaalEerste)}</td>
                      <td className="bd-getal">{pct((dpi.data.totaalPerJaar[0].daeb / Math.max(1, totaalEerste)) * 100)}</td>
                      <td className="bd-getal">{nl(dpi.data.corporaties.reduce((s, c) => s + c.onzelfstandig, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : <Onbeschikbaar u={dpi} />
        } voet="Onzelfstandige woonruimte zijn kamers en eenheden met gedeelde voorzieningen (studenten, zorg). Woonzorg Nederland en Habion zijn landelijke ouderenhuisvesters; hun bezit staat ook op het tabblad Wonen en zorg." />

        <Kaart titel={dpi.ok ? `Bijgestelde plannen: dPi ${dpi.data.dpiJaar - 1} tegenover dPi ${dpi.data.dpiJaar}` : 'Bijgestelde plannen'} breed={6} sub="zelfde doeljaar, grootste verschillen eerst" kinderen={
          dpi.ok ? (
            dpi.data.verschuivingen.length === 0 ? <p className="bd-leeg">Geen verschillen tussen de twee opgaven gevonden.</p> : (
              <div className="bd-tabel-wrap">
                <table className="bd-tabel">
                  <thead><tr><th>Corporatie</th><th>Onderdeel</th><th className="bd-getal">doeljaar</th><th className="bd-getal">vorig</th><th className="bd-getal">nu</th><th className="bd-getal">verschil</th></tr></thead>
                  <tbody>
                    {dpi.data.verschuivingen.map((r, i) => {
                      const verschil = r.huidige - r.vorige
                      return (
                        <tr key={i}>
                          <td>{r.naam}</td>
                          <td className="bd-cel-lang">{r.metric}</td>
                          <td className="bd-getal">{r.doeljaar}</td>
                          <td className="bd-getal bd-stil">{nl(r.vorige)}</td>
                          <td className="bd-getal">{nl(r.huidige)}</td>
                          <td className={`bd-getal ${verschil > 0 ? 'bd-plus' : 'bd-min'}`}>{plusmin(verschil)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : <Onbeschikbaar u={dpi} />
        } voet="Een neerwaartse bijstelling van het totaal betekent meestal uitstel of schrappen van nieuwbouw, of meer verkoop; vraag het bij de prestatieafspraken na." />

        <Kaart titel="Corporatiebezit volgens het CBS" breed={6} sub="woningen in eigendom van corporaties, 1 januari" kinderen={
          eigendom.ok ? (
            <>
              <Lijn
                labels={eigendom.data.map((j) => String(j.jaar))}
                reeksen={[{ label: 'corporatiewoningen', klasse: 's1', waarden: eigendom.data.map((j) => j.corporatie) }]}
              />
              {waarde.ok && (() => { const w = [...waarde.data].reverse().find((x) => x.wozCorporatie !== null); return w ? <p className="bd-kaart-tekst" style={{ marginTop: 8 }}>Gemiddelde WOZ-waarde van een corporatiewoning in {w.jaar}: € {nl(w.wozCorporatie)}k, tegenover € {nl(w.wozKoop)}k voor een koopwoning.</p> : null })()}
            </>
          ) : <Onbeschikbaar u={eigendom} />
        } voet={<>CBS-tabel <a href={cbsUrl('86286NED')} target="_blank" rel="noopener noreferrer">86286NED</a>. Het verschil met de dPi-opgave komt door definities (zelfstandig tegenover alle woningen, peildatum) en door bezit van corporaties zonder opgave voor Amersfoort.</>} />

        <Kaart titel="Berichten van De Alliantie over Amersfoort" breed={12} sub="eigen berichten van de corporatie" kinderen={
          nieuws.ok ? (
            nieuws.data.length === 0 ? <p className="bd-leeg">Geen recente berichten.</p> : (
              <ul className="bd-lijst">
                {nieuws.data.map((b) => (
                  <li key={b.id}>
                    <span className="bd-datum">{formatDate(b.datum)}</span>
                    <span className="bd-inhoud"><Extern href={b.url}>{b.titel}</Extern></span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={nieuws} />
        } voet="De datum is het moment waarop Stadsgeest het bericht zag. Portaal en Omnia Wonen worden nog niet als bron gevolgd." />
      </div>

      <section className="bd-verantwoording">
        <h3>Over deze cijfers</h3>
        <ul>
          <li><strong>dPi.</strong> De prognose-informatie die corporaties jaarlijks aanleveren bij de Autoriteit woningcorporaties, via data.overheid.nl, gefilterd op gemeente Amersfoort en toegelaten instellingen. Namen zijn op KVK-nummer opgezocht in het Handelsregister.</li>
          <li><strong>DAEB.</strong> Diensten van algemeen economisch belang: het sociale, gereguleerde deel van het bezit. Niet-DAEB is vrijesectorhuur en overig vastgoed.</li>
          <li><strong>Actualiteit.</strong> De dPi verschijnt eenmaal per jaar; de CBS-reeks eenmaal per jaar met stand 1 januari.</li>
        </ul>
      </section>
    </main>
  )
}
