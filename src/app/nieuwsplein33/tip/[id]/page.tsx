import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import {
  getTipDetail, getTipDocumenten, getTipFeedback, getDossierTijdlijn,
  getWachtrijIds,
  type TipDocument,
} from '@/lib/dashboard/tipQueries'
import { formatDate, formatDateTime, safeParseJson, safeParseJsonArray } from '@/lib/dashboard/format'
import { parseBriefing, ontstreep, type GeparsedeBriefing } from '@/lib/dashboard/briefing'
import GeenDatabase from '../../GeenDatabase'
import { SOORT_LABEL, isSupertip, zonderSupertip } from '../../TipRegel'
import TipTabs, { type Tab } from './TipTabs'
import TipActies from './TipActies'
import Meetknop from './Meetknop'
import BeslisNavigatie from './BeslisNavigatie'
import { Blok, BronChip, Betrokkenen } from './TipBlokken'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

const STATUS_LABEL: Record<string, string> = {
  wachtrij: 'In de wachtrij',
  goedgekeurd: 'Goedgekeurd',
  in_behandeling: 'In behandeling',
  gepubliceerd: 'Gepubliceerd',
  niet_gebruikt: 'Niets mee gedaan',
  geparkeerd: 'Geparkeerd',
  afgekeurd: 'Afgewezen',
}

const TIER_UITLEG: Record<number, string> = {
  1: 'Officiële publicatiebron: bekendmaking, register, uitspraak, aanbesteding',
  2: 'Bevestigende bron: gemeente, veiligheidsregio, corporatie, instelling',
  3: 'Signaalbron: meldingen, buurtplatforms, sociale media',
}

const ROL_LABEL: Record<string, string> = {
  dragend: 'Dragend',
  bevestigend: 'Bevestigend',
  context: 'Context',
}

interface HerkomstBron { naam?: string; tier?: number; url?: string; datum?: string; bijdrage?: string }
interface EldersItem { medium?: string; url?: string; datum?: string }

/** Datum voor weergave, of null als er niets bruikbaars in zit. */
function datum(d: string | null | undefined): string | null {
  if (!d) return null
  const f = formatDate(d)
  return f === '–' ? null : f
}

function Alinea({ tekst }: { tekst: string }) {
  return (
    <>
      {tekst.split(/\n{2,}/).map((blok, i) => (
        <p key={i} className="np-tekst">
          {blok.split('\n').map((regel, j) => (
            <span key={j}>{regel}{j < blok.split('\n').length - 1 && <br />}</span>
          ))}
        </p>
      ))}
    </>
  )
}

interface EerderBericht {
  medium: string
  titel: string | null
  datum: string | null
  url: string | null
}

