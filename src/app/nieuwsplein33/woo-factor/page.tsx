import Link from 'next/link'
import { turso } from '@/lib/turso'
import { leesWooZaken } from '@/lib/dashboard/wooFactorStore'
import { WOO_UITKOMSTEN } from '@/lib/dashboard/wooFactor'
import type { WooControle } from '@/lib/dashboard/wooFactor'
import GeenDatabase from '../GeenDatabase'
import WooBesluitFormulier from './WooBesluitFormulier'
import './woo.css'

export const dynamic = 'force-dynamic'

function Controlelog({ titel, log }: { titel: string; log: WooControle[] }) {
  return <details className="np-woo-controle">
    <summary>{titel} · {log.every(l => l.status === 'voltooid') ? 'afgerond' : 'nog open'}</summary>
    <ol>{log.map((l, i) => <li key={i}>
      <strong>{l.handeling}</strong><p>{l.resultaat}</p>
      <small>{l.datum} · {l.status === 'voltooid' ? 'Gecontroleerd' : 'Nog onvolledig'}{l.url && <> · <a href={l.url} target="_blank" rel="noopener noreferrer">Bron openen ↗</a></>}</small>
    </li>)}</ol>
  </details>
}

export default async function WooFactorPagina() {
  if (!turso) return <GeenDatabase />
  const zaken = await leesWooZaken(turso).catch(error => {
    // Alleen de ontbrekende installatie apart melden; andere fouten niet verbergen.
    if (String(error).includes('no such table: woo_factor_cases')) return null
    throw error
  })
  return <article className="np-woo">
    <header className="np-woo-kop"><p className="np-stil">Stadsgeest onderzoekt</p><h1>De Woo Factor</h1>
      <p>Welke stukken ontbreken in het verhaal? Eerst controleren we de bronverwerking en zoeken we online. Daarna volgt waar zinvol een gericht conceptverzoek voor de redactie.</p>
    </header>
    {zaken === null ? <p role="status">De Woo Factor wordt klaargezet. De analyses zijn nog niet beschikbaar.</p> : zaken.length === 0 ? <p>Er zijn nog geen analyses. Een vermoeden krijgt pas een conceptverzoek na de technische controle en het online onderzoek.</p> : <>
      <p>{zaken.length} analyses · {zaken.filter(z => z.analyse.uitkomst === 'informatieleemte').length} met een conceptverzoek</p>
      {zaken.map(zaak => {
        const a = zaak.analyse
        return <section key={a.id} id={a.id} className="np-woo-zaak">
          <p className="np-woo-label">{WOO_UITKOMSTEN[a.uitkomst]}</p>
          <h2>{a.titel}</h2>
          <Link href={`/nieuwsplein33/dossiers/${a.dossier_slug}`}>Dossier {zaak.dossier_naam} →</Link>
          <h3>De onderzoeksvraag</h3><p>{a.vraag}</p><p>{a.belang}</p>
          <h3>Waarom verwachten we stukken?</h3><p>{a.vermoeden}</p>
          <p className="np-stil">Bestaan: {a.ontstaansgrond === 'expliciet' ? 'expliciet genoemd in de bron' : a.ontstaansgrond === 'afgeleid' ? 'afgeleid uit de bronnen; specifieke documenttitels niet vastgesteld' : 'onvoldoende onderbouwd'}.</p>
          <Controlelog titel="Bronverwerking en technische controle" log={a.controle.technisch} />
          <Controlelog titel="Online onderzoek" log={a.controle.online} />
          <h3>Wat blijft onzeker?</h3><p>{a.tegenverklaring}</p><p>{a.beperking}</p>
          <h3>Vervolg</h3><p>{a.vervolg}</p>
          <details className="np-woo-controle"><summary>Afbakening en bronnen</summary>
            <p><strong>Vermoedelijke houder:</strong> {a.houder}<br /><strong>Periode:</strong> {a.periode.van} tot en met {a.periode.tot}</p>
            <ul>{a.documenten.map(d => <li key={d}>{d}</li>)}</ul>
            <ul>{a.bronnen.map((b, i) => <li key={i}><a href={b.url} target="_blank" rel="noopener noreferrer">{b.titel} ↗</a><p>{b.toelichting}</p></li>)}</ul>
          </details>
          <p className="np-stil">Analyse door Stadsgeest (AI). Een redactieoordeel wordt hieronder afzonderlijk vastgelegd.</p>
          <WooBesluitFormulier key={a.id} zaak={zaak} />
        </section>
      })}
    </>}
  </article>
}
