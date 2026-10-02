import { getWoningvoorraad, getEigendom, getBouwvergunningen, getWaarde, getHuishoudens, getVerhuizingen, getWijken, CBS_BRONNEN, cbsUrl } from '@/lib/dashboard/cbsWonen'
import { WONINGBOUWDOEL_PER_JAAR } from '@/lib/dashboard/woonBeleid'
import { Kaart, Kolommen, Lijn, Onbeschikbaar, Tegel, maandLabel, maandNaam, nl, pct, plusmin, vang } from '../Onderdelen'

export const dynamic = 'force-dynamic'

const BRONNEN_HIER = ['86098NED', '86286NED', '83671NED', '85036NED', '83625NED', '71486ned', '60048ned', '85984NED', '86358NED']

export default async function WoningmarktPagina() {
  const [voorraad, eigendom, bouw, waarde, huishoudens, verhuizingen, wijken] = await Promise.all([
    vang(getWoningvoorraad(), 'cbs voorraad'),
    vang(getEigendom(), 'cbs eigendom'),
    vang(getBouwvergunningen(), 'cbs bouwvergunningen'),
    vang(getWaarde(), 'cbs waarde'),
    vang(getHuishoudens(), 'cbs huishoudens'),
    vang(getVerhuizingen(), 'cbs verhuizingen'),
    vang(getWijken(), 'cbs wijken'),
  ])
  const laatsteEigendom = eigendom.ok ? eigendom.data[eigendom.data.length - 1] : null
  const laatsteWaarde = waarde.ok ? [...waarde.data].reverse().find((w) => w.wozTotaal !== null) : null
  const laatstePrijs = waarde.ok ? [...waarde.data].reverse().find((w) => w.verkoopprijs !== null) : null
  const laatsteHuish = huishoudens.ok ? huishoudens.data[huishoudens.data.length - 1] : null

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Woningmarkt Amersfoort volgens het CBS</h2>
          <p>
            Woningvoorraad, bouwproductie, eigendom, waarde en huishoudens uit CBS StatLine, rechtstreeks opgehaald en dagelijks ververst.
            Waar het kan staat Nederland ernaast als ijkpunt.
          </p>
        </div>
        <div className="bd-intro-acties">
          <a className="bd-knop" href="/beleidsadviseur/export?set=wijken">Wijkcijfers (CSV)</a>
        </div>
      </div>

      <div className="bd-tegels">
        {voorraad.ok && (
          <>
            <Tegel getal={voorraad.data.maanden[voorraad.data.maanden.length - 1]?.eind ?? 0} label="woningen" toelichting={`stand eind ${maandLabel(voorraad.data.laatsteMaand)}`} delta={voorraad.data.ditJaar.saldo} deltaLabel={`sinds 1 januari ${voorraad.data.ditJaar.jaar}`} />
            {voorraad.data.perJaar.length > 0 && (() => { const j = voorraad.data.perJaar[voorraad.data.perJaar.length - 1]; return <Tegel getal={j.saldo} label={`woningen erbij in ${j.jaar}`} toelichting={`${nl(j.nieuwbouw)} nieuwbouw, ${nl(j.toevoegingen)} toevoegingen, ${nl(j.sloop + j.onttrekkingen)} eraf; doel 1.000`} delta={j.saldo - WONINGBOUWDOEL_PER_JAAR} deltaLabel="verschil met het Deltaplan-doel van 1.000 per jaar" /> })()}
          </>
        )}
        {laatsteEigendom && (
          <>
            <Tegel getal={pct((laatsteEigendom.koop / laatsteEigendom.totaal) * 100)} label="koopwoningen" toelichting={`1 januari ${laatsteEigendom.jaar}; Nederland ${pct(laatsteEigendom.nlKoopPct)}`} />
            <Tegel getal={pct((laatsteEigendom.corporatie / laatsteEigendom.totaal) * 100)} label="corporatiebezit" toelichting={`1 januari ${laatsteEigendom.jaar}; Nederland ${pct(laatsteEigendom.nlCorporatiePct)}`} />
            <Tegel getal={pct((laatsteEigendom.leegstand / laatsteEigendom.totaal) * 100, 1)} label="administratief leeg" toelichting={`${nl(laatsteEigendom.leegstand)} woningen zonder ingeschreven bewoner, 1 januari ${laatsteEigendom.jaar}`} />
          </>
        )}
        {laatsteWaarde && <Tegel getal={`€ ${nl(laatsteWaarde.wozTotaal)}k`} label="gemiddelde WOZ-waarde" toelichting={`${laatsteWaarde.jaar}; Nederland € ${nl(laatsteWaarde.wozNederland)}k`} />}
        {laatstePrijs && <Tegel getal={`€ ${nl(Math.round((laatstePrijs.verkoopprijs ?? 0) / 1000))}k`} label="gemiddelde verkoopprijs" toelichting={`bestaande koopwoningen, ${laatstePrijs.jaar}`} />}
        {laatsteHuish && <Tegel getal={laatsteHuish.totaal} label="huishoudens" toelichting={`1 januari ${laatsteHuish.jaar}; ${pct((laatsteHuish.eenpersoons / laatsteHuish.totaal) * 100)} eenpersoons`} />}
      </div>

      <div className="bd-raster">
        <Kaart titel="Woningen erbij en eraf per jaar" breed={8} sub="nieuwbouw, overige toevoegingen, sloop en onttrekkingen" kinderen={
          voorraad.ok ? (
            <>
              <Kolommen
                labels={voorraad.data.perJaar.map((j) => String(j.jaar))}
                reeksen={[
                  { label: 'nieuwbouw gereed', klasse: 's1', waarden: voorraad.data.perJaar.map((j) => j.nieuwbouw) },
                  { label: 'overige toevoegingen', klasse: 's3', waarden: voorraad.data.perJaar.map((j) => j.toevoegingen) },
                ]}
                getallen="alle"
              />
              <div className="bd-tabel-wrap" style={{ marginTop: 12 }}>
                <table className="bd-tabel">
                  <thead><tr><th>Jaar</th><th className="bd-getal">nieuwbouw</th><th className="bd-getal">toevoegingen</th><th className="bd-getal">sloop</th><th className="bd-getal">onttrekkingen</th><th className="bd-getal">saldo</th><th className="bd-getal">voorraad eind</th><th className="bd-getal">groei</th><th className="bd-getal">NL groei</th></tr></thead>
                  <tbody>
                    {[...voorraad.data.perJaar].reverse().map((j) => {
                      const nlJaar = voorraad.data.nederland.find((x) => x.jaar === j.jaar)
                      return (
                        <tr key={j.jaar}>
                          <td>{j.jaar}</td>
                          <td className="bd-getal">{nl(j.nieuwbouw)}</td>
                          <td className="bd-getal">{nl(j.toevoegingen)}</td>
                          <td className="bd-getal bd-stil">{nl(j.sloop)}</td>
                          <td className="bd-getal bd-stil">{nl(j.onttrekkingen)}</td>
                          <td className={`bd-getal ${j.saldo >= WONINGBOUWDOEL_PER_JAAR ? 'bd-plus' : ''}`}>{plusmin(j.saldo)}</td>
                          <td className="bd-getal">{nl(j.eind)}</td>
                          <td className="bd-getal">{pct(j.begin > 0 ? ((j.eind - j.begin) / j.begin) * 100 : 0, 1)}</td>
                          <td className="bd-getal bd-stil">{nlJaar ? pct(nlJaar.groeiPct, 1) : '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : <Onbeschikbaar u={voorraad} />
        } voet="Saldo is de netto verandering van de woningvoorraad, inclusief administratieve correcties. Groen saldo: het Deltaplan-doel van 1.000 per jaar is gehaald." />

        <Kaart titel={voorraad.ok ? `Lopend jaar: ${voorraad.data.ditJaar.jaar} t/m ${maandNaam(voorraad.data.ditJaar.totMaand)}` : 'Lopend jaar'} breed={4} sub="tegenover dezelfde maanden vorig jaar" kinderen={
          voorraad.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead><tr><th></th><th className="bd-getal">{voorraad.data.ditJaar.jaar}</th><th className="bd-getal">{voorraad.data.ditJaar.jaar - 1}</th></tr></thead>
                <tbody>
                  <tr><td>Nieuwbouw gereed</td><td className="bd-getal">{nl(voorraad.data.ditJaar.nieuwbouw)}</td><td className="bd-getal bd-stil">{nl(voorraad.data.vorigJaarTotMaand.nieuwbouw)}</td></tr>
                  <tr><td>Overige toevoegingen</td><td className="bd-getal">{nl(voorraad.data.ditJaar.toevoegingen)}</td><td className="bd-getal bd-stil">{nl(voorraad.data.vorigJaarTotMaand.toevoegingen)}</td></tr>
                  <tr><td>Bouw gestart</td><td className="bd-getal">{nl(voorraad.data.ditJaar.gestart)}</td><td className="bd-getal bd-stil">{nl(voorraad.data.vorigJaarTotMaand.gestart)}</td></tr>
                  <tr><td>Saldo voorraad</td><td className="bd-getal"><strong>{plusmin(voorraad.data.ditJaar.saldo)}</strong></td><td className="bd-getal bd-stil">{plusmin(voorraad.data.vorigJaarTotMaand.saldo)}</td></tr>
                </tbody>
              </table>
            </div>
          ) : <Onbeschikbaar u={voorraad} />
        } voet="Bouw gestart is een voorlopende indicator: wat nu start, komt meestal binnen één tot twee jaar gereed. De laatste maanden worden door het CBS nog bijgesteld." />

        <Kaart titel="Nieuwbouw gereed en bouw gestart per maand" breed={12} sub="laatste 24 maanden" kinderen={
          voorraad.ok ? (
            <Kolommen
              labels={voorraad.data.maanden.map((m) => maandLabel(m.maand))}
              reeksen={[
                { label: 'nieuwbouw gereed', klasse: 's1', waarden: voorraad.data.maanden.map((m) => m.nieuwbouw) },
                { label: 'bouw gestart', klasse: 's2', waarden: voorraad.data.maanden.map((m) => m.gestart) },
              ]}
            />
          ) : <Onbeschikbaar u={voorraad} />
        } voet="De kolommen tonen beide reeksen gestapeld om de maanden te vergelijken; het zijn verschillende gebeurtenissen en ze tellen niet op." />

        <Kaart titel="Vergunde nieuwbouwwoningen per kwartaal" breed={6} sub="huur en koop" kinderen={
          bouw.ok ? (
            <Kolommen
              labels={bouw.data.kwartalen.map((k) => `K${k.nr} ’${String(k.jaar).slice(2)}`)}
              reeksen={[
                { label: 'huur', klasse: 's1', waarden: bouw.data.kwartalen.map((k) => k.huur) },
                { label: 'koop', klasse: 's2', waarden: bouw.data.kwartalen.map((k) => k.koop) },
              ]}
              getallen="alle"
            />
          ) : <Onbeschikbaar u={bouw} />
        } voet="Bouwvergunningen zijn de vroegste indicator: tussen vergunning en oplevering zit gemiddeld ruim twee jaar. Een kwartaal met één groot project geeft een piek." />

        <Kaart titel="Vergunde nieuwbouw per jaar en opdrachtgever" breed={6} sub="aantal woningen" kinderen={
          bouw.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead><tr><th>Jaar</th><th className="bd-getal">totaal</th><th className="bd-getal">huur</th><th className="bd-getal">koop</th><th className="bd-getal">overheid / corporatie</th><th className="bd-getal">markt</th><th className="bd-getal">particulier</th></tr></thead>
                <tbody>
                  {[...bouw.data.perJaar].reverse().map((j) => (
                    <tr key={j.jaar}>
                      <td>{j.jaar}{!j.volledig && <span className="bd-stil"> (deels)</span>}</td>
                      <td className="bd-getal"><strong>{nl(j.totaal)}</strong></td>
                      <td className="bd-getal">{nl(j.huur)} <span className="bd-stil">{j.totaal > 0 ? pct((j.huur / j.totaal) * 100) : ''}</span></td>
                      <td className="bd-getal">{nl(j.koop)}</td>
                      <td className="bd-getal">{nl(j.overheidCorporatie)}</td>
                      <td className="bd-getal">{nl(j.markt)}</td>
                      <td className="bd-getal bd-stil">{nl(j.particulier)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Onbeschikbaar u={bouw} />
        } voet="Huur omvat sociale én vrije sector; het CBS splitst dat niet. Opdrachtgever overheid of corporatie is de beste benadering van sociale nieuwbouw." />

        <Kaart titel="Eigendom van de woningvoorraad" breed={6} sub="1 januari, per jaar" kinderen={
          eigendom.ok ? (
            <>
              <Kolommen
                labels={eigendom.data.map((j) => String(j.jaar))}
                reeksen={[
                  { label: 'koop', klasse: 's2', waarden: eigendom.data.map((j) => j.koop) },
                  { label: 'corporatie', klasse: 's1', waarden: eigendom.data.map((j) => j.corporatie) },
                  { label: 'overige verhuur', klasse: 's3', waarden: eigendom.data.map((j) => j.particuliereVerhuur + j.bedrijven + j.overig) },
                ]}
                eenheid=" woningen"
                getallen="geen"
              />
              <div className="bd-tabel-wrap" style={{ marginTop: 12 }}>
                <table className="bd-tabel">
                  <thead><tr><th>Jaar</th><th className="bd-getal">koop</th><th className="bd-getal">corporatie</th><th className="bd-getal">particuliere verhuur</th><th className="bd-getal">bedrijven</th><th className="bd-getal">leeg</th><th className="bd-getal">corporatie % · NL</th></tr></thead>
                  <tbody>
                    {[...eigendom.data].reverse().map((j) => (
                      <tr key={j.jaar}>
                        <td>{j.jaar}</td>
                        <td className="bd-getal">{nl(j.koop)}</td>
                        <td className="bd-getal">{nl(j.corporatie)}</td>
                        <td className="bd-getal">{nl(j.particuliereVerhuur)}</td>
                        <td className="bd-getal">{nl(j.bedrijven)}</td>
                        <td className="bd-getal bd-stil">{nl(j.leegstand)}</td>
                        <td className="bd-getal">{pct((j.corporatie / j.totaal) * 100, 1)} <span className="bd-stil">· {pct(j.nlCorporatiePct, 1)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <Onbeschikbaar u={eigendom} />
        } voet="Particuliere verhuur is eigendom van natuurlijke personen; bedrijven zijn bv's en nv's (beleggers). Leeg is administratieve leegstand: geen ingeschreven bewoner op 1 januari." />

        <Kaart titel="Woningwaarde" breed={6} sub="gemiddelde WOZ-waarde, x 1.000 euro" kinderen={
          waarde.ok ? (
            <>
              <Lijn
                labels={waarde.data.map((w) => String(w.jaar))}
                reeksen={[
                  { label: 'koopwoningen', klasse: 's2', waarden: waarde.data.map((w) => w.wozKoop) },
                  { label: 'alle woningen Amersfoort', klasse: 's1', waarden: waarde.data.map((w) => w.wozTotaal) },
                  { label: 'alle woningen Nederland', klasse: 'rest', waarden: waarde.data.map((w) => w.wozNederland) },
                  { label: 'corporatiewoningen', klasse: 's3', waarden: waarde.data.map((w) => w.wozCorporatie) },
                ]}
                vanNul
              />
              <div className="bd-tabel-wrap" style={{ marginTop: 8 }}>
                <table className="bd-tabel">
                  <thead><tr><th>Jaar</th><th className="bd-getal">WOZ alle</th><th className="bd-getal">koop</th><th className="bd-getal">corporatie</th><th className="bd-getal">NL</th><th className="bd-getal">verkoopprijs</th></tr></thead>
                  <tbody>
                    {[...waarde.data].reverse().slice(0, 6).map((w) => (
                      <tr key={w.jaar}>
                        <td>{w.jaar}</td>
                        <td className="bd-getal">{w.wozTotaal === null ? '–' : `€ ${nl(w.wozTotaal)}k`}</td>
                        <td className="bd-getal">{w.wozKoop === null ? '–' : `€ ${nl(w.wozKoop)}k`}</td>
                        <td className="bd-getal">{w.wozCorporatie === null ? '–' : `€ ${nl(w.wozCorporatie)}k`}</td>
                        <td className="bd-getal bd-stil">{w.wozNederland === null ? '–' : `€ ${nl(w.wozNederland)}k`}</td>
                        <td className="bd-getal">{w.verkoopprijs === null ? '–' : `€ ${nl(w.verkoopprijs)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <Onbeschikbaar u={waarde} />
        } voet="WOZ-waarde per 1 januari met waardepeildatum een jaar eerder. Verkoopprijs is het gemiddelde van verkochte bestaande koopwoningen in het jaar (Kadaster/CBS)." />

        <Kaart titel="Huishoudens" breed={6} sub="1 januari" kinderen={
          huishoudens.ok ? (
            <>
              <Lijn
                labels={huishoudens.data.map((h) => String(h.jaar))}
                reeksen={[
                  { label: 'eenpersoons', klasse: 's1', waarden: huishoudens.data.map((h) => h.eenpersoons) },
                  { label: 'met kinderen', klasse: 's2', waarden: huishoudens.data.map((h) => h.metKinderen) },
                  { label: 'paren zonder kinderen', klasse: 's3', waarden: huishoudens.data.map((h) => h.zonderKinderen) },
                ]}
                vanNul
              />
              {laatsteHuish && (
                <p className="bd-kaart-tekst" style={{ marginTop: 8 }}>
                  In {laatsteHuish.jaar}: {nl(laatsteHuish.totaal)} huishoudens, waarvan {nl(laatsteHuish.ref65plus)} met een hoofdbewoner van 65 jaar of ouder ({pct((laatsteHuish.ref65plus / laatsteHuish.totaal) * 100)})
                  en {nl(laatsteHuish.ref75plus)} van 75 jaar of ouder ({pct((laatsteHuish.ref75plus / laatsteHuish.totaal) * 100)}).
                  Sinds {huishoudens.data[0].jaar}: {plusmin(laatsteHuish.totaal - huishoudens.data[0].totaal)} huishoudens, {plusmin(laatsteHuish.eenpersoons - huishoudens.data[0].eenpersoons)} eenpersoons.
                </p>
              )}
            </>
          ) : <Onbeschikbaar u={huishoudens} />
        } voet="De groei van het aantal huishoudens, niet van inwoners, bepaalt de woningbehoefte. Eenpersoonshuishoudens groeien het hardst." />

        <Kaart titel="Verhuizingen" breed={6} sub="personen per jaar" kinderen={
          verhuizingen.ok ? (
            <>
              <Lijn
                labels={verhuizingen.data.map((v) => String(v.jaar))}
                reeksen={[
                  { label: 'binnen Amersfoort verhuisd', klasse: 's1', waarden: verhuizingen.data.map((v) => v.binnen) },
                  { label: 'gevestigd van elders', klasse: 's3', waarden: verhuizingen.data.map((v) => v.gevestigd) },
                  { label: 'vertrokken naar elders', klasse: 's2', waarden: verhuizingen.data.map((v) => v.vertrokken) },
                ]}
                vanNul
              />
              <div className="bd-tabel-wrap" style={{ marginTop: 8 }}>
                <table className="bd-tabel">
                  <thead><tr><th>Jaar</th><th className="bd-getal">binnen</th><th className="bd-getal">gevestigd</th><th className="bd-getal">vertrokken</th><th className="bd-getal">saldo</th></tr></thead>
                  <tbody>
                    {[...verhuizingen.data].reverse().slice(0, 5).map((v) => (
                      <tr key={v.jaar}><td>{v.jaar}</td><td className="bd-getal">{nl(v.binnen)}</td><td className="bd-getal">{nl(v.gevestigd)}</td><td className="bd-getal">{nl(v.vertrokken)}</td><td className={`bd-getal ${v.saldo > 0 ? 'bd-plus' : v.saldo < 0 ? 'bd-min' : ''}`}>{plusmin(v.saldo)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <Onbeschikbaar u={verhuizingen} />
        } voet="Binnenlandse verhuizingen; buitenlandse migratie zit hier niet in. Het saldo laat zien of Amersfoort per saldo mensen aantrekt of verliest aan andere gemeenten." />

        <Kaart titel="Wijken: voorraad en eigendom" breed={12} sub={wijken.ok ? `woningkenmerken 1 januari ${wijken.data.woningjaar}, inwoners ${wijken.data.bevolkingsjaar}` : undefined} kinderen={
          wijken.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <thead><tr><th>Wijk</th><th className="bd-getal">inwoners</th><th className="bd-getal">woningen</th><th className="bd-getal">nieuwbouw {wijken.data.woningjaar}</th><th className="bd-getal">koop</th><th className="bd-getal">corporatie</th><th className="bd-getal">meergezins</th><th className="bd-getal">gebouwd &lt; 10 jr</th><th className="bd-getal">WOZ</th><th className="bd-getal">laagste 40% inkomen</th></tr></thead>
                <tbody>
                  {[...wijken.data.wijken].sort((a, b) => (b.woningen ?? 0) - (a.woningen ?? 0)).map((w) => (
                    <tr key={w.code}>
                      <td>{w.naam}</td>
                      <td className="bd-getal">{nl(w.inwoners)}</td>
                      <td className="bd-getal">{nl(w.woningen)}</td>
                      <td className="bd-getal">{nl(w.nieuwbouw)}</td>
                      <td className="bd-getal"><span className="bd-balkje bd-balkje-s2" style={{ width: (w.koopPct ?? 0) * 0.5 }} />{pct(w.koopPct)}</td>
                      <td className="bd-getal"><span className="bd-balkje" style={{ width: (w.corporatiePct ?? 0) * 0.5 }} />{pct(w.corporatiePct)}</td>
                      <td className="bd-getal">{pct(w.meergezinsPct)}</td>
                      <td className="bd-getal">{pct(w.bouwjaarRecentPct)}</td>
                      <td className="bd-getal">{w.wozDuizend === null ? '–' : `€ ${nl(w.wozDuizend)}k`}</td>
                      <td className="bd-getal">{pct(w.laagInkomenPct, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Onbeschikbaar u={wijken} />
        } voet="Wijken met minder dan 500 inwoners (bedrijventerreinen, bosgebied) zijn weggelaten. Woningkenmerken per wijk publiceert het CBS met vertraging; de inwonertallen zijn actueler." />
      </div>

      <section className="bd-verantwoording">
        <h3>Over deze cijfers</h3>
        <ul>
          <li><strong>Bron.</strong> CBS StatLine, open data, dagelijks opgehaald en hooguit 24 uur oud. Tabellen op dit tabblad:</li>
          {CBS_BRONNEN.filter((b) => BRONNEN_HIER.includes(b.tabel)).map((b) => (
            <li key={b.tabel}><a href={cbsUrl(b.tabel)} target="_blank" rel="noopener noreferrer">{b.tabel}</a> {b.titel}: {b.gebruik}.</li>
          ))}
          <li><strong>Voorlopig.</strong> Maandcijfers over nieuwbouw en sloop kunnen tot anderhalf jaar na dato worden bijgesteld; het CBS merkt ze als voorlopig.</li>
          <li><strong>Sociale huur.</strong> Het CBS onderscheidt corporatiebezit en huur/koop, geen huurprijsklassen. Voor sociale huur blijven de dPi-opgaven van corporaties (tabblad Corporaties) de bron.</li>
        </ul>
      </section>
    </main>
  )
}
