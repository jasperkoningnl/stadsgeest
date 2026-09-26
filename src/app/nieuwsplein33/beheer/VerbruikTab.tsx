import {
  DREMPEL_KRITIEK, DREMPEL_LET_OP, LEESLIMIET, OPSLAGLIMIET, SCHRIJFLIMIET,
  mln, pct, type Onbeschikbaar, type VerbruikDetail,
} from '@/lib/dashboard/tursoVerbruik'
import { formatDateTime } from '@/lib/dashboard/format'

const STATUS_TEKST = {
  ok: 'Binnen het quotum',
  'let-op': 'Let op',
  kritiek: 'Bijna op',
  geblokkeerd: 'Geblokkeerd',
} as const

const STATUS_BLOK = {
  ok: 'np-blok-weten',
  'let-op': 'np-blok-open',
  kritiek: 'np-blok-letop',
  geblokkeerd: 'np-blok-letop',
} as const

function gb(bytes: number) {
  return `${(bytes / 1024 ** 3).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} GB`
}

export default function VerbruikTab({ verbruik: v }: { verbruik: VerbruikDetail | Onbeschikbaar }) {
  if (!v.beschikbaar) {
    return (
      <div className="np-leeg">
        <p className="np-leeg-kop">Verbruik niet beschikbaar</p>
        <p>{v.reden}</p>
      </div>
    )
  }

  const maand = new Date(v.gemeten).toLocaleDateString('nl-NL', { month: 'long', timeZone: 'UTC' })
  const vulling = Math.min(100, (v.gelezen / LEESLIMIET) * 100)
  const dagenInMaand = new Date(Date.UTC(new Date(v.gemeten).getUTCFullYear(), new Date(v.gemeten).getUTCMonth() + 1, 0)).getUTCDate()
  const dagnorm = LEESLIMIET / dagenInMaand

  return (
    <div className="np-verbruik">
      {/* ── Stand van de maand ─────────────────────────────────────── */}
      <section className={`np-blok ${STATUS_BLOK[v.status]}`}>
        <h2 className="np-blok-kop">Leesquotum {maand} · {STATUS_TEKST[v.status]}</h2>
        <div className="np-vb-kern">
          <div className="np-vb-getal">{mln(v.gelezen)}</div>
          <div className="np-vb-van">
            van {mln(LEESLIMIET)} gelezen rijen <strong>({pct(v.gelezen)})</strong>
          </div>
        </div>
        <div className="np-vb-meter" role="img" aria-label={`${pct(v.gelezen)} van het leesquotum gebruikt`}>
          <span className="np-vb-meter-vul" style={{ width: `${vulling}%` }} />
          <span className="np-vb-meter-streep" style={{ left: `${DREMPEL_LET_OP * 100}%` }} title="75%: let op" />
          <span className="np-vb-meter-streep" style={{ left: `${DREMPEL_KRITIEK * 100}%` }} title="90%: kritiek" />
        </div>
        {v.redenen.length > 0 && (
          <ul className="np-blok-lijst np-puntlijst np-vb-redenen">
            {v.redenen.map(r => <li key={r}>{r}</li>)}
          </ul>
        )}
        <dl className="np-vb-cijfers">
          <div><dt>Prognose eind maand</dt><dd>{mln(v.prognose)}</dd></div>
          <div><dt>Gemiddeld per dag (72 uur)</dt><dd>{mln(v.gemiddeldPerDag)}</dd></div>
          <div><dt>Ruimte per dag tot de 1e</dt><dd>{v.gelezen >= LEESLIMIET ? 'geen' : mln(v.dagbudget)}</dd></div>
          <div><dt>Geschreven rijen</dt><dd>{mln(v.geschreven)} <small>({pct(v.geschreven, SCHRIJFLIMIET)})</small></dd></div>
          <div><dt>Opslag</dt><dd>{gb(v.opslag)} <small>({pct(v.opslag, OPSLAGLIMIET)})</small></dd></div>
        </dl>
        <p className="np-vb-voet">
          Plan {v.plan}
          {v.periodeEinde ? ` · periode tot ${formatDateTime(v.periodeEinde)}` : ''}
          {' · bijbetalen '}{v.bijbetalen ? 'aan' : 'uit'}
          {' · waarschuwing ingesteld op het gratis quotum van '}{mln(LEESLIMIET)}
          {' · gemeten '}{formatDateTime(v.gemeten)}
        </p>
      </section>

      {/* ── Per dag ───────────────────────────────────────────────── */}
      <section className="np-blok np-blok-verder">
        <h2 className="np-blok-kop">Per dag · {v.hoofdDb}</h2>
        <p className="np-vb-uitleg">
          De stippellijn is een gelijkmatige verdeling van het quotum over de maand ({mln(dagnorm)} per dag).
          Dagen erboven zijn oranje.
        </p>
        <DagGrafiek dagen={v.dagen} dagnorm={dagnorm} dagenInMaand={dagenInMaand} />
      </section>

      {/* ── Per uur ───────────────────────────────────────────────── */}
      <section className="np-blok np-blok-verder">
        <h2 className="np-blok-kop">Afgelopen 24 uur · {v.hoofdDb}</h2>
        <p className="np-vb-uitleg">
          Per uur, met de geplande jobs die in dat uur starten. NDW draait elk kwartier en zit in elk uur.
          Cowork-routines, losse scripts en het dashboard zelf staan er niet bij; die zie je als verbruik
          in een uur zonder job.
        </p>
        <UurTabel uren={v.uren} />
      </section>

      {/* ── Per database ──────────────────────────────────────────── */}
      <section className="np-blok np-blok-wie">
        <h2 className="np-blok-kop">Per database, deze maand</h2>
        <div className="np-beheer-tabel-wrap">
          <table className="np-tabel np-vb-tabel">
            <thead><tr><th>Database</th><th>Gelezen</th><th>Geschreven</th><th>Opslag</th></tr></thead>
            <tbody>
              {v.perDatabase.map(d => (
                <tr key={d.naam}>
                  <td>{d.naam}</td>
                  <td>{mln(d.gelezen)}</td>
                  <td>{mln(d.geschreven)}</td>
                  <td>{gb(d.opslag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Uitleg ────────────────────────────────────────────────── */}
      <section className="np-blok np-blok-context">
        <h2 className="np-blok-kop">Hoe Turso telt</h2>
        <ul className="np-blok-lijst np-puntlijst">
          <li>Elke rij die de database bekijkt telt, niet alleen de rijen die terugkomen.</li>
          <li>Zonder passende index leest een query de hele tabel. <code>LIKE &apos;%…&apos;</code> kan nooit een index gebruiken.</li>
          <li><code>count</code>, <code>sum</code>, <code>min</code>, <code>max</code> en <code>avg</code> tellen elke rij die ze meenemen.</li>
          <li>Joins en subqueries tellen de bekeken rijen van alle betrokken tabellen.</li>
          <li>Een index aanmaken of <code>ALTER TABLE</code> kost één keer de hele tabel.</li>
          <li>Het quotum geldt voor het hele account. Bij overschrijding op het gratis plan worden alle leesopdrachten geweigerd.</li>
          <li>Afspraak: de hele database doorzoeken gebeurt op een lokale kopie, nooit rechtstreeks op Turso.</li>
        </ul>
      </section>
    </div>
  )
}

function DagGrafiek({ dagen, dagnorm, dagenInMaand }: { dagen: VerbruikDetail['dagen']; dagnorm: number; dagenInMaand: number }) {
  const max = Math.max(dagnorm * 1.25, ...dagen.map(d => d.gelezen))
  const normHoogte = (dagnorm / max) * 100
  const kolommen = Array.from({ length: dagenInMaand }, (_, i) => dagen[i] ?? null)
  return (
    <div className="np-vb-dagen">
      <div className="np-vb-staven" style={{ gridTemplateColumns: `repeat(${dagenInMaand}, 1fr)` }}>
        <span className="np-vb-norm" style={{ bottom: `${normHoogte}%` }} aria-hidden="true" />
        {kolommen.map((d, i) => (
          <div key={i} className="np-vb-kolom" tabIndex={d ? 0 : undefined}>
            {d && (
              <span
                className={`np-vb-staaf${d.gelezen > dagnorm ? ' np-vb-staaf-boven' : ''}`}
                style={{ height: `${Math.max(1.5, (d.gelezen / max) * 100)}%` }}
              />
            )}
            {d && <span className="np-vb-tip">{Number(d.dag.slice(8))}e · {mln(d.gelezen)}</span>}
          </div>
        ))}
      </div>
      <div className="np-vb-as" style={{ gridTemplateColumns: `repeat(${dagenInMaand}, 1fr)` }}>
        {kolommen.map((_, i) => <span key={i}>{(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>)}
      </div>
      <p className="np-vb-grootste">
        Grootste dag: {(() => {
          const top = [...dagen].sort((a, b) => b.gelezen - a.gelezen)[0]
          return top ? `${Number(top.dag.slice(8))}e met ${mln(top.gelezen)}` : '–'
        })()}
      </p>
    </div>
  )
}

function UurTabel({ uren }: { uren: VerbruikDetail['uren'] }) {
  const max = Math.max(1, ...uren.map(u => u.gelezen))
  return (
    <div className="np-beheer-tabel-wrap">
      <table className="np-tabel np-vb-tabel np-vb-uren">
        <thead><tr><th>Uur</th><th>Gelezen</th><th className="np-vb-balk-kol" aria-hidden="true"></th><th>Job</th></tr></thead>
        <tbody>
          {[...uren].reverse().map(u => (
            <tr key={u.van} className={u.gelezen === 0 ? 'np-vb-stil' : undefined}>
              <td>{u.label}</td>
              <td>{u.gelezen ? mln(u.gelezen) : '0'}</td>
              <td className="np-vb-balk-kol" aria-hidden="true">
                <span className="np-vb-balk" style={{ width: `${(u.gelezen / max) * 100}%` }} />
              </td>
              <td>{u.jobs || (u.gelezen > 0 ? <span className="np-vb-onbekend">geen geplande job</span> : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
