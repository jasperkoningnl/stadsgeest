// Namen en bronchips uit de briefing van de weger ontleden. Pure functies,
// zonder React, zodat ze los te testen zijn (npm run test:dashboard). De
// weergave staat in src/app/nieuwsplein33/tip/[id]/TipBlokken.tsx.
// Met extensie, zodat node --test (type stripping) het bestand ook zonder bundler vindt.
import { ontstreep } from './briefing.ts'

export type NaamDeel =
  | { soort: 'naam'; naam: string; prefix: string | null; klein: boolean }
  | { soort: 'tekst'; tekst: string }

/** Splits op komma's die niet tussen haakjes staan. */
export function splitBuiten(s: string): string[] {
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

// Alleen iets wat op een naam lijkt wordt een chip: begint met een hoofdletter
// of cijfer, is kort genoeg en bevat geen haakjes. De rest blijft gewone tekst,
// zodat een halve zin nooit als klikbare naam oogt.
export function lijktNaam(s: string): boolean {
  return /^[\p{Lu}\d]/u.test(s) && s.length <= 60 && !/[()]/.test(s)
}

export function naamOfTekst(s: string, klein: boolean): NaamDeel {
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
export function ontleedNaam(naam: string): NaamDeel[] {
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

/** Host plus documentnummer, zodat twee links naar dezelfde site niet gelijk ogen. */
export function hostLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|api)\./, '')
    const nummer = u.pathname.match(/\d{4,}/g)?.pop()
    return nummer ? `${host} · ${nummer}` : host
  } catch {
    return 'brondocument'
  }
}

/**
 * Tekst van een bronchip. De weger laat soms losse voegwoorden achter ("en
 * https://…"); die tellen niet als label. De tier staat al bovenaan de tip; in
 * de chip is het ruis. Alleen een datum zegt niet welk document het is; dan
 * komt de site ervoor. Leeg betekent: geen chip tonen.
 */
export function chipTekst(label: string | null | undefined, url: string | null | undefined): string {
  let tekst = label
    ? ontstreep(label).replace(/https?:\/\/\S+/g, '').replace(/,?\s*tier\s*\d\.?/gi, '').replace(/^(en|of|zie)\s+/i, '').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim()
    : ''
  if (tekst.length < 3) tekst = url ? hostLabel(url) : ''
  else if (url && lijktDatum(tekst)) tekst = `${hostLabel(url)}, ${tekst}`
  return tekst
}

const MAAND = '(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|apr|jun|jul|aug|sep|sept|okt|nov|dec)'
const DATUM_MET_MAAND = new RegExp(`^(?:\\d{1,2}\\s+)?${MAAND}\\.?\\s+\\d{4}$`, 'iu')

/** "3 mei 2024", "september 2026", "03-05-2024", "2024": een label dat alleen een datum is. */
export function lijktDatum(s: string): boolean {
  const t = s.trim()
  return !/\p{L}/u.test(t) || DATUM_MET_MAAND.test(t)
}
