import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Leest LOGBOEK.md uit de repowortel en zet het om in blokken voor de
 * logboekpagina.
 *
 * Waarom een bestand in de repo en geen tabel: het logboek verandert alleen als
 * er iets aan het dashboard verandert, en dat gebeurt bij een deploy. Zo staat
 * de tekst in dezelfde commit als de wijziging die hij beschrijft en kan hij
 * niet stilletjes uit de pas gaan lopen met wat er live staat.
 *
 * Het bestand moet expliciet mee in de Vercel-build; zie
 * `outputFileTracingIncludes` in next.config.ts. Vergeet je dat, dan is het
 * bestand op Vercel afwezig en toont de pagina een lege lijst in plaats van te
 * crashen — zie `leesBestand`.
 */

const BESTAND = 'LOGBOEK.md'

/** `## 2026-08-15 — Kop`, met een kastlijn of een gewoon koppelteken. */
const KOP = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/

export interface LogboekBlok {
  soort: 'alinea' | 'lijst'
  regels: string[]
}

export interface LogboekItem {
  datum: string
  kop: string
  blokken: LogboekBlok[]
}

// In productie verandert het bestand niet tussen twee verzoeken, dus één keer
// lezen volstaat. In ontwikkeling niet cachen, anders moet je de server
// herstarten om je eigen tekst te zien.
let cache: LogboekItem[] | null = null

async function leesBestand(): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), BESTAND), 'utf8')
  } catch {
    return null
  }
}

export function parseLogboek(ruw: string): LogboekItem[] {
  const items: LogboekItem[] = []
  let huidig: LogboekItem | null = null
  let buffer: string[] = []
  let bufferSoort: 'alinea' | 'lijst' | null = null

  function sluitBuffer() {
    if (huidig && bufferSoort && buffer.length > 0) {
      huidig.blokken.push({ soort: bufferSoort, regels: buffer })
    }
    buffer = []
    bufferSoort = null
  }

  // De gebruiksaanwijzing bovenaan het bestand bevat een voorbeeldregel in een
  // codeblok. Zonder deze vlag wordt dat voorbeeld een echte logboekregel — dat
  // gebeurde ook, met een verzonnen datum in de toekomst bovenaan de pagina.
  let inCodeblok = false

  for (const regel of ruw.split(/\r?\n/)) {
    if (regel.trim().startsWith('```')) { inCodeblok = !inCodeblok; sluitBuffer(); continue }
    if (inCodeblok) continue

    const kop = KOP.exec(regel)
    if (kop) {
      sluitBuffer()
      huidig = { datum: kop[1], kop: kop[2], blokken: [] }
      items.push(huidig)
      continue
    }

    // Alles vóór de eerste datumkop is de gebruiksaanwijzing bovenaan het
    // bestand en hoort niet op de pagina.
    if (!huidig) continue

    const leeg = regel.trim() === ''
    if (leeg) { sluitBuffer(); continue }

    // Een scheidingsstreep is opmaak, geen inhoud.
    if (/^---+$/.test(regel.trim())) { sluitBuffer(); continue }

    const lijstpunt = /^\s*[-*]\s+(.*)$/.exec(regel)
    const soort: 'alinea' | 'lijst' = lijstpunt ? 'lijst' : 'alinea'
    if (bufferSoort && bufferSoort !== soort) sluitBuffer()
    bufferSoort = soort

    if (lijstpunt) buffer.push(lijstpunt[1].trim())
    else if (bufferSoort === 'alinea' && buffer.length > 0) {
      // Doorlopende zinnen die in het bestand over meerdere regels zijn
      // afgebroken, weer aan elkaar plakken.
      buffer[buffer.length - 1] += ' ' + regel.trim()
    } else buffer.push(regel.trim())
  }

  sluitBuffer()

  // Nieuwste bovenaan, ongeacht de volgorde in het bestand.
  return items.sort((a, b) => b.datum.localeCompare(a.datum))
}

export async function getLogboek(): Promise<LogboekItem[]> {
  if (cache) return cache
  const ruw = await leesBestand()
  const items = ruw ? parseLogboek(ruw) : []
  if (process.env.NODE_ENV === 'production') cache = items
  return items
}

/** De datum van de nieuwste regel, voor het ongelezen-stipje in de navigatie. */
export async function laatsteLogboekDatum(): Promise<string | null> {
  const items = await getLogboek()
  return items[0]?.datum ?? null
}
