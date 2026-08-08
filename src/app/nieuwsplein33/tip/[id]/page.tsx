import Link from 'next/link'
import { notFound } from 'next/navigation'
import { hasTurso } from '@/lib/turso'
import {
  getTipDetail, getTipDocumenten, getTipFeedback, getDossierTijdlijn,
} from '@/lib/dashboard/tipQueries'
import { formatDate, formatDateTime, safeParseJson, safeParseJsonArray } from '@/lib/dashboard/format'
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
  const weging = safeParseJson<Record<string, number>>(tip.weging)
  const herkomst = safeParseJsonArray<HerkomstBron>(tip.herkomst) ?? []
  const elders = safeParseJsonArray<EldersItem>(tip.elders_gebracht) ?? []

  const tabs: Tab[] = [
    {
      id: 'verhaal',
      label: 'Het verhaal',
      inhoud: (
        <>
          {tip.briefing ? <Alinea tekst={tip.briefing} /> : <p className="np-tekst np-stil">Nog geen uitgebreide beschrijving.</p>}
          {elders.length > 0 && (
            <div className="np-let-op">
              <strong>Hier is elders al over geschreven.</strong>
              <ul>
                {elders.map((e, i) => (
                  <li key={i}>
                    {e.medium ?? 'onbekend medium'}
                    {e.datum && `, ${formatDate(e.datum)}`}
                    {e.url && <> — <a href={e.url} target="_blank" rel="noreferrer">bekijk</a></>}
                  </li>
                ))}
              </ul>
              {tip.toegevoegde_waarde && <p className="np-tekst"><strong>Wat hier nieuw aan is:</strong> {tip.toegevoegde_waarde}</p>}
            </div>
          )}
        </>
      ),
    },
    {
      id: 'bronnen',
      label: 'Bronnen',
      aantal: documenten.length,
      inhoud: documenten.length === 0 ? (
        <p className="np-tekst np-stil">Geen onderliggende documenten gevonden.</p>
      ) : (
        <ol className="np-doclijst">
          {documenten.map((d, i) => (
            <li key={i} className="np-doc">
              <div className="np-doc-kop">
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.titel}</a> : <span>{d.titel}</span>}
              </div>
              <div className="np-doc-meta">
                <span className="np-bron">{d.bron}</span>
                {d.tier && <span className="np-tier" title={TIER_UITLEG[d.tier]}>{TIER_UITLEG[d.tier]?.split('—')[0].trim()}</span>}
                {d.bronrol === 'spiegel' && <span className="np-bron-spiegel">samenwerkingspartner</span>}
                <span className="np-regel-scheiding">·</span>
                <span>binnengekomen {formatDate(d.gescrapet)}</span>
              </div>
              {d.fragment && <p className="np-doc-fragment">{d.fragment}…</p>}
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: 'gevonden',
      label: 'Hoe dit is gevonden',
      inhoud: (
        <>
          <p className="np-tekst">{tip.score_motivatie}</p>

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
    {
      id: 'vragen',
      label: 'Vervolgvragen',
      aantal: vragen.length || undefined,
      inhoud: vragen.length === 0 ? (
        <p className="np-tekst np-stil">Geen vervolgvragen vastgelegd.</p>
      ) : (
        <ul className="np-vragen">
          {vragen.map((v, i) => <li key={i}>{v}</li>)}
        </ul>
      ),
    },
  ]

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
