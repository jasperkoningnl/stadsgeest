import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import {
  getTipDetail, getTipDocumenten, getTipFeedback, getDossierTijdlijn,
  type TipDocument,
} from '@/lib/dashboard/tipQueries'
import { formatDate, formatDateTime, safeParseJson, safeParseJsonArray } from '@/lib/dashboard/format'
import { parseBriefing, verkennerTerm, type GeparsedeBriefing } from '@/lib/dashboard/briefing'
import GeenDatabase from '../../GeenDatabase'
import { SOORT_LABEL } from '../../TipRegel'
import TipTabs, { type Tab } from './TipTabs'
import TipActies from './TipActies'
import Meetknop from './Meetknop'

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
  1: 'Officiële publicatiebron — bekendmaking, register, uitspraak, aanbesteding',
  2: 'Bevestigende bron — gemeente, veiligheidsregio, corporatie, instelling',
  3: 'Signaalbron — meldingen, buurtplatforms, sociale media',
}

const ROL_LABEL: Record<string, string> = {
  dragend: 'Dragend',
  bevestigend: 'Bevestigend',
  context: 'Context',
}

interface HerkomstBron { naam?: string; tier?: number; url?: string; datum?: string; bijdrage?: string }
interface EldersItem { medium?: string; url?: string; datum?: string }

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

/**
 * Het verhaal-tabblad: de briefing in leesbare blokken in plaats van platte
 * tekst, met een submenuutje dat naar de aanwezige blokken springt. Volgorde
 * vastgelegd met Jasper op 15 augustus: weten → wie → niet weten → verder →
 * let op → eerdere berichtgeving.
 */
