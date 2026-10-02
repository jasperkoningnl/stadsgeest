import { hasTurso } from '@/lib/turso'
import { formatDate } from '@/lib/dashboard/format'
import { getDpiOverzicht, getVergunningenLijst, getZorgOverzicht, SOORT_LABEL } from '@/lib/dashboard/wonenQueries'
import { getBevolking, getHuishoudens, getPrognose, getWijken, getWmo, CBS_BRONNEN, cbsUrl } from '@/lib/dashboard/cbsWonen'
import GeenDatabase from '../../nieuwsplein33/GeenDatabase'
import { Aandacht, Extern, Kaart, Kolommen, Lijn, Onbeschikbaar, Staven, Tegel, euro, nl, pct, plusmin, vang, type Status } from '../Onderdelen'

export const dynamic = 'force-dynamic'

const ZORGCORPORATIES = ['33107894', '30038801'] // Woonzorg Nederland, Habion
const BRONNEN_HIER = ['85644NED', '71486ned', '85171NED', '86358NED', '85984NED', '86158NED', '86051NED']

export default async function WonenZorgPagina() {
  if (!hasTurso()) return <GeenDatabase />
  const [bevolking, huishoudens, prognose, wijken, wmo, zorg, lijst, dpi] = await Promise.all([
    vang(getBevolking(), 'cbs bevolking'),
    vang(getHuishoudens(), 'cbs huishoudens'),
    vang(getPrognose(), 'cbs prognose'),
    vang(getWijken(), 'cbs wijken'),
    vang(getWmo(), 'cbs wmo'),
    vang(getZorgOverzicht(), 'zorg'),
    vang(getVergunningenLijst(), 'vergunningenlijst'),
    vang(getDpiOverzicht(), 'dpi'),
  ])

  const bNu = bevolking.ok ? bevolking.data[bevolking.data.length - 1] : null
  const bTienJaar = bevolking.ok ? bevolking.data.find((b) => b.jaar === (bNu?.jaar ?? 0) - 10) ?? bevolking.data[0] : null
  const hNu = huishoudens.ok ? huishoudens.data[huishoudens.data.length - 1] : null
  const wmoNu = wmo.ok ? wmo.data[wmo.data.length - 1] : null
  const zorgVergunningen = lijst.ok ? lijst.data.items.filter((it) => it.zorg) : []

  // Wijken waar vergrijzing en woningvoorraad schuren: veel 80-plussers,
  // weinig gestapelde bouw (die vaker gelijkvloers en toegankelijk is) of
  // veel Wmo-gebruik. Een signaal om naar te kijken, geen oordeel.
  const wijkSignalen: { status: Status; statusTekst: string; titel: React.ReactNode; waarom: string }[] = []
  if (wijken.ok) {
    const w = wijken.data.wijken
    const aandeel80 = (x: typeof w[number]) => (x.inwoners > 0 ? (x.j80plus / x.inwoners) * 100 : 0)
    const gem80 = wijken.data.gemeente.inwoners > 0 ? (wijken.data.gemeente.j80plus / wijken.data.gemeente.inwoners) * 100 : 0
    const gemMeergezins = w.reduce((s, x) => s + (x.meergezinsPct ?? 0) * (x.woningen ?? 0), 0) / Math.max(1, w.reduce((s, x) => s + (x.woningen ?? 0), 0))
    for (const x of [...w].sort((a, b) => aandeel80(b) - aandeel80(a))) {
      const a80 = aandeel80(x)
      if (a80 >= gem80 * 1.5 && x.meergezinsPct !== null && x.meergezinsPct < gemMeergezins) {
        wijkSignalen.push({ status: 'let', statusTekst: 'vergrijzing', titel: <><strong>{x.naam}</strong>: {pct(a80, 1)} 80-plus (gemeente {pct(gem80, 1)}) bij {pct(x.meergezinsPct)} gestapelde woningen (gemiddeld {pct(gemMeergezins)}).</>, waarom: 'Veel hoogbejaarden in overwegend grondgebonden woningen: kans op doorstroomvraag en woningaanpassingen.' })
      } else if (a80 >= gem80 * 1.5) {
        wijkSignalen.push({ status: 'info', statusTekst: 'vergrijzing', titel: <><strong>{x.naam}</strong>: {pct(a80, 1)} 80-plus, {pct(x.meergezinsPct)} gestapeld, {x.wmoPer1000 !== null ? `${nl(x.wmoPer1000)} Wmo-cliënten per 1.000 inwoners` : 'Wmo onbekend'}.</>, waarom: 'Sterk vergrijsde wijk met relatief veel gestapelde bouw; zorg aan huis en toegankelijkheid wegen hier zwaar.' })
      }
      if (wijkSignalen.length >= 6) break
    }
    const gemWmo = wijken.data.gemeente.wmoPer1000
    if (gemWmo !== null) {
      for (const x of [...w].filter((x) => x.wmoPer1000 !== null && x.wmoPer1000 >= gemWmo * 1.4).sort((a, b) => (b.wmoPer1000 ?? 0) - (a.wmoPer1000 ?? 0)).slice(0, 3)) {
        if (!wijkSignalen.some((s) => String((s.titel as React.ReactElement<{ children?: unknown }>).props?.children).includes(x.naam))) {
          wijkSignalen.push({ status: 'info', statusTekst: 'Wmo', titel: <><strong>{x.naam}</strong>: {nl(x.wmoPer1000)} Wmo-cliënten per 1.000 inwoners (gemeente {nl(gemWmo)}), {pct(x.corporatiePct)} corporatiebezit.</>, waarom: 'Hoog Wmo-gebruik hangt samen met leeftijd én inkomen; hier raakt zorgbeleid het woonbeleid het meest.' })
        }
      }
    }
  }

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Wonen en zorg</h2>
          <p>
            Vergrijzing, zorg aan huis en wonen voor kwetsbare groepen: CBS-cijfers per gemeente en wijk, de plannen van de ouderenhuisvesters,
            bekendmakingen over zorgwoningen, raadsstukken en de subsidies aan beschermd en begeleid wonen en opvang.
          </p>
        </div>
        <div className="bd-intro-acties">
          <a className="bd-knop" href="/beleidsadviseur/export?set=wijken">Wijkcijfers (CSV)</a>
        </div>
      </div>

      <div className="bd-tegels">
        {bNu && (
          <>
            <Tegel getal={bNu.j65tot75 + bNu.j75tot85 + bNu.j85plus} label="65-plussers" toelichting={`1 januari ${bNu.jaar}, ${pct(((bNu.j65tot75 + bNu.j75tot85 + bNu.j85plus) / bNu.totaal) * 100, 1)} van de inwoners`} delta={bTienJaar ? bNu.j65tot75 + bNu.j75tot85 + bNu.j85plus - (bTienJaar.j65tot75 + bTienJaar.j75tot85 + bTienJaar.j85plus) : null} deltaLabel={`sinds ${bTienJaar?.jaar}`} />
            <Tegel getal={bNu.j75tot85 + bNu.j85plus} label="75-plussers" toelichting={`${pct(((bNu.j75tot85 + bNu.j85plus) / bNu.totaal) * 100, 1)} van de inwoners`} delta={bTienJaar ? bNu.j75tot85 + bNu.j85plus - (bTienJaar.j75tot85 + bTienJaar.j85plus) : null} deltaLabel={`sinds ${bTienJaar?.jaar}`} />
            <Tegel getal={bNu.j85plus} label="85-plussers" toelichting="de groep met de hoogste zorgvraag" delta={bTienJaar ? bNu.j85plus - bTienJaar.j85plus : null} deltaLabel={`sinds ${bTienJaar?.jaar}`} />
          </>
        )}
        {hNu && <Tegel getal={hNu.ref75plus} label="huishoudens 75-plus" toelichting={`hoofdbewoner 75 jaar of ouder, 1 januari ${hNu.jaar}; ${pct((hNu.ref75plus / hNu.totaal) * 100, 1)} van alle huishoudens`} />}
        {wmoNu && <Tegel getal={wmoNu.stand ?? 0} label={`Wmo-cliënten begin ${wmoNu.jaar}`} toelichting={`met een maatwerkvoorziening; instroom ${nl(wmoNu.instroom)}, uitstroom ${nl(wmoNu.uitstroom)} in ${wmoNu.jaar}`} />}
        {wijken.ok && wijken.data.gemeente.wmoPer1000 !== null && <Tegel getal={wijken.data.gemeente.wmoPer1000} label="Wmo-cliënten per 1.000 inwoners" toelichting={`heel ${wijken.data.wmoJaar}, alle maatwerkvoorzieningen`} />}
      </div>

      <div className="bd-raster">
        <Kaart titel="Waar wonen en zorg elkaar raken" breed={12} sub="signalen per wijk, afgeleid uit de CBS-cijfers" kinderen={
          wijken.ok ? <Aandacht punten={wijkSignalen} /> : <Onbeschikbaar u={wijken} />
        } voet="Gestapelde (meergezins)woningen zijn vaker gelijkvloers en met lift bereikbaar; een laag aandeel bij veel hoogbejaarden is een aanwijzing, geen oordeel over geschiktheid. Bevolking 2026, woningen 2024, Wmo 2025." />

        <Kaart titel="Ouderen in Amersfoort" breed={6} sub="inwoners per leeftijdsgroep, 1 januari" kinderen={
          bevolking.ok ? (
            <Kolommen
              labels={bevolking.data.map((b) => String(b.jaar))}
              reeksen={[
                { label: '65 tot 75', klasse: 's3', waarden: bevolking.data.map((b) => b.j65tot75) },
                { label: '75 tot 85', klasse: 's1', waarden: bevolking.data.map((b) => b.j75tot85) },
                { label: '85 en ouder', klasse: 's2', waarden: bevolking.data.map((b) => b.j85plus) },
              ]}
              getallen="laatste"
            />
          ) : <Onbeschikbaar u={bevolking} />
        } voet={bevolking.ok && bNu && bTienJaar ? `Sinds ${bTienJaar.jaar}: 75-plussers ${plusmin(bNu.j75tot85 + bNu.j85plus - (bTienJaar.j75tot85 + bTienJaar.j85plus))}, de totale bevolking ${plusmin(bNu.totaal - bTienJaar.totaal)}. De babyboomgeneratie bereikt de komende tien jaar de 80.` : undefined} />

        <Kaart titel="Bevolkingsprognose tot 2050" breed={6} sub="PBL/CBS regionale prognose 2023, x 1.000 inwoners" kinderen={
          prognose.ok ? (
            <Lijn
              labels={prognose.data.map((p) => String(p.jaar))}
              reeksen={[{ label: 'inwoners (x 1.000)', klasse: 's1', waarden: prognose.data.map((p) => p.bevolkingDuizend) }]}
              formatteer={(v) => nl(v, 0)}
            />
          ) : <Onbeschikbaar u={prognose} />
        } voet="De regionale prognose publiceert per gemeente alleen het totaal; de landelijke prognose verwacht dat het aantal 80-plussers tot 2040 ruim verdubbelt. Een leeftijdsprognose voor Amersfoort zelf staat niet in de CBS open data." />

        <Kaart titel="Wmo-cliënten per jaar" breed={6} sub="stand op 1 januari, naar type maatwerkvoorziening" kinderen={
          wmo.ok ? (
            <>
              <Lijn
                labels={wmo.data.map((w) => String(w.jaar))}
                reeksen={[
                  { label: 'hulpmiddelen en diensten', klasse: 's1', waarden: wmo.data.map((w) => w.hulpmiddelenStand) },
                  { label: 'hulp bij het huishouden', klasse: 's2', waarden: wmo.data.map((w) => w.hulpHuishoudenStand) },
                  { label: 'ondersteuning thuis', klasse: 's3', waarden: wmo.data.map((w) => w.thuisStand) },
                  { label: 'verblijf en opvang', klasse: 'rest', waarden: wmo.data.map((w) => w.verblijfStand) },
                ]}
                vanNul
              />
              <div className="bd-tabel-wrap" style={{ marginTop: 8 }}>
                <table className="bd-tabel">
                  <thead><tr><th>Jaar</th><th className="bd-getal">stand 1 jan</th><th className="bd-getal">instroom</th><th className="bd-getal">uitstroom</th><th className="bd-getal">verblijf en opvang</th></tr></thead>
                  <tbody>
                    {[...wmo.data].reverse().slice(0, 5).map((w) => (
                      <tr key={w.jaar}><td>{w.jaar}</td><td className="bd-getal">{nl(w.stand)}</td><td className="bd-getal">{nl(w.instroom)}</td><td className="bd-getal">{nl(w.uitstroom)}</td><td className="bd-getal">{nl(w.verblijfStand)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <Onbeschikbaar u={wmo} />
        } voet="Gemeentelijke Monitor Sociaal Domein via het CBS. Een cliënt kan meer voorzieningen hebben; de typen tellen daarom niet op tot het totaal. Trendbreuken in 2023 bij hulp bij het huishouden zijn een registratie-effect." />

        <Kaart titel="Wijken: ouderen, huishoudens en Wmo" breed={6} sub={wijken.ok ? `bevolking ${wijken.data.bevolkingsjaar}, Wmo ${wijken.data.wmoJaar}` : undefined} kinderen={
          wijken.ok ? (
            <Staven
              rijen={[...wijken.data.wijken].sort((a, b) => (b.j80plus / Math.max(1, b.inwoners)) - (a.j80plus / Math.max(1, a.inwoners))).slice(0, 14).map((w) => ({
                label: w.naam,
                waarde: Math.round((w.j80plus / Math.max(1, w.inwoners)) * 1000) / 10,
                detail: `${w.naam}: ${nl(w.j80plus)} 80-plussers (${pct((w.j80plus / Math.max(1, w.inwoners)) * 100, 1)}), ${nl(w.j65tot80)} van 65 tot 80; ${w.wmoPer1000 !== null ? `${nl(w.wmoPer1000)} Wmo-cliënten per 1.000` : 'Wmo onbekend'}`,
              }))}
              klasse="s2"
              formatteer={(v) => pct(v, 1)}
            />
          ) : <Onbeschikbaar u={wijken} />
        } voet="Aandeel 80-plussers per wijk, hoogste eerst. De volledige tabel met alle wijken staat hieronder en in de CSV." />

        <Kaart titel="Alle wijken" breed={12} sub="ouderen, huishoudens, woningtype en Wmo" kinderen={
          wijken.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead><tr><th>Wijk</th><th className="bd-getal">inwoners</th><th className="bd-getal">65–80</th><th className="bd-getal">80+</th><th className="bd-getal">80+ %</th><th className="bd-getal">eenpersoons %</th><th className="bd-getal">gestapeld %</th><th className="bd-getal">corporatie %</th><th className="bd-getal">Wmo-cliënten</th><th className="bd-getal">per 1.000</th></tr></thead>
                <tbody>
                  {[...wijken.data.wijken].sort((a, b) => (b.j80plus / Math.max(1, b.inwoners)) - (a.j80plus / Math.max(1, a.inwoners))).map((w) => (
                    <tr key={w.code}>
                      <td>{w.naam}</td>
                      <td className="bd-getal">{nl(w.inwoners)}</td>
                      <td className="bd-getal">{nl(w.j65tot80)}</td>
                      <td className="bd-getal">{nl(w.j80plus)}</td>
                      <td className="bd-getal"><span className="bd-balkje bd-balkje-s2" style={{ width: (w.j80plus / Math.max(1, w.inwoners)) * 100 * 4 }} />{pct((w.j80plus / Math.max(1, w.inwoners)) * 100, 1)}</td>
                      <td className="bd-getal">{pct((w.eenpersoons / Math.max(1, w.huishoudens)) * 100)}</td>
                      <td className="bd-getal">{pct(w.meergezinsPct)}</td>
                      <td className="bd-getal">{pct(w.corporatiePct)}</td>
                      <td className="bd-getal">{nl(w.wmoClienten)}</td>
                      <td className="bd-getal">{nl(w.wmoPer1000)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Amersfoort</td>
                    <td className="bd-getal">{nl(wijken.data.gemeente.inwoners)}</td>
                    <td className="bd-getal">{nl(wijken.data.gemeente.j65tot80)}</td>
                    <td className="bd-getal">{nl(wijken.data.gemeente.j80plus)}</td>
                    <td className="bd-getal">{pct((wijken.data.gemeente.j80plus / Math.max(1, wijken.data.gemeente.inwoners)) * 100, 1)}</td>
                    <td className="bd-getal">{pct((wijken.data.gemeente.eenpersoons / Math.max(1, wijken.data.gemeente.huishoudens)) * 100)}</td>
                    <td className="bd-getal"></td>
                    <td className="bd-getal"></td>
                    <td className="bd-getal">{nl(wijken.data.gemeente.wmoClienten)}</td>
                    <td className="bd-getal">{nl(wijken.data.gemeente.wmoPer1000)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <Onbeschikbaar u={wijken} />
        } voet="Wmo-cliënten per wijk zijn afgerond op vijftallen en ontbreken bij kleine aantallen. Gestapeld en corporatie zijn woningkenmerken van 1 januari 2024." />

        <Kaart titel="Ouderenhuisvesters in Amersfoort" breed={6} sub={dpi.ok ? `dPi ${dpi.data.dpiJaar}, zelfstandige woonruimte per doeljaar` : undefined} kinderen={
          dpi.ok ? (
            (() => {
              const zc = dpi.data.corporaties.filter((c) => ZORGCORPORATIES.includes(c.kvk))
              if (zc.length === 0) return <p className="bd-leeg">Geen opgave van Woonzorg Nederland of Habion voor Amersfoort gevonden.</p>
              return (
                <div className="bd-tabel-wrap">
                  <table className="bd-tabel">
                    <thead><tr><th>Corporatie</th>{dpi.data.jaren.map((j) => <th key={j} className="bd-getal">{j}</th>)}<th className="bd-getal">onzelfstandig</th></tr></thead>
                    <tbody>
                      {zc.map((c) => (
                        <tr key={c.kvk}>
                          <td>{c.naam}</td>
                          {dpi.data.jaren.map((j) => { const r = c.perJaar.find((x) => x.jaar === j); return <td key={j} className="bd-getal">{r ? nl(r.daeb + r.nietDaeb) : '–'}</td> })}
                          <td className="bd-getal bd-stil">{nl(c.onzelfstandig)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()
          ) : <Onbeschikbaar u={dpi} />
        } voet="Woonzorg Nederland en Habion verhuren uitsluitend aan ouderen en zorgorganisaties. Onzelfstandige eenheden zijn hier vaak intramurale zorgplaatsen in verhuurde zorggebouwen. De gewone corporaties huisvesten de meeste ouderen; dat staat op het tabblad Corporaties." />

        <Kaart titel="Subsidies aan wonen met zorg en opvang" breed={6} sub="gemeentelijk subsidieregister" kinderen={
          zorg.ok ? (
            zorg.data.subsidies.length === 0 ? <p className="bd-leeg">Geen subsidies gevonden.</p> : (
              <>
                <p className="bd-kaart-tekst">
                  {zorg.data.subsidieTotaalPerJaar.map((j) => `${j.jaar}: ${euro(j.totaal)} in ${j.aantal} subsidies`).join(' · ')}
                </p>
                <div className="bd-tabel-wrap">
                  <table className="bd-tabel">
                    <thead><tr><th>Omschrijving</th><th>Ontvanger</th><th className="bd-getal">jaar</th><th className="bd-getal">bedrag</th></tr></thead>
                    <tbody>
                      {zorg.data.subsidies.slice(0, 20).map((s, i) => (
                        <tr key={i}><td className="bd-cel-lang">{s.omschrijving}</td><td>{s.ontvanger ?? '–'}</td><td className="bd-getal">{s.jaar}</td><td className="bd-getal">{euro(s.bedrag)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          ) : <Onbeschikbaar u={zorg} />
        } voet="Geselecteerd op omschrijving: beschermd en begeleid wonen, (maatschappelijke, vrouwen-, winter-) opvang, doorstroomwoningen en huisvesting. Verleende bedragen zoals geregistreerd, geen uitgaven." />

        <Kaart titel="Bekendmakingen over zorgwoningen en mantelzorg" breed={6} sub="omgevingsvergunningen, kop bevat een zorgterm" kinderen={
          lijst.ok ? (
            zorgVergunningen.length === 0 ? <p className="bd-leeg">Geen bekendmakingen met een zorgterm in de kop.</p> : (
              <ul className="bd-lijst">
                {zorgVergunningen.slice(0, 15).map((it) => (
                  <li key={it.id}>
                    <span className="bd-datum">{formatDate(it.datum)}</span>
                    <span className="bd-inhoud"><Extern href={it.url}>{it.titel}</Extern><span className={`bd-badge bd-badge-${it.soort}`}>{SOORT_LABEL[it.soort]}</span></span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={lijst} />
        } voet="Mantelzorgwoningen zijn sinds 2014 meestal vergunningvrij en verschijnen alleen als kennisgeving. Termen: zorg, senioren, ouderen, mantelzorg, begeleid, verpleeg, levensloop, aanleun, opvang, beschermd wonen." />

        <Kaart titel="Raadsstukken over wonen en zorg" breed={6} sub="afgelopen twaalf maanden" kinderen={
          zorg.ok ? (
            zorg.data.raad.length === 0 ? <p className="bd-leeg">Geen raadsstukken gevonden.</p> : (
              <ul className="bd-lijst">
                {zorg.data.raad.slice(0, 15).map((s) => (
                  <li key={s.id}>
                    <span className="bd-datum">{formatDate(s.datum)}</span>
                    <span className="bd-inhoud"><Extern href={s.url}>{s.titel}</Extern><span className="bd-meta"><span>{s.bron}</span></span></span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={zorg} />
        } voet="Schriftelijke vragen, moties, amendementen, raadsinformatiebrieven en ingekomen stukken waarvan de titel beschermd of begeleid wonen, opvang, dakloosheid, ouderenhuisvesting, zorgwoningen, Skaeve Huse, flexwonen of doorstroming noemt." />

        <Kaart titel="Dossierfeiten over wonen en zorg" breed={12} sub="officieel of bevestigd, uit de dossiers wonen, opvang, zorgtoezicht en Skaeve Huse" kinderen={
          zorg.ok ? (
            zorg.data.feiten.length === 0 ? <p className="bd-leeg">Geen feiten gevonden.</p> : (
              <ul className="bd-lijst">
                {zorg.data.feiten.map((f) => (
                  <li key={f.id}>
                    <span className="bd-datum">{f.datum ? formatDate(f.datum) : 'zonder datum'}</span>
                    <span className="bd-inhoud">
                      <strong>{f.titel}</strong>
                      {f.details && <span className="bd-details">{f.details}</span>}
                      <span className="bd-meta">
                        {f.locatie && <span>{f.locatie}</span>}
                        <span>{f.fact_type}</span>
                        <span>dossier {f.dossier}</span>
                        {f.primaire_bron_url && <a href={f.primaire_bron_url} target="_blank" rel="noopener noreferrer">bron</a>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={zorg} />
        } />
      </div>

      <section className="bd-verantwoording">
        <h3>Over deze cijfers</h3>
        <ul>
          <li><strong>CBS-tabellen.</strong> {CBS_BRONNEN.filter((b) => BRONNEN_HIER.includes(b.tabel)).map((b, i) => <span key={b.tabel}>{i > 0 && ' · '}<a href={cbsUrl(b.tabel)} target="_blank" rel="noopener noreferrer">{b.tabel}</a> ({b.gebruik})</span>)}.</li>
          <li><strong>Wmo.</strong> Cliënten met een maatwerkvoorziening volgens de Gemeentelijke Monitor Sociaal Domein; algemene voorzieningen en Wlz-zorg vallen erbuiten.</li>
          <li><strong>Zorgtermen.</strong> De selectie van bekendmakingen, raadsstukken, subsidies en feiten werkt met woorden in de titel; een stuk zonder zo’n woord in de titel ontbreekt.</li>
          <li><strong>Niet beschikbaar.</strong> Intramurale zorgcapaciteit (verpleeghuisplaatsen) en wachtlijsten publiceert het CBS niet per gemeente; daarvoor zijn het zorgkantoor (Zilveren Kruis) en de aanbieders de bron.</li>
        </ul>
      </section>
    </main>
  )
}
