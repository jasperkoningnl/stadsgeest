import Link from 'next/link'
import { verkennerTerm } from '@/lib/dashboard/briefing'
import { chipTekst, ontleedNaam } from '@/lib/dashboard/namen'
import { ontstreep } from '@/lib/dashboard/briefing'

// Bouwstenen voor de tipdetailpagina. Elk onderdeel van het verhaal is een
// blok: een kaart met een gekleurde lijn links, de kleur zegt wat voor
// soort informatie het is. Bronnen en namen zijn chips, zodat zichtbaar is
// wat aanklikbaar is. De ontleding van namen en chiplabels staat als pure
// functies in src/lib/dashboard/namen.ts (met tests).

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

/** Bronvermelding als chip. Met URL klikbaar (pijltje), zonder URL alleen tekst. */
export function BronChip({ label, url }: { label?: string | null; url?: string | null }) {
  const tekst = chipTekst(label, url)
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
