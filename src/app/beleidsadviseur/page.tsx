import { hasTurso } from '@/lib/turso'
import { formatDate, formatDateTime } from '@/lib/dashboard/format'
import {
  getVergunningenOverzicht, getDpiOverzicht, getWoonDossier, getRaadOverzicht,
  getSubsidieOverzicht, getCorporatieNieuws, SOORT_LABEL,
  type VergunningenOverzicht, type DpiOverzicht, type DossierOverzicht, type RaadOverzicht,
  type SubsidieOverzicht, type Bericht, type VergunningSoort,
} from '@/lib/dashboard/wonenQueries'
import { isQuotumBlokkade } from '@/lib/dashboard/tursoVerbruik'
import GeenDatabase from '../nieuwsplein33/GeenDatabase'
import { StapelKolommen, Staven, Tegel, maandLabel } from './Grafieken'

// De data verandert hooguit dagelijks en staat in unstable_cache; de pagina
// zelf is dynamisch omdat de layout de sessiecookie leest.
export const dynamic = 'force-dynamic'

type Uitkomst<T> = { ok: true; data: T } | { ok: false; geblokkeerd: boolean }

async function vang<T>(p: Promise<T>): Promise<Uitkomst<T>> {
  try {
    return { ok: true, data: await p }
  } catch (e) {
    console.error('[beleidsadviseur] databasefout:', e)
    return { ok: false, geblokkeerd: isQuotumBlokkade(e) }
  }
}

