import Link from 'next/link'
import { verkennerTerm, ontstreep } from '@/lib/dashboard/briefing'

// Bouwstenen voor de tipdetailpagina. Elk onderdeel van het verhaal is een
// blok: een kaart met een gekleurde lijn links, de kleur zegt wat voor
// soort informatie het is. Bronnen en namen zijn chips, zodat zichtbaar is
// wat aanklikbaar is.

export type BlokSoort = 'weten' | 'open' | 'context' | 'verder' | 'eerder' | 'letop' | 'wie' | 'herkomst'

export function Blok({ soort, titel, id, children }: {
  soort: BlokSoort
  titel: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className={`np-blok np-blok-${soort} np-anker`}>
      <h3 className="np-blok-kop">{titel}</h3>
      {children}
    </section>
  )
}

function hostLabel(url: string): string {
  try {
    // Host plus documentnummer, zodat twee links naar dezelfde site niet gelijk ogen.
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|api)\./, '')
    const nummer = u.pathname.match(/\d{4,}/g)?.pop()
    return nummer ? `${host} · ${nummer}` : host
  } catch {
    return 'brondocument'
  }
}

/** Bronvermelding als chip. Met URL klikbaar (pijltje), zonder URL alleen tekst. */
export function BronChip({ label, url }: { label?: string | null; url?: string | null }) {
  // De weger laat soms losse voegwoorden achter ("en https://…"); die tellen niet als label.
  // De tier staat al bovenaan de tip; in de chip is het ruis.
  let tekst = label ? ontstreep(label).replace(/https?:\/\/\S+/g, '').replace(/,?\s*tier\s*\d\.?/gi, '').replace(/^(en|of|zie)\s+/i, '').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim() : ''
  if (tekst.length < 3) tekst = url ? hostLabel(url) : ''
  // Alleen een datum zegt niet welk document het is; zet de site ervoor.
  else if (url && !/\p{L}/u.test(tekst)) tekst = `${hostLabel(url)}, ${tekst}`
  if (!tekst) return null
  if (!url) return <span className="np-chip np-chip-bron" title={tekst}><span>{tekst}</span></span>
  return (
    <a className="np-chip np-chip-bron np-chip-link" href={url} target="_blank" rel="noreferrer" title={`${tekst}\n${url}`}>
      <span>{tekst}</span>
      <span className="np-chip-pijl" aria-hidden>↗</span>
    </a>
  )
}

// ── Betrokkenen ─────────────────────────────────────────────

/** Splits op komma's die niet tussen haakjes staan. */
function splitBuiten(s: string): string[] {
  const uit: string[] = []
  let diepte = 0
  let huidig = ''
  for (const c of s) {
    if (c === '(') diepte++
    if (c === ')') diepte = Math.max(0, diepte - 1)
    if (c === ',' && diepte === 0) { uit.push(huidig); huidig = ''; continue }
    huidig += c
  }
  uit.push(huidig)
  return uit.map((x) => x.trim()).filter(Boolean)
}

type NaamDeel =
  | { soort: 'naam'; naam: string; prefix: string | null; klein: boolean }
  | { soort: 'tekst'; tekst: string }

// Alleen iets wat op een naam lijkt wordt een chip: begint met een hoofdletter
// of cijfer, is kort genoeg en bevat geen haakjes. De rest blijft gewone tekst,
// zodat een halve zin nooit als klikbare naam oogt.
function lijktNaam(s: string): boolean {
  return /^[\p{Lu}\d]/u.test(s) && s.length <= 60 && !/[()]/.test(s)
}

function naamOfTekst(s: string, klein: boolean): NaamDeel {
  const t = s.trim()
  // "directeur Leoniek Kroneman", "eerder Joris Buningh", "t.a.v. A. Dols"
  const pm = t.match(/^((?:[a-zà-ÿ][\p{L}.-]*\s+)+)(\p{Lu}.*)$/u)
  if (pm && lijktNaam(pm[2])) return { soort: 'naam', naam: pm[2].trim(), prefix: pm[1].trim(), klein }
  if (lijktNaam(t)) return { soort: 'naam', naam: t, prefix: null, klein }
  return { soort: 'tekst', tekst: t }
}

// "MetMaya (directeur Leoniek Kroneman, eerder Joris Buningh)" wordt een chip
// voor MetMaya plus een kleine chip per persoon, met "directeur"/"eerder" als
// voorvoegsel. "A (X) en B (Y)" wordt twee naamchips met elk hun toevoeging.
function ontleedNaam(naam: string): NaamDeel[] {
  // Zonder haakjes niet op komma's knippen: "Staatssecretaris van Onderwijs,
  // Cultuur en Wetenschap" is één naam.
  if (!naam.includes('(')) return [naamOfTekst(naam, false)]
  const uit: NaamDeel[] = []
  for (const deel of splitBuiten(naam)) {
    const groepen = [...deel.matchAll(/(\p{Lu}[^()]*?)\s*\(([^()]+)\)/gu)]
    const rest = deel.replace(/(\p{Lu}[^()]*?)\s*\(([^()]+)\)/gu, '').replace(/^[\s,;]*(en|of)?[\s,;]*$/i, '').trim()
    if (groepen.length === 0 || rest) {
      uit.push(naamOfTekst(deel, false))
      continue
    }
    for (const g of groepen) {
      uit.push(naamOfTekst(g[1], false))
      for (const p of splitBuiten(g[2])) uit.push(naamOfTekst(p, true))
    }
  }
  return uit
}

function NaamChip({ naam, prefix, klein }: { naam: string; prefix?: string | null; klein?: boolean }) {
  return (
    <Link
      href={`/nieuwsplein33/verkenner?q=${encodeURIComponent(verkennerTerm(naam))}`}
      className={`np-chip np-chip-naam${klein ? ' np-chip-klein' : ''}`}
      title={`Alles wat Stadsgeest heeft over ${naam}`}
    >
      {prefix && <span className="np-chip-prefix">{prefix}</span>}
      <span>{naam}</span>
      <span className="np-chip-pijl" aria-hidden>→</span>
    </Link>
  )
}

export function Betrokkenen({ lijst }: {
  lijst: { naam: string; rol: string | null; toelichting: string | null }[]
}) {
  return (
    <ul className="np-blok-lijst np-wie">
      {lijst.map((b, i) => (
        <li key={i}>
          <div className="np-chips">
            {ontleedNaam(ontstreep(b.naam)).map((d, j) =>
              d.soort === 'naam'
                ? <NaamChip key={j} naam={d.naam} prefix={d.prefix} klein={d.klein} />
                : <span key={j} className="np-wie-tekst">{d.tekst}</span>,
            )}
          </div>
          {b.rol && <div className="np-wie-rol">{ontstreep(b.rol)}</div>}
          {b.toelichting && <div className="np-wie-toel">{ontstreep(b.toelichting)}</div>}
        </li>
      ))}
    </ul>
  )
}