function Verhaal({ briefing, eerder, eldersTekst, toegevoegdeWaarde, vragen, context }: {
  briefing: GeparsedeBriefing
  eerder: EerderBericht[]
  eldersTekst: string | null
  toegevoegdeWaarde: string | null
  vragen: string[]
  context: string | null
}) {
  const heeftEerder = eerder.length > 0 || Boolean(eldersTekst && !/^nee\.?$/i.test(eldersTekst))
  const submenu = [
    briefing.weten.length > 0 && { id: 'weten', label: 'Wat we weten' },
    Boolean(context) && { id: 'context', label: 'Context en achtergrond' },
    briefing.betrokkenen.length > 0 && { id: 'wie', label: 'Wie hierin voorkomen' },
    briefing.nietWeten.length > 0 && { id: 'niet-weten', label: 'Wat we niet weten' },
    vragen.length > 0 && { id: 'verder', label: 'Zo kom je verder' },
    briefing.nietInMag.length > 0 && { id: 'let-op', label: 'Let op' },
    heeftEerder && { id: 'eerder', label: 'Eerdere berichtgeving' },
  ].filter(Boolean) as { id: string; label: string }[]

  return (
    <>
      {submenu.length > 1 && (
        <nav className="np-submenu" aria-label="Onderdelen van het verhaal">
          {submenu.map((s) => (
            <a key={s.id} href={`#${s.id}`}>{s.label}</a>
          ))}
        </nav>
      )}

      <section id="weten" className="np-anker">
        <h3 className="np-kopje">Wat we weten</h3>
        <ol className="np-feiten">
          {briefing.weten.map((f, i) => (
            <li key={i}>
              <p>{f.tekst}</p>
              {(f.bron || f.url) && (
                <div className="np-feit-bron">
                  {f.url
                    ? <a href={f.url} target="_blank" rel="noreferrer">{f.bron || 'brondocument'}</a>
                    : f.bron}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {context && (
        <div id="context" className="np-paneel np-paneel-context np-anker">
          <strong>Context en achtergrond</strong>
          <p>{context}</p>
        </div>
      )}

      {briefing.betrokkenen.length > 0 && (
        <section id="wie" className="np-betrokkenen np-anker">
          <h3 className="np-kopje">Wie hierin voorkomen</h3>
          <ul>
            {briefing.betrokkenen.map((b, i) => (
              <li key={i}>
                <div>
                  <Link
                    href={`/nieuwsplein33/verkenner?q=${encodeURIComponent(verkennerTerm(b.naam))}`}
                    className="np-betrokkene-naam"
                    title={`Alles wat Stadsgeest heeft over ${b.naam}`}
                  >
                    {b.naam}
                  </Link>
                  {b.rol && <span className="np-betrokkene-rol">{b.rol}</span>}
                </div>
                {b.toelichting && <div className="np-betrokkene-toel">{b.toelichting}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {briefing.nietWeten.length > 0 && (
        <div id="niet-weten" className="np-paneel np-paneel-open np-anker">
          <strong>Wat we niet weten</strong>
          <ul>{briefing.nietWeten.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {vragen.length > 0 && (
        <div id="verder" className="np-paneel np-paneel-verder np-anker">
          <strong>Zo kom je verder</strong>
          <ul>{vragen.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </div>
      )}

      {briefing.nietInMag.length > 0 && (
        <div id="let-op" className="np-paneel np-paneel-nee np-anker">
          <strong>Let op</strong>
          <ul>{briefing.nietInMag.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {heeftEerder && (
        <div id="eerder" className="np-paneel np-paneel-eerder np-anker">
          <strong>Eerdere berichtgeving</strong>
          {eerder.length > 0 && (
            <ul>
              {eerder.map((e, i) => (
                <li key={i}>
                  <span className="np-eerder-medium">{e.medium}</span>
                  {e.datum && <span className="np-stil">, {formatDate(e.datum)}</span>}
                  {e.titel && <> — {e.titel}</>}
                  {e.url && <> — <a href={e.url} target="_blank" rel="noreferrer">lees het artikel</a></>}
                </li>
              ))}
            </ul>
          )}
          {eerder.length === 0 && eldersTekst && <p>{eldersTekst}</p>}
          {toegevoegdeWaarde && <p className="np-eerder-nieuw"><strong>Wat hier nieuw aan is:</strong> {toegevoegdeWaarde}</p>}
        </div>
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
            <span className="np-doc-groep-titel">{g.titel ?? `spoor ${g.signalId}`}</span>
            <span className="np-doc-groep-tel">{g.docs.length} {g.docs.length === 1 ? 'document' : 'documenten'}</span>
          </div>
          <ol className="np-doclijst">
            {g.docs.map((d, i) => (
              <li key={i} className="np-doc">
                <div className="np-doc-kop">
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.titel}</a> : <span>{d.titel}</span>}
                </div>
                <div className="np-doc-meta">
                  <span className="np-bron">{d.bron}</span>
                  {d.tier && <span className={`np-tier np-tier-${d.tier}`} title={TIER_UITLEG[d.tier]}>tier {d.tier}</span>}
                  {d.bronrol === 'spiegel' && <span className="np-bron np-bron-spiegel">samenwerkingspartner</span>}
                  <span className="np-regel-scheiding">·</span>
                  <span>
                    {d.gepubliceerd
                      ? `gepubliceerd ${formatDate(d.gepubliceerd)}`
                      : `binnengekomen ${formatDate(d.gescrapet)}`}
                  </span>
                </div>
                {d.fragment && <p className="np-doc-fragment">{d.fragment}…</p>}
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

  const [documenten, feedback, tijdlijn] = await Promise.all([
    getTipDocumenten(id),
    getTipFeedback(id),
    tip.dossier_id ? getDossierTijdlijn(tip.dossier_id) : Promise.resolve([]),
  ])

  const vragen = safeParseJsonArray<string>(tip.vervolgvragen) ?? []
  const wegingRaw = safeParseJson<Record<string, number | { punten: number; bron?: string }>>(tip.weging)
  // Normaliseer: de weger slaat soms {punten, bron} op i.p.v. een getal.
  const weging = wegingRaw
    ? Object.fromEntries(
        Object.entries(wegingRaw).map(([k, v]) => [k, typeof v === 'object' && v !== null ? (v as { punten: number }).punten : v as number])
      )
    : null
  const herkomst = safeParseJsonArray<HerkomstBron>(tip.herkomst) ?? []
  const elders = safeParseJsonArray<EldersItem>(tip.elders_gebracht) ?? []
  const briefing = tip.briefing ? parseBriefing(tip.briefing) : null

  // "Eerdere berichtgeving": wat de weger als elders-gebracht vastlegde, plus
  // de artikelen van Nieuwsplein33 en de partners die al aan deze tip hangen
  // (de spiegeldocumenten uit de onderliggende sporen). Ontdubbeld op URL.
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
      medium: d.bron,
      titel: d.titel,
      datum: d.gepubliceerd ?? d.gescrapet,
      url: d.url,
    })
  }

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
          vragen={vragen}
          context={briefing.context}
        />
      ) : tip.briefing ? (
        // Terugval: briefing zonder het vaste format toont als platte tekst.
        <Alinea tekst={tip.briefing} />
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
          <p className="np-tekst">{tip.score_motivatie}</p>
          {briefing?.gevonden && <p className="np-tekst">{briefing.gevonden}</p>}

          {herkomst.length > 0 && (
            <>
              <h3 className="np-kopje">Waar het vandaan komt</h3>
              <ul className="np-herkomst">
                {herkomst.map((h, i) => (
                  <li key={i}>
                    <strong>{h.naam ?? 'onbekende bron'}</strong>
                    {h.datum && <span className="np-stil"> — {formatDate(h.datum)}</span>}
                    {h.bijdrage && <div className="np-herkomst-bijdrage">{h.bijdrage}</div>}
                    {h.url && <div><a href={h.url} target="_blank" rel="noreferrer">origineel document</a></div>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {weging && Object.keys(weging).length > 0 && (
            <>
              <h3 className="np-kopje">Hoe zwaar dit weegt</h3>
              <p className="np-tekst np-stil">
                Stadsgeest kent punten toe aan wat een tip kansrijk maakt. Dit is die telling, zodat je kunt
                zien waarom deze tip boven andere uitkwam — en waar de weging misschien niet klopt.
              </p>
              <table className="np-weging">
                <tbody>
                  {Object.entries(weging).map(([criterium, punten]) => (
                    <tr key={criterium}>
                      <td>{criterium}</td>
                      <td className={punten < 0 ? 'np-min' : 'np-plus'}>{punten > 0 ? `+${punten}` : punten}</td>
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

  // De vervolgvragen staan op het verhaal-tabblad ("Zo kom je verder"), direct
  // onder wat we nog niet weten — die twee horen bij elkaar. Alleen als de
  // briefing niet in het vaste format staat, krijgen ze een eigen tabblad.
  if (!briefing?.volledig && vragen.length > 0) {
    tabs.push({
      id: 'vragen',
      label: 'Vervolgvragen',
      aantal: vragen.length,
      inhoud: (
        <ul className="np-vragen">
          {vragen.map((v, i) => <li key={i}>{v}</li>)}
        </ul>
      ),
    })
  }

  if (tip.dossier_id && tijdlijn.length > 0) {
    tabs.push({
      id: 'dossier',
      label: `Dossier ${tip.dossier_naam ?? ''}`.trim(),
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
                  <strong>{f.titel}</strong>
                  <div className="np-tijdlijn-meta">
                    <span>{f.fact_type}</span>
                    {f.locatie && <span>· {f.locatie}</span>}
                    <span className={`np-zekerheid np-zekerheid-${f.zekerheid}`}>{f.zekerheid.replace(/_/g, ' ')}</span>
                    {f.superseded_by && <span className="np-stil">· later gecorrigeerd</span>}
                  </div>
                  {f.details && <p className="np-tekst">{f.details}</p>}
                  {f.tegenstrijdigheid && (
                    <p className="np-let-op-klein">Bronnen spreken elkaar tegen: {f.tegenstrijdigheid}</p>
                  )}
                  {f.primaire_bron_url && (
                    <a href={f.primaire_bron_url} target="_blank" rel="noreferrer">brondocument</a>
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
      <Link href="/nieuwsplein33" className="np-terug">← terug naar de wachtrij</Link>

      <header className="np-detail-kop">
        <div className="np-detail-labels">
          <span className={`np-soort np-soort-${tip.soort}`}>{SOORT_LABEL[tip.soort] ?? tip.soort}</span>
          {tip.categorie && <span className="np-label">{tip.categorie}</span>}
          <span className="np-label">{tip.gemeente}</span>
          {tip.status !== 'wachtrij' && <span className="np-label np-label-status">{STATUS_LABEL[tip.status] ?? tip.status}</span>}
        </div>
        <h1 className="np-detail-titel">{tip.titel}</h1>
        <p className="np-detail-kern">{tip.kern}</p>
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
                <span className="np-stil">{formatDateTime(f.created_at)}</span> — {f.gebruiker}: {f.actie.replace(/_/g, ' ')}
                {f.reden_code && <> ({f.reden_code.replace(/_/g, ' ')})</>}
                {f.reden_tekst && <div className="np-tekst">{f.reden_tekst}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