function euro(n: number): string {
  return n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function nl(n: number): string {
  return n.toLocaleString('nl-NL')
}

function Onbeschikbaar({ geblokkeerd }: { geblokkeerd: boolean }) {
  return (
    <p className="np-wo-onbeschikbaar">
      {geblokkeerd
        ? 'Dit onderdeel is tijdelijk niet beschikbaar: de database heeft haar maandelijkse leesquotum bereikt.'
        : 'Dit onderdeel kon niet worden geladen. Probeer het later opnieuw.'}
    </p>
  )
}

export default async function BeleidsadviseurPagina() {
  if (!hasTurso()) return <GeenDatabase />

  const [vergunningen, dpi, dossier, raad, subsidies, nieuws] = await Promise.all([
    vang(getVergunningenOverzicht()),
    vang(getDpiOverzicht()),
    vang(getWoonDossier()),
    vang(getRaadOverzicht()),
    vang(getSubsidieOverzicht()),
    vang(getCorporatieNieuws()),
  ])

  return (
    <main className="np-wo">
      <p className="np-hdr-sub np-wo-intro">
        Wat Stadsgeest in openbare bronnen vindt over wonen in Amersfoort: omgevingsvergunningen,
        plannen van woningcorporaties, raadsstukken, gemeentelijke regelingen en subsidies. Alles is
        herleidbaar naar de bron en wordt dagelijks bijgewerkt. Onder aan de pagina staat wat wel en niet
        is meegeteld.
      </p>

      <Kerncijfers vergunningen={vergunningen} dpi={dpi} raad={raad} dossier={dossier} />

      <section className="np-blok np-blok-verder" id="vergunningen">
        <h2 className="np-blok-kop">Omgevingsvergunningen Amersfoort</h2>
        {vergunningen.ok ? <VergunningenSectie v={vergunningen.data} /> : <Onbeschikbaar geblokkeerd={vergunningen.geblokkeerd} />}
      </section>

      <section className="np-blok np-blok-weten" id="corporaties">
        <h2 className="np-blok-kop">Woningcorporaties · prognose dPi</h2>
        {dpi.ok ? <DpiSectie d={dpi.data} /> : <Onbeschikbaar geblokkeerd={dpi.geblokkeerd} />}
      </section>

      <section className="np-blok np-blok-context" id="dossier">
        <h2 className="np-blok-kop">Dossier woningbouw en wonen</h2>
        {dossier.ok ? <DossierSectie d={dossier.data} /> : <Onbeschikbaar geblokkeerd={dossier.geblokkeerd} />}
      </section>

      <section className="np-blok np-blok-open" id="raad">
        <h2 className="np-blok-kop">Gemeenteraad en regelgeving</h2>
        {raad.ok ? <RaadSectie r={raad.data} /> : <Onbeschikbaar geblokkeerd={raad.geblokkeerd} />}
      </section>

      <section className="np-blok np-blok-eerder" id="subsidies">
        <h2 className="np-blok-kop">Subsidies en corporatienieuws</h2>
        {subsidies.ok ? <SubsidieSectie s={subsidies.data} /> : <Onbeschikbaar geblokkeerd={subsidies.geblokkeerd} />}
        {nieuws.ok ? <NieuwsSectie berichten={nieuws.data} /> : <Onbeschikbaar geblokkeerd={nieuws.geblokkeerd} />}
      </section>

      <Verantwoording vergunningen={vergunningen} dpi={dpi} />
    </main>
  )
}

// ── Kerncijfers ──────────────────────────────────────────────────────────────

function Kerncijfers({ vergunningen, dpi, raad, dossier }: {
  vergunningen: Uitkomst<VergunningenOverzicht>
  dpi: Uitkomst<DpiOverzicht>
  raad: Uitkomst<RaadOverzicht>
  dossier: Uitkomst<DossierOverzicht>
}) {
  const tegels: React.ReactNode[] = []
  if (vergunningen.ok) {
    const v = vergunningen.data
    tegels.push(
      <Tegel key="aanvraag" getal={v.laatste30.aanvraag} label="aanvragen ontvangen" toelichting="omgevingsvergunningen, afgelopen 30 dagen" />,
      <Tegel key="verleend" getal={v.laatste30.verleend} label="vergunningen verleend" toelichting="afgelopen 30 dagen" />,
      <Tegel key="geweigerd" getal={v.laatste30.geweigerd} label="geweigerd" toelichting="afgelopen 30 dagen" />,
      <Tegel key="toev" getal={v.perThema.find((t) => t.id === 'woningtoevoeging')?.totaal ?? 0} label="bekendmakingen over extra woningen" toelichting={`splitsen, transformeren, kamerverhuur · sinds ${formatDate(v.van)}`} />,
    )
  }
  if (dpi.ok && dpi.data.totaalPerJaar.length > 0) {
    const eerste = dpi.data.totaalPerJaar[0]
    const laatste = dpi.data.totaalPerJaar[dpi.data.totaalPerJaar.length - 1]
    const groei = (laatste.daeb + laatste.nietDaeb) - (eerste.daeb + eerste.nietDaeb)
    tegels.push(
      <Tegel key="dpi" getal={eerste.daeb + eerste.nietDaeb} label={`corporatiewoningen ${eerste.jaar}`} toelichting={`zelfstandige woonruimte volgens dPi ${dpi.data.dpiJaar}`} />,
      <Tegel key="dpi2" getal={`${groei >= 0 ? '+' : ''}${nl(groei)}`} label={`gepland tot ${laatste.jaar}`} toelichting="saldo van nieuwbouw, verkoop en sloop in de prognose" />,
    )
  }
  if (raad.ok) tegels.push(<Tegel key="raad" getal={raad.data.totaal} label="raadsstukken over wonen" toelichting="afgelopen 180 dagen" />)
  if (dossier.ok) tegels.push(<Tegel key="dos" getal={dossier.data.totaal} label="feiten in het woondossier" toelichting="officieel of bevestigd" />)
  if (tegels.length === 0) return null
  return <div className="np-wo-tegels">{tegels}</div>
}

// ── Vergunningen ─────────────────────────────────────────────────────────────

const SOORT_VOLGORDE: VergunningSoort[] = ['aanvraag', 'verleend', 'geweigerd', 'verlengd', 'ingetrokken', 'buiten_behandeling', 'vergunningvrij', 'overig']

function VergunningenSectie({ v }: { v: VergunningenOverzicht }) {
  const maanden = v.perMaand
  return (
    <>
      <p className="np-blok-tekst">
        {nl(v.totaal)} bekendmakingen van de gemeente Amersfoort sinds {formatDate(v.van)} (laatste: {formatDate(v.tot)}),
        uit het Gemeenteblad op officielebekendmakingen.nl. Het soort besluit is afgeleid van de kop van de bekendmaking.
        De laatste maand is nog niet vol.
      </p>

      <div className="np-wo-twee">
        <div>
          <h3 className="np-wo-kopje">Per maand</h3>
          <StapelKolommen
            labels={maanden.map((m) => maandLabel(m.maand))}
            reeksen={[
              { label: 'aanvraag ontvangen', klasse: 'a', waarden: maanden.map((m) => m.aanvraag) },
              { label: 'verleend', klasse: 'b', waarden: maanden.map((m) => m.verleend) },
              { label: 'overige besluiten', klasse: 'rest', waarden: maanden.map((m) => m.overig) },
            ]}
          />
        </div>
        <div>
          <h3 className="np-wo-kopje">Soort besluit, hele periode</h3>
          <div className="np-beheer-tabel-wrap">
          <table className="np-tabel np-wo-tabel">
            <tbody>
              {SOORT_VOLGORDE.filter((s) => v.perSoort[s] > 0).map((s) => (
                <tr key={s}>
                  <td>{SOORT_LABEL[s]}</td>
                  <td className="np-wo-getal">{nl(v.perSoort[s])}</td>
                  <td className="np-wo-getal np-wo-stil">{Math.round((v.perSoort[s] / Math.max(1, v.totaal)) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div className="np-wo-twee">
        <div>
          <h3 className="np-wo-kopje">Waar gaat het over</h3>
          <p className="np-wo-uitleg">
            Thema’s zijn herkend aan woorden in de kop; een bekendmaking kan in meer thema’s vallen en de thema’s
            tellen dus niet op tot het totaal. Beweeg over een staaf voor het aantal verleende vergunningen en aanvragen.
          </p>
          <Staven
            rijen={v.perThema.filter((t) => t.totaal > 0).map((t) => ({
              label: t.label,
              waarde: t.totaal,
              detail: `${t.label}: ${nl(t.totaal)} bekendmakingen, waarvan ${nl(t.verleend)} verleend en ${nl(t.aanvraag)} aanvragen`,
            }))}
          />
        </div>
        <div>
          <h3 className="np-wo-kopje">Per wijk</h3>
          <p className="np-wo-uitleg">
            Op basis van het adres in de bekendmaking, gekoppeld aan de BAG en de CBS-wijkindeling 2025.
            {' '}{Math.round(v.gekoppeldAandeel * 100)}% van de bekendmakingen heeft een eenduidig adres;
            de rest (bijvoorbeeld een kavel zonder huisnummer) ontbreekt hier.
          </p>
          <Staven
            rijen={v.perWijk.slice(0, 12).map((w) => ({
              label: w.wijk,
              waarde: w.totaal,
              detail: `${w.wijk}: ${nl(w.totaal)} bekendmakingen, waarvan ${nl(w.verleend)} verleend`,
            }))}
            klasse="b"
          />
        </div>
      </div>

      <h3 className="np-wo-kopje">Recente bekendmakingen over extra woningen</h3>
      <p className="np-wo-uitleg">
        Splitsingen, transformaties, kamerverhuur en appartementen in bestaande panden. Dit is de kleinschalige
        toevoeging aan de woningvoorraad die buiten de grote projecten valt.
      </p>
      <ul className="np-wo-lijst">
        {v.woningtoevoegingen.map((r) => (
          <li key={r.id}>
            <span className="np-wo-datum">{formatDate(r.datum)}</span>
            <span className="np-wo-inhoud">
              {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.titel}</a> : r.titel}
              <span className={`np-wo-soort np-wo-soort-${r.soort}`}>{SOORT_LABEL[r.soort]}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── Corporaties ──────────────────────────────────────────────────────────────

function DpiSectie({ d }: { d: DpiOverzicht }) {
  const eerste = d.jaren[0]
  const laatste = d.jaren[d.jaren.length - 1]
  return (
    <>
      <p className="np-blok-tekst">
        De prognose-informatie (dPi {d.dpiJaar}) die corporaties bij de Autoriteit woningcorporaties aanleveren,
        gefilterd op gemeente {d.gemeente}. Het zijn door de corporaties opgegeven verwachtingen voor {eerste} tot {laatste},
        geen gerealiseerde aantallen. DAEB is het sociale, gereguleerde deel van het bezit.
        {d.opgehaald && <> Bron opgehaald op {formatDateTime(d.opgehaald)}.</>}
      </p>

      <div className="np-wo-twee">
        <div>
          <h3 className="np-wo-kopje">Zelfstandige woonruimte, alle corporaties samen</h3>
          <StapelKolommen
            labels={d.totaalPerJaar.map((j) => String(j.jaar))}
            reeksen={[
              { label: 'DAEB (sociaal)', klasse: 'a', waarden: d.totaalPerJaar.map((j) => j.daeb) },
              { label: 'niet-DAEB', klasse: 'b', waarden: d.totaalPerJaar.map((j) => j.nietDaeb) },
            ]}
            eenheid=" woningen"
          />
        </div>
        <div>
          <h3 className="np-wo-kopje">Huurklassen in {eerste}</h3>
          <p className="np-wo-uitleg">Verdeling van de zelfstandige woonruimte over de dPi-huurklassen, alle corporaties samen.</p>
          <Staven
            rijen={d.corporaties[0]?.segmenten.map((_, i) => ({
              label: d.corporaties[0].segmenten[i].label,
              waarde: d.corporaties.reduce((s, c) => s + (c.segmenten[i]?.aantal ?? 0), 0),
            })) ?? []}
          />
        </div>
      </div>

      <h3 className="np-wo-kopje">Per corporatie, zelfstandige woonruimte per doeljaar</h3>
      <div className="np-beheer-tabel-wrap">
        <table className="np-tabel np-wo-tabel">
          <thead>
            <tr>
              <th>Corporatie</th>
              {d.jaren.map((j) => <th key={j} className="np-wo-getal">{j}</th>)}
              <th className="np-wo-getal">verschil</th>
              <th className="np-wo-getal">onzelfstandig {eerste}</th>
            </tr>
          </thead>
          <tbody>
            {d.corporaties.map((c) => {
              const eersteTotaal = (c.perJaar[0]?.daeb ?? 0) + (c.perJaar[0]?.nietDaeb ?? 0)
              const laatsteTotaal = (c.perJaar[c.perJaar.length - 1]?.daeb ?? 0) + (c.perJaar[c.perJaar.length - 1]?.nietDaeb ?? 0)
              const verschil = laatsteTotaal - eersteTotaal
              return (
                <tr key={c.kvk}>
                  <td title={`KVK ${c.kvk}`}>{c.naam}</td>
                  {d.jaren.map((j) => {
                    const r = c.perJaar.find((x) => x.jaar === j)
                    return <td key={j} className="np-wo-getal" title={r ? `DAEB ${nl(r.daeb)} · niet-DAEB ${nl(r.nietDaeb)}` : undefined}>{r ? nl(r.daeb + r.nietDaeb) : '–'}</td>
                  })}
                  <td className={`np-wo-getal ${verschil > 0 ? 'np-wo-plus' : verschil < 0 ? 'np-wo-min' : 'np-wo-stil'}`}>{verschil > 0 ? '+' : ''}{nl(verschil)}</td>
                  <td className="np-wo-getal np-wo-stil">{nl(c.onzelfstandig)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {d.verschuivingen.length > 0 && (
        <>
          <h3 className="np-wo-kopje">Bijgestelde plannen: dPi {d.dpiJaar - 1} tegenover dPi {d.dpiJaar}</h3>
          <p className="np-wo-uitleg">
            Voor hetzelfde doeljaar: wat een corporatie vorig jaar opgaf en wat zij nu opgeeft. Grootste verschillen eerst.
          </p>
          <div className="np-beheer-tabel-wrap">
            <table className="np-tabel np-wo-tabel">
              <thead><tr><th>Corporatie</th><th>Onderdeel</th><th className="np-wo-getal">doeljaar</th><th className="np-wo-getal">dPi {d.dpiJaar - 1}</th><th className="np-wo-getal">dPi {d.dpiJaar}</th><th className="np-wo-getal">verschil</th></tr></thead>
              <tbody>
                {d.verschuivingen.map((r, i) => {
                  const verschil = r.huidige - r.vorige
                  return (
                    <tr key={i}>
                      <td>{r.naam}</td>
                      <td className="np-cel-lang">{r.metric}</td>
                      <td className="np-wo-getal">{r.doeljaar}</td>
                      <td className="np-wo-getal np-wo-stil">{nl(r.vorige)}</td>
                      <td className="np-wo-getal">{nl(r.huidige)}</td>
                      <td className={`np-wo-getal ${verschil > 0 ? 'np-wo-plus' : 'np-wo-min'}`}>{verschil > 0 ? '+' : ''}{nl(verschil)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// ── Dossier ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  besluit: 'besluit', plan: 'plan', contract: 'overeenkomst', bedrag: 'bedrag', maatregel: 'maatregel',
  realisatie: 'realisatie', incident: 'incident', subsidie: 'subsidie', claim: 'claim', overig: 'overig',
}

function DossierSectie({ d }: { d: DossierOverzicht }) {
  const maanden = d.perMaand
  return (
    <>
      <p className="np-blok-tekst">
        Stadsgeest houdt een feitenregister bij over woningbouw en wonen in Amersfoort en Leusden: besluiten,
        plannen, overeenkomsten en bedragen uit raadsstukken, bekendmakingen, rechtspraak en berichten van
        corporaties. Hier staan alleen feiten die officieel zijn of door een tweede bron bevestigd.
      </p>
      <div className="np-wo-twee">
        <div>
          <h3 className="np-wo-kopje">Nieuwe feiten per maand</h3>
          {maanden.length > 0 ? (
            <StapelKolommen labels={maanden.map((m) => maandLabel(m.maand))} reeksen={[{ label: 'feiten', klasse: 'a', waarden: maanden.map((m) => m.n) }]} />
          ) : <p className="np-wo-uitleg">Nog geen feiten in de afgelopen twaalf maanden.</p>}
        </div>
        <div>
          <h3 className="np-wo-kopje">Soort feit</h3>
          <Staven rijen={d.perType.map((t) => ({ label: TYPE_LABEL[t.type] ?? t.type, waarde: t.n }))} klasse="b" />
        </div>
      </div>

      <h3 className="np-wo-kopje">Laatste feiten</h3>
      <ul className="np-wo-lijst">
        {d.feiten.map((f) => (
          <li key={f.id}>
            <span className="np-wo-datum">{f.datum ? formatDate(f.datum) : 'zonder datum'}</span>
            <span className="np-wo-inhoud">
              <strong>{f.titel}</strong>
              {f.details && <span className="np-wo-details">{f.details}</span>}
              <span className="np-wo-meta">
                {f.locatie && <span>{f.locatie}</span>}
                <span>{TYPE_LABEL[f.fact_type] ?? f.fact_type}</span>
                <span className={`np-zekerheid np-zekerheid-${f.zekerheid}`}>{f.zekerheid}</span>
                {f.dossier_slug !== 'woningbouw-wonen' && <span>dossier {f.dossier}</span>}
                {f.primaire_bron_url && <a href={f.primaire_bron_url} target="_blank" rel="noopener noreferrer">bron</a>}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {d.aanpalend.length > 0 && (
        <>
          <h3 className="np-wo-kopje">Aanpalende dossiers</h3>
          <ul className="np-wo-chips">
            {d.aanpalend.map((a) => (
              <li key={a.slug} title={a.omschrijving ?? undefined}>
                <strong>{a.naam}</strong> · {nl(a.feiten)} feiten{a.laatste && <>, laatste {formatDate(a.laatste)}</>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// ── Raad ─────────────────────────────────────────────────────────────────────

function RaadSectie({ r }: { r: RaadOverzicht }) {
  return (
    <>
      <p className="np-blok-tekst">
        Raadsstukken van de gemeente Amersfoort uit de afgelopen 180 dagen waarvan de titel over wonen gaat:
        schriftelijke vragen, moties, amendementen, raadsinformatiebrieven en ingekomen stukken. Daaronder de
        verordeningen en beleidsregels over wonen uit het Gemeenteblad.
        {r.totaal > r.stukken.length && <> De lijst toont de {r.stukken.length} meest recente van {nl(r.totaal)}.</>}
      </p>
      {r.perBron.length > 0 && (
        <p className="np-wo-uitleg">
          {r.perBron.map((b) => `${b.bron.toLowerCase()} ${nl(b.n)}`).join(' · ')}
        </p>
      )}
      <ul className="np-wo-lijst">
        {r.stukken.map((s) => (
          <li key={s.id}>
            <span className="np-wo-datum">{formatDate(s.datum)}</span>
            <span className="np-wo-inhoud">
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.titel}</a> : s.titel}
              <span className="np-wo-meta"><span>{s.bron.replace('Raad Amersfoort — ', '')}</span></span>
            </span>
          </li>
        ))}
        {r.stukken.length === 0 && <li><span className="np-wo-inhoud">Geen raadsstukken over wonen in deze periode.</span></li>}
      </ul>

      <h3 className="np-wo-kopje">Verordeningen, beleidsregels en besluiten</h3>
      <ul className="np-wo-lijst">
        {r.regels.map((s) => (
          <li key={s.id}>
            <span className="np-wo-datum">{formatDate(s.datum)}</span>
            <span className="np-wo-inhoud">
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.titel}</a> : s.titel}
              <span className="np-wo-meta"><span>{s.bron.replace('Officiële Bekendmakingen — ', '')}</span></span>
            </span>
          </li>
        ))}
        {r.regels.length === 0 && <li><span className="np-wo-inhoud">Geen regelingen over wonen gevonden.</span></li>}
      </ul>
    </>
  )
}

// ── Subsidies en nieuws ──────────────────────────────────────────────────────

function SubsidieSectie({ s }: { s: SubsidieOverzicht }) {
  return (
    <>
      <p className="np-blok-tekst">
        Uit het openbare subsidieregister van de gemeente Amersfoort: regelingen die direct over wonen gaan,
        per jaar. Bedragen zijn verleende subsidies zoals geregistreerd, geen uitgaven.
      </p>
      <div className="np-beheer-tabel-wrap">
        <table className="np-tabel np-wo-tabel">
          <thead><tr><th>Regeling</th><th>Ontvanger</th><th className="np-wo-getal">jaar</th><th className="np-wo-getal">aantal</th><th className="np-wo-getal">bedrag</th></tr></thead>
          <tbody>
            {s.regelingen.map((r, i) => (
              <tr key={i}>
                <td className="np-cel-lang">{r.regeling}</td>
                <td>{r.ontvanger ?? '–'}</td>
                <td className="np-wo-getal">{r.jaar}</td>
                <td className="np-wo-getal">{nl(r.aantal)}</td>
                <td className="np-wo-getal">{euro(r.totaal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function NieuwsSectie({ berichten }: { berichten: Bericht[] }) {
  if (berichten.length === 0) return null
  return (
    <>
      <h3 className="np-wo-kopje">Berichten van De Alliantie over Amersfoort</h3>
      <p className="np-wo-uitleg">Eigen berichten van de corporatie; de datum is het moment waarop Stadsgeest het bericht zag.</p>
      <ul className="np-wo-lijst">
        {berichten.map((b) => (
          <li key={b.id}>
            <span className="np-wo-datum">{formatDate(b.datum)}</span>
            <span className="np-wo-inhoud">{b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer">{b.titel}</a> : b.titel}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── Verantwoording ───────────────────────────────────────────────────────────

function Verantwoording({ vergunningen, dpi }: { vergunningen: Uitkomst<VergunningenOverzicht>; dpi: Uitkomst<DpiOverzicht> }) {
  return (
    <section className="np-wo-verantwoording">
      <h2 className="np-wo-kopje">Over deze cijfers</h2>
      <ul>
        <li>
          <strong>Bronnen.</strong> Gemeenteblad Amersfoort via officielebekendmakingen.nl (omgevingsvergunningen, verordeningen,
          beleidsregels), raadsinformatie Amersfoort (Notubiz), dPi-opgaven via data.overheid.nl, het gemeentelijke
          subsidieregister, de BAG (PDOK) en de CBS-wijkindeling, en nieuwsberichten van De Alliantie.
        </li>
        <li>
          <strong>Periode.</strong> Omgevingsvergunningen worden gevolgd sinds {vergunningen.ok ? formatDate(vergunningen.data.van) : 'juni 2026'};
          eerdere jaren zitten er niet in. Vergelijkingen met vorig jaar zijn daarom nog niet mogelijk.
        </li>
        <li>
          <strong>Herkenning.</strong> Soort besluit en thema zijn afgeleid van de kop van de bekendmaking, niet van het
          besluit zelf. Een enkele bekendmaking kan verkeerd zijn ingedeeld; de koppeling naar de bron staat erbij.
        </li>
        <li>
          <strong>Prognoses.</strong> dPi-cijfers zijn door corporaties aangeleverde verwachtingen
          {dpi.ok && dpi.data.opgehaald ? ` (dPi ${dpi.data.dpiJaar}, opgehaald ${formatDate(dpi.data.opgehaald)})` : ''}, geen gerealiseerde aantallen.
          Corporatienamen zijn op KVK-nummer opgezocht in het Handelsregister.
        </li>
        <li>
          <strong>Nog leeg.</strong> Energielabels (EP-online), uitspraken van de Huurcommissie en actuele CBS-kerncijfers
          over de woningvoorraad worden wel gevolgd, maar hebben nog geen bruikbare gegevens opgeleverd en staan daarom niet op deze pagina.
        </li>
        <li>
          <strong>Actualiteit.</strong> De bronnen worden dagelijks opgehaald; deze pagina ververst haar cijfers hooguit elke zes uur.
        </li>
      </ul>
    </section>
  )
}
