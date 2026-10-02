import { hasTurso } from '@/lib/turso'
import { formatDate } from '@/lib/dashboard/format'
import { getVergunningenOverzicht, getVergunningenLijst, SOORT_LABEL, THEMAS, type VergunningSoort } from '@/lib/dashboard/wonenQueries'
import { leesFilter, pasFilterToe, filterNaarQuery, type ZoekParams } from '@/lib/dashboard/vergunningenFilter'
import GeenDatabase from '../../nieuwsplein33/GeenDatabase'
import { Extern, Kaart, Kolommen, Onbeschikbaar, Staven, Tegel, maandLabel, nl, vang } from '../Onderdelen'

export const dynamic = 'force-dynamic'

const SOORT_VOLGORDE: VergunningSoort[] = ['aanvraag', 'verleend', 'geweigerd', 'verlengd', 'ingetrokken', 'buiten_behandeling', 'vergunningvrij', 'overig']
const PERIODES = [['30', 'afgelopen 30 dagen'], ['90', 'afgelopen 90 dagen'], ['180', 'afgelopen 180 dagen'], ['alles', 'hele periode']] as const

export default async function VergunningenPagina({ searchParams }: { searchParams: Promise<ZoekParams> }) {
  if (!hasTurso()) return <GeenDatabase />
  const filter = leesFilter(await searchParams)
  const [overzicht, lijst] = await Promise.all([
    vang(getVergunningenOverzicht(), 'vergunningen'),
    vang(getVergunningenLijst(), 'vergunningenlijst'),
  ])
  const gefilterd = lijst.ok ? pasFilterToe(lijst.data.items, filter) : []
  const themaLabel = new Map<string, string>(THEMAS.map((t) => [t.id, t.label]))
  const actieveFilters = [filter.soort, filter.thema, filter.wijk, filter.zoek].filter(Boolean).length + (filter.periode !== '90' ? 1 : 0)

  return (
    <main>
      <div className="bd-intro">
        <div>
          <h2>Omgevingsvergunningen</h2>
          <p>
            Alle bekendmakingen van de gemeente Amersfoort over omgevingsvergunningen uit het Gemeenteblad, gevolgd sinds
            {' '}{overzicht.ok ? formatDate(overzicht.data.van) : 'juni 2026'}. Soort besluit, thema, adres en aantal woningen zijn uit de kop afgeleid.
          </p>
        </div>
        <div className="bd-intro-acties">
          <a className="bd-knop" href={`/beleidsadviseur/export${filterNaarQuery(filter, { set: 'vergunningen' })}`}>Download selectie (CSV)</a>
          <a className="bd-knop" href="/beleidsadviseur/export?set=lopend">Lopende aanvragen (CSV)</a>
        </div>
      </div>

      {lijst.ok && (
        <div className="bd-tegels">
          <Tegel getal={lijst.data.lopend.length} label="lopende aanvragen" toelichting="ontvangen aanvragen zonder gepubliceerd besluit of verlenging op hetzelfde adres" />
          <Tegel getal={lijst.data.lopend.filter((a) => a.dagenTotTermijn < 0).length} label="over de beslistermijn" toelichting="acht weken na ontvangst, zonder verlenging" />
          <Tegel getal={lijst.data.lopend.filter((a) => a.dagenTotTermijn >= 0 && a.dagenTotTermijn <= 14).length} label="termijn verstrijkt binnen 14 dagen" toelichting="lopende aanvragen" />
          <Tegel getal={lijst.data.projecten.length} label="plannen van 5+ woningen" toelichting="bekendmakingen waarvan de kop een aantal woningen noemt" />
          <Tegel getal={lijst.data.afgehandeld} label="aanvragen met besluit" toelichting="later besluit of verlenging op hetzelfde adres gevonden" />
        </div>
      )}

      <div className="bd-raster">
        <Kaart titel="Lopende aanvragen op volgorde van termijn" breed={12} sub="indicatief: koppeling op adres in de kop" kinderen={
          lijst.ok ? (
            lijst.data.lopend.length === 0 ? <p className="bd-leeg">Geen lopende aanvragen gevonden.</p> : (
              <div className="bd-tabel-wrap">
                <table className="bd-tabel">
                  <thead><tr><th>Ontvangen</th><th className="bd-getal">dagen open</th><th>Termijn</th><th>Aanvraag</th><th>Wijk</th><th className="bd-getal">woningen</th></tr></thead>
                  <tbody>
                    {lijst.data.lopend.slice(0, 25).map((a) => (
                      <tr key={a.id} className={a.dagenTotTermijn < 0 ? 'bd-markeer' : undefined}>
                        <td className="bd-stil">{formatDate(a.datum)}</td>
                        <td className="bd-getal">{a.dagenOpen}</td>
                        <td>{a.dagenTotTermijn < 0 ? <span className="bd-badge bd-badge-geweigerd" style={{ marginLeft: 0 }}>{-a.dagenTotTermijn} dagen verstreken</span> : a.dagenTotTermijn <= 14 ? <span className="bd-badge bd-badge-let" style={{ marginLeft: 0 }}>nog {a.dagenTotTermijn} dagen</span> : <span className="bd-stil">nog {a.dagenTotTermijn} dagen</span>}</td>
                        <td className="bd-cel-lang"><Extern href={a.url}>{a.titel.replace(/^(Ontvangen aanvraag|Kennisgeving ontvangen aanvraag) omgevingsvergunning\s*(voor het|voor|-)?\s*/i, '')}</Extern></td>
                        <td className="bd-stil">{a.wijk ?? '–'}</td>
                        <td className="bd-getal">{a.woningen ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : <Onbeschikbaar u={lijst} />
        } voet={<>De reguliere procedure onder de Omgevingswet kent een beslistermijn van acht weken, eenmaal te verlengen met zes weken. Een aanvraag telt hier als lopend zolang op hetzelfde adres geen besluit, verlenging, intrekking of buitenbehandelingstelling is gepubliceerd. Aanvragen zonder herkenbaar adres (kavels, verzoeklocaties) blijven staan als lopend; de volledige lijst staat in de CSV.{lijst.ok && lijst.data.lopend.length > 25 && <> Getoond: 25 van {nl(lijst.data.lopend.length)}.</>}</>} />

        <Kaart titel="Plannen van vijf of meer woningen" breed={12} sub="aantal uit de kop van de bekendmaking" kinderen={
          lijst.ok ? (
            lijst.data.projecten.length === 0 ? <p className="bd-leeg">Geen bekendmakingen met een aantal woningen in de kop.</p> : (
              <ul className="bd-lijst">
                {lijst.data.projecten.map((p) => (
                  <li key={p.id}>
                    <span className="bd-datum">{formatDate(p.datum)}</span>
                    <span className="bd-inhoud">
                      <Extern href={p.url}>{p.titel}</Extern>
                      <span className={`bd-badge bd-badge-${p.soort}`}>{SOORT_LABEL[p.soort]}</span>
                      <span className="bd-badge">{p.woningen} woningen</span>
                      {p.wijk && <span className="bd-meta"><span>{p.wijk}</span></span>}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : <Onbeschikbaar u={lijst} />
        } />

        <Kaart titel="Per maand" breed={6} sub="soort besluit" kinderen={
          overzicht.ok ? (
            <Kolommen
              labels={overzicht.data.perMaand.map((m) => maandLabel(m.maand))}
              reeksen={[
                { label: 'aanvraag ontvangen', klasse: 's1', waarden: overzicht.data.perMaand.map((m) => m.aanvraag) },
                { label: 'verleend', klasse: 's2', waarden: overzicht.data.perMaand.map((m) => m.verleend) },
                { label: 'overige besluiten', klasse: 'rest', waarden: overzicht.data.perMaand.map((m) => m.overig) },
              ]}
            />
          ) : <Onbeschikbaar u={overzicht} />
        } voet="De laatste maand is nog niet vol." />

        <Kaart titel="Per wijk" breed={6} sub="hele periode, via BAG en CBS-wijkindeling" kinderen={
          overzicht.ok ? (
            <Staven rijen={overzicht.data.perWijk.slice(0, 12).map((w) => ({
              label: w.wijk, waarde: w.totaal, href: `/beleidsadviseur/vergunningen${filterNaarQuery({ ...filter, wijk: w.code })}`,
              detail: `${w.wijk}: ${nl(w.totaal)} bekendmakingen, waarvan ${nl(w.verleend)} verleend`,
              segmenten: [{ waarde: w.verleend, klasse: 's2' }, { waarde: w.totaal - w.verleend, klasse: 's1' }],
            }))} klasse="s1" />
          ) : <Onbeschikbaar u={overzicht} />
        } voet={<>{overzicht.ok && <>{Math.round(overzicht.data.gekoppeldAandeel * 100)}% van de bekendmakingen heeft een eenduidig adres. </>}Oranje is verleend, blauw de rest. Klik op een wijk om de lijst hieronder te filteren.</>} />

        <Kaart titel="Waar gaat het over" breed={6} sub="thema's uit de kop, overlappend" kinderen={
          overzicht.ok ? (
            <Staven rijen={overzicht.data.perThema.filter((t) => t.totaal > 0).map((t) => ({
              label: t.label, waarde: t.totaal, href: `/beleidsadviseur/vergunningen${filterNaarQuery({ ...filter, thema: t.id })}`,
              detail: `${t.label}: ${nl(t.totaal)} bekendmakingen, ${nl(t.verleend)} verleend, ${nl(t.aanvraag)} aanvragen`,
            }))} klasse="s3" />
          ) : <Onbeschikbaar u={overzicht} />
        } voet="Een bekendmaking kan in meer thema's vallen; de thema's tellen niet op tot het totaal." />

        <Kaart titel="Soort besluit" breed={6} sub="hele periode" kinderen={
          overzicht.ok ? (
            <div className="bd-tabel-wrap">
              <table className="bd-tabel">
                <tbody>
                  {SOORT_VOLGORDE.filter((s) => overzicht.data.perSoort[s] > 0).map((s) => (
                    <tr key={s}>
                      <td><a href={`/beleidsadviseur/vergunningen${filterNaarQuery({ ...filter, soort: s })}`}>{SOORT_LABEL[s]}</a></td>
                      <td className="bd-getal">{nl(overzicht.data.perSoort[s])}</td>
                      <td className="bd-getal bd-stil">{Math.round((overzicht.data.perSoort[s] / Math.max(1, overzicht.data.totaal)) * 100)}%</td>
                      <td className="bd-getal bd-stil" title="afgelopen 30 dagen">{nl(overzicht.data.laatste30[s])} <span className="bd-stil">30 d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Onbeschikbaar u={overzicht} />
        } />

        <Kaart titel="Bekendmakingen" breed={12} sub={lijst.ok ? `${nl(gefilterd.length)} van ${nl(lijst.data.items.length)}` : undefined} kinderen={
          <>
            <form method="get" className="bd-filters">
              <label>Soort
                <select name="soort" defaultValue={filter.soort}>
                  <option value="">alle soorten</option>
                  {SOORT_VOLGORDE.map((s) => <option key={s} value={s}>{SOORT_LABEL[s]}</option>)}
                </select>
              </label>
              <label>Thema
                <select name="thema" defaultValue={filter.thema}>
                  <option value="">alle thema’s</option>
                  {THEMAS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <label>Wijk
                <select name="wijk" defaultValue={filter.wijk}>
                  <option value="">alle wijken</option>
                  {lijst.ok && lijst.data.wijken.map((w) => <option key={w.code} value={w.code}>{w.naam}</option>)}
                </select>
              </label>
              <label>Periode
                <select name="periode" defaultValue={filter.periode}>
                  {PERIODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Zoek in kop
                <input type="search" name="zoek" defaultValue={filter.zoek} placeholder="straat, activiteit…" />
              </label>
              <button type="submit" className="bd-knop bd-knop-accent">Toon</button>
              {actieveFilters > 0 && <a className="bd-knop" href="/beleidsadviseur/vergunningen">Wis filters</a>}
            </form>
            {lijst.ok ? (
              gefilterd.length === 0 ? <p className="bd-leeg">Geen bekendmakingen binnen deze selectie.</p> : (
                <ul className="bd-lijst">
                  {gefilterd.slice(0, 150).map((it) => (
                    <li key={it.id}>
                      <span className="bd-datum">{formatDate(it.datum)}</span>
                      <span className="bd-inhoud">
                        <Extern href={it.url}>{it.titel}</Extern>
                        <span className={`bd-badge bd-badge-${it.soort}`}>{SOORT_LABEL[it.soort]}</span>
                        {(it.wijk || it.themas.length > 0 || it.woningen) && (
                          <span className="bd-meta">
                            {it.wijk && <span>{it.wijk}</span>}
                            {it.themas.map((t) => <span key={t}>{themaLabel.get(t)}</span>)}
                            {it.woningen && <span>{it.woningen} woningen</span>}
                            {it.zorg && <span>wonen en zorg</span>}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : <Onbeschikbaar u={lijst} />}
            {gefilterd.length > 150 && <p className="bd-kaart-voet">Getoond: 150 van {nl(gefilterd.length)}. De CSV bevat de hele selectie.</p>}
          </>
        } />
      </div>

      <section className="bd-verantwoording">
        <h3>Over deze cijfers</h3>
        <ul>
          <li><strong>Bron.</strong> Gemeenteblad Amersfoort via officielebekendmakingen.nl; dagelijks opgehaald, hier hooguit zes uur oud.</li>
          <li><strong>Herkenning.</strong> Soort besluit, thema, adres en aantal woningen zijn met vaste patronen uit de kop afgeleid, niet uit het besluit zelf. Controleer bij twijfel de bron; de koppeling staat erbij.</li>
          <li><strong>Wijk.</strong> Via het adres in de kop, de BAG (PDOK) en de CBS-wijkindeling 2025. Adressen zonder huisnummer ontbreken.</li>
          <li><strong>Termijnen.</strong> Berekend vanaf de publicatiedatum van de ontvangen aanvraag. Besluiten die de gemeente nog niet heeft gepubliceerd, zijn hier onbekend.</li>
        </ul>
      </section>
    </main>
  )
}