/** Het verhaal: de briefing in leesbare blokken. */
function Verhaal({ briefing, eerder, eldersTekst, toegevoegdeWaarde, context, vragen }: {
  briefing: GeparsedeBriefing
  eerder: EerderBericht[]
  eldersTekst: string | null
  toegevoegdeWaarde: string | null
  context: string | null
  vragen: string[]
}) {
  const heeftEerder = eerder.length > 0 || Boolean(eldersTekst && !/^nee\.?$/i.test(eldersTekst))

  return (
    <>
      <Blok soort="weten" titel="Wat we weten" id="weten">
        <ol className="np-blok-lijst np-feitlijst">
          {briefing.weten.map((f, i) => (
            <li key={i}>
              <span className="np-feitnr">{i + 1}</span>
              <div className="np-feit">
                <p>{ontstreep(f.tekst)}</p>
                {(f.bron || f.url) && (
                  <div className="np-chips np-feit-bronnen">
                    {f.urls.length > 0
                      ? f.urls.map((u, j) => <BronChip key={j} label={j === 0 ? f.bron : null} url={u} />)
                      : <BronChip label={f.bron} url={null} />}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Blok>

      {briefing.nietWeten.length > 0 && (
        <Blok soort="open" titel="Wat we niet weten" id="open">
          <ul className="np-blok-lijst np-puntlijst">
            {briefing.nietWeten.map((r, i) => <li key={i}>{ontstreep(r)}</li>)}
          </ul>
        </Blok>
      )}

      {context && (
        <Blok soort="context" titel="Context en achtergrond" id="context">
          <p className="np-blok-tekst">{ontstreep(context)}</p>
        </Blok>
      )}

      {vragen.length > 0 && (
        <Blok soort="verder" titel="Zo kom je verder" id="verder">
          <ul className="np-blok-lijst np-puntlijst">
            {vragen.map((v, i) => <li key={i}>{ontstreep(v)}</li>)}
          </ul>
        </Blok>
      )}

      {heeftEerder && (
        <Blok soort="eerder" titel="Eerdere berichtgeving" id="eerder">
          {eerder.length > 0 && (
            <ul className="np-blok-lijst">
              {eerder.map((e, i) => (
                <li key={i} className="np-eerder">
                  <div className="np-eerder-kop">
                    <strong>{e.medium}</strong>
                    {datum(e.datum) && <span className="np-stil">{datum(e.datum)}</span>}
                  </div>
                  {e.titel && <p className="np-blok-tekst">{ontstreep(e.titel)}</p>}
                  {e.url && <div className="np-chips"><BronChip label="Lees het artikel" url={e.url} /></div>}
                </li>
              ))}
            </ul>
          )}
          {eerder.length === 0 && eldersTekst && <p className="np-blok-tekst">{ontstreep(eldersTekst)}</p>}
          {toegevoegdeWaarde && (
            <div className="np-nieuw">
              <span className="np-nieuw-label">Wat hier nieuw aan is</span>
              <p className="np-blok-tekst">{ontstreep(toegevoegdeWaarde)}</p>
            </div>
          )}
        </Blok>
      )}

      {briefing.nietInMag.length > 0 && (
        <Blok soort="letop" titel="Let op" id="letop">
          <ul className="np-blok-lijst np-puntlijst">
            {briefing.nietInMag.map((r, i) => <li key={i}>{ontstreep(r)}</li>)}
          </ul>
        </Blok>
      )}

      {briefing.betrokkenen.length > 0 && (
        <Blok soort="wie" titel="Wie hierin voorkomen" id="wie">
          <Betrokkenen lijst={briefing.betrokkenen} />
        </Blok>
      )}
    </>
  )
}

/** Bronnen-tabblad: documenten gegroepeerd per signaal, met de rol van dat signaal. */
function Bronnen({ documenten }: { documenten: TipDocument[] }) {
  if (documenten.length === 0) {
    return <p className="np-tekst np-stil">Geen onderliggende documenten gevonden.</p>
  }

  const groepen: { signalId: number; titel: string | null; rol: string; docs: TipDocument[] }[] = []
  for (const d of documenten) {
    const laatste = groepen[groepen.length - 1]
    if (laatste && laatste.signalId === d.signal_id) laatste.docs.push(d)
    else groepen.push({ signalId: d.signal_id, titel: d.signaal_titel, rol: d.rol, docs: [d] })
  }

  return (
    <>
      <p className="np-tekst np-stil">
        Een tip is opgebouwd uit een of meer sporen die Stadsgeest heeft gebundeld. Per spoor
        staat hieronder wat de rol ervan is en welke documenten erin zitten.
      </p>
      {groepen.map((g) => (
        <section key={g.signalId} className="np-doc-groep">
          <div className="np-doc-groep-kop">
            <span className={`np-rol np-rol-${g.rol}`}>{ROL_LABEL[g.rol] ?? g.rol}</span>
            <span className="np-doc-groep-titel">{g.titel ? ontstreep(g.titel, ' · ') : `spoor ${g.signalId}`}</span>
            <span className="np-doc-groep-tel">{g.docs.length} {g.docs.length === 1 ? 'document' : 'documenten'}</span>
          </div>
          <ol className="np-doclijst">
            {g.docs.map((d, i) => (
              <li key={i} className="np-doc">
                <div className="np-doc-kop">
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer">{ontstreep(d.titel ?? '', ' · ')}</a> : <span>{ontstreep(d.titel ?? '', ' · ')}</span>}
                </div>
                <div className="np-doc-meta">
                  <span className="np-bron">{ontstreep(d.bron ?? '', ' · ')}</span>
                  {d.tier && <span className={`np-tier np-tier-${d.tier}`} title={TIER_UITLEG[d.tier]}>tier {d.tier}</span>}
                  {d.bronrol === 'spiegel' && <span className="np-bron np-bron-spiegel">samenwerkingspartner</span>}
                  <span className="np-regel-scheiding">·</span>
                  <span>
                    {d.gepubliceerd
                      ? `gepubliceerd ${formatDate(d.gepubliceerd)}`
                      : `binnengekomen ${formatDate(d.gescrapet)}`}
                  </span>
                </div>
                {d.fragment && <p className="np-doc-fragment">{ontstreep(d.fragment, ' · ')}…</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  )
}

export default async function TipPagina({ params }: Props) {
  if (!hasTurso()) return <GeenDatabase />

  const { id: idParam } = await params
  const id = parseInt(idParam, 10)
  if (Number.isNaN(id)) notFound()

  const tip = await getTipDetail(id)
  if (!tip) notFound()

  const [documenten, feedback, tijdlijn, wachtrijIds] = await Promise.all([
    getTipDocumenten(id),
    getTipFeedback(id),
    tip.dossier_id ? getDossierTijdlijn(tip.dossier_id) : Promise.resolve([]),
    getWachtrijIds(),
  ])

  const superTip = Boolean(tip.supertip) || isSupertip(tip.titel)
  const vragen = safeParseJsonArray<string>(tip.vervolgvragen) ?? []
  const wegingRaw = safeParseJson<Record<string, number | { punten: number; bron?: string }>>(tip.weging)
  const weging = wegingRaw
    ? Object.fromEntries(
        Object.entries(wegingRaw).map(([k, v]) => [k, typeof v === 'object' && v !== null ? (v as { punten: number }).punten : v as number])
      )
    : null
  const herkomst = safeParseJsonArray<HerkomstBron>(tip.herkomst) ?? []
  const elders = safeParseJsonArray<EldersItem>(tip.elders_gebracht) ?? []
  const briefing = tip.briefing ? parseBriefing(tip.briefing) : null

  const eerder: EerderBericht[] = elders.map((e) => ({
    medium: e.medium ?? 'onbekend medium',
    titel: null,
    datum: e.datum ?? null,
    url: e.url ?? null,
  }))
  const bekendeUrls = new Set(eerder.map((e) => e.url).filter(Boolean))
  for (const d of documenten) {
    if (d.bronrol !== 'spiegel') continue
    if (d.url && bekendeUrls.has(d.url)) continue
    if (d.url) bekendeUrls.add(d.url)
    eerder.push({
      medium: ontstreep(d.bron ?? '', ' · '),
      titel: d.titel,
      datum: d.gepubliceerd ?? d.gescrapet,
      url: d.url,
    })
  }

  // Tier badge: hoogste tier van de dragende bronnen
  const dragendeBronnen = tip.bronnen.filter((b) => !b.spiegel)
  const tier = dragendeBronnen.reduce<number | null>(
    (min, b) => b.tier !== null ? (min === null ? b.tier : Math.min(min, b.tier)) : min,
    null,
  )

  const tabs: Tab[] = [
    {
      id: 'verhaal',
      label: 'Het verhaal',
      inhoud: briefing?.volledig ? (
        <Verhaal
          briefing={briefing}
          eerder={eerder}
          eldersTekst={briefing.elders}
          toegevoegdeWaarde={tip.toegevoegde_waarde}
          context={briefing.context}
          vragen={vragen}
        />
      ) : tip.briefing ? (
        <Alinea tekst={ontstreep(tip.briefing)} />
      ) : (
        <p className="np-tekst np-stil">Nog geen uitgebreide beschrijving.</p>
      ),
    },
    {
      id: 'bronnen',
      label: 'Bronnen',
      aantal: documenten.length,
      inhoud: <Bronnen documenten={documenten} />,
    },
    {
      id: 'gevonden',
      label: 'Hoe dit is gevonden',
      inhoud: (
        <>
          <p className="np-tekst">{tip.score_motivatie && ontstreep(tip.score_motivatie)}</p>
          {briefing?.gevonden && <p className="np-tekst">{ontstreep(briefing.gevonden)}</p>}

          {herkomst.length > 0 && (
            <Blok soort="herkomst" titel="Waar het vandaan komt">
              <ul className="np-blok-lijst">
                {herkomst.map((h, i) => (
                  <li key={i} className="np-eerder">
                    <div className="np-eerder-kop">
                      <strong>{h.naam ? ontstreep(h.naam, ' · ') : 'onbekende bron'}</strong>
                      {datum(h.datum) && <span className="np-stil">{datum(h.datum)}</span>}
                    </div>
                    {h.bijdrage && <p className="np-blok-tekst">{ontstreep(h.bijdrage)}</p>}
                    {h.url && <div className="np-chips"><BronChip label="Origineel document" url={h.url} /></div>}
                  </li>
                ))}
              </ul>
            </Blok>
          )}

          {weging && Object.keys(weging).length > 0 && (
            <>
              <h3 className="np-kopje">Hoe zwaar dit weegt</h3>
              <p className="np-tekst np-stil">
                Stadsgeest kent punten toe aan wat een tip kansrijk maakt. Dit is die telling, zodat je kunt
                zien waarom deze tip boven andere uitkwam, en waar de weging misschien niet klopt.
              </p>
              <table className="np-weging">
                <tbody>
                  {Object.entries(weging).map(([criterium, punten]) => (
                    <tr key={criterium}>
                      <td>{ontstreep(criterium)}</td>
                      <td className={Number(punten) < 0 ? 'np-min' : 'np-plus'}>
                        {typeof punten === 'number' ? (punten > 0 ? `+${punten}` : punten) : ontstreep(String(punten))}
                      </td>
                    </tr>
                  ))}
                  <tr className="np-weging-som">
                    <td>Totaal</td>
                    <td>{tip.score}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </>
      ),
    },
  ]

  if (!briefing?.volledig && vragen.length > 0) {
    tabs.push({
      id: 'vragen',
      label: 'Vervolgvragen',
      aantal: vragen.length,
      inhoud: (
        <Blok soort="verder" titel="Zo kom je verder">
          <ul className="np-blok-lijst np-puntlijst">
            {vragen.map((v, i) => <li key={i}>{ontstreep(v)}</li>)}
          </ul>
        </Blok>
      ),
    })
  }

  if (tip.dossier_id && tijdlijn.length > 0) {
    tabs.push({
      id: 'dossier',
      label: ontstreep(`Dossier ${tip.dossier_naam ?? ''}`.trim(), ' · '),
      aantal: tijdlijn.length,
      inhoud: (
        <>
          <p className="np-tekst np-stil">
            Alles wat Stadsgeest over dit onderwerp heeft vastgelegd, op volgorde van gebeurtenis.
            Losse feiten worden hier bewaard ook als ze afzonderlijk geen nieuws zijn.
          </p>
          <ol className="np-tijdlijn">
            {tijdlijn.map((f) => (
              <li key={f.id} className={f.superseded_by ? 'np-tijdlijn-oud' : undefined}>
                <div className="np-tijdlijn-datum">{f.datum ? formatDate(f.datum) : 'datum onbekend'}</div>
                <div className="np-tijdlijn-inhoud">
                  <strong>{ontstreep(f.titel ?? '')}</strong>
                  <div className="np-tijdlijn-meta">
                    <span>{f.fact_type}</span>
                    {f.locatie && <span>· {f.locatie}</span>}
                    <span className={`np-zekerheid np-zekerheid-${f.zekerheid}`}>{f.zekerheid.replace(/_/g, ' ')}</span>
                    {f.superseded_by && <span className="np-stil">· later gecorrigeerd</span>}
                  </div>
                  {f.details && <p className="np-tekst">{ontstreep(f.details)}</p>}
                  {f.tegenstrijdigheid && (
                    <p className="np-let-op-klein">Bronnen spreken elkaar tegen: {ontstreep(f.tegenstrijdigheid)}</p>
                  )}
                  {f.primaire_bron_url && (
                    <div className="np-chips"><BronChip label="Brondocument" url={f.primaire_bron_url} /></div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      ),
    })
  }

  return (
    <article className="np-detail">
      {/* Sticky beslisbalk met wachtrijnavigatie */}
      <BeslisNavigatie tipId={tip.id} status={tip.status} wachtrijIds={wachtrijIds} />

      <header className={`np-detail-kop${superTip ? ' np-detail-super' : ''}`}>
        <div className="np-detail-labels">
          {superTip && <span className="np-super-label"><span aria-hidden>★</span> Supertip</span>}
          <span className={`np-soort np-soort-${tip.soort}`}>{SOORT_LABEL[tip.soort] ?? tip.soort}</span>
          {tier !== null && (
            <span className={`np-tier np-tier-${tier}`} title={TIER_UITLEG[tier]}>tier {tier}</span>
          )}
          {tip.categorie && <span className="np-label">{ontstreep(tip.categorie)}</span>}
          <span className="np-label">{tip.gemeente}</span>
          {tip.status !== 'wachtrij' && <span className="np-label np-label-status">{STATUS_LABEL[tip.status] ?? tip.status}</span>}
        </div>
        <h1 className="np-detail-titel">{ontstreep(superTip ? zonderSupertip(tip.titel) : tip.titel)}</h1>
        <p className="np-detail-kern">{tip.kern && ontstreep(tip.kern)}</p>
      </header>

      <TipActies tipId={tip.id} status={tip.status} />
      <TipTabs tabs={tabs} />

      <Meetknop
        tipId={tip.id}
        artikelUrl={tip.artikel_url}
        eigenVondst={tip.eigen_vondst}
        status={tip.status}
      />

      {feedback.length > 0 && (
        <section className="np-geschiedenis">
          <h3 className="np-kopje">Wat er met deze tip is gebeurd</h3>
          <ul>
            {feedback.map((f) => (
              <li key={f.id}>
                <span className="np-stil">{formatDateTime(f.created_at)}</span> <span className="np-regel-scheiding">·</span> {f.gebruiker}: {f.actie.replace(/_/g, ' ')}
                {f.reden_code && <> ({f.reden_code.replace(/_/g, ' ')})</>}
                {f.reden_tekst && <div className="np-tekst">{ontstreep(f.reden_tekst)}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
