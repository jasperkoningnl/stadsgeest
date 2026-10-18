// Gedeeld door de importcontrole, API en pagina. Geen netwerk- of databasecode.
export const WOO_UITKOMSTEN = {
  in_onderzoek: 'Controle nog niet afgerond',
  document_gevonden: 'Document gevonden',
  technisch_probleem: 'Technisch probleem',
  onvoldoende_aanwijzingen: 'Onvoldoende aanwijzingen',
  informatieleemte: 'Onderbouwde informatieleemte',
} as const

export interface WooControle {
  datum: string
  handeling: string
  resultaat: string
  status: 'voltooid' | 'onvolledig'
  url?: string
}

export interface WooAnalyse {
  id: string
  dossier_slug: string
  titel: string
  vraag: string
  belang: string
  vermoeden: string
  ontstaansgrond: 'expliciet' | 'afgeleid' | 'onvoldoende'
  houder: string
  periode: { van: string; tot: string }
  documenten: string[]
  tegenverklaring: string
  uitkomst: keyof typeof WOO_UITKOMSTEN
  beperking: string
  vervolg: string
  controle: { technisch: WooControle[]; online: WooControle[] }
  bronnen: { titel: string; url: string; toelichting: string }[]
  concept: string
}

export function veiligeWooUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
  } catch { return false }
}

// Next kan request.url intern op localhost normaliseren. De Host-header houdt
// de werkelijk bezochte host en poort; browsers kunnen die niet zelf vervangen.
export function zelfdeWooHerkomst(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === host
  } catch { return false }
}

function tekst(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 20000
}

function datum(value: unknown): value is string {
  return typeof value === 'string' && /^(19|20)\d{2}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

/** Fail closed: een concept vereist aantoonbaar ingevulde, afgeronde controles. */
export function valideerWooAnalyse(value: unknown): WooAnalyse {
  if (!value || typeof value !== 'object') throw new Error('Analyse ontbreekt.')
  const a = value as WooAnalyse
  if (typeof a.id !== 'string' || typeof a.dossier_slug !== 'string' || !/^[a-z0-9][a-z0-9-]{2,100}$/.test(a.id) || !/^[a-z0-9-]+$/.test(a.dossier_slug)) throw new Error('Ongeldige analyse- of dossiercode.')
  for (const field of ['titel', 'vraag', 'belang', 'vermoeden', 'houder', 'tegenverklaring', 'beperking', 'vervolg'] as const) {
    if (!tekst(a[field])) throw new Error(`Veld ${field} ontbreekt of is te lang.`)
  }
  if (!Object.hasOwn(WOO_UITKOMSTEN, a.uitkomst)) throw new Error('Ongeldige controle-uitkomst.')
  if (!['expliciet', 'afgeleid', 'onvoldoende'].includes(a.ontstaansgrond)) throw new Error('Bewijs voor bestaan ontbreekt.')
  if (!datum(a.periode?.van) || !datum(a.periode?.tot) || a.periode.van > a.periode.tot) throw new Error('Ongeldige afbakening in tijd.')
  if (!Array.isArray(a.documenten) || !a.documenten.length || !a.documenten.every(tekst)) throw new Error('Documentafbakening ontbreekt.')
  if (!Array.isArray(a.bronnen) || !a.bronnen.length || !a.bronnen.every(b => b && tekst(b.titel) && tekst(b.toelichting) && veiligeWooUrl(b.url))) throw new Error('Controleerbare bronnen ontbreken.')
  for (const tak of ['technisch', 'online'] as const) {
    const logs = a.controle?.[tak]
    if (!Array.isArray(logs) || !logs.length || !logs.every(l => l && datum(l.datum) && tekst(l.handeling) && tekst(l.resultaat) && ['voltooid', 'onvolledig'].includes(l.status) && (l.url === undefined || veiligeWooUrl(l.url)))) throw new Error(`Controlelog ${tak} ontbreekt of is ongeldig.`)
  }
  const compleet = [...a.controle.technisch, ...a.controle.online].every(l => l.status === 'voltooid')
  if (a.uitkomst !== 'in_onderzoek' && !compleet) throw new Error('Rond beide controletakken af voordat een einduitkomst wordt vastgelegd.')
  if (typeof a.concept !== 'string' || a.concept.length > 20000) throw new Error('Ongeldig concept.')
  if (a.uitkomst === 'informatieleemte') {
    if (a.ontstaansgrond === 'onvoldoende' || !tekst(a.concept)) throw new Error('Een concept vereist bewijs voor bestaan en een onderbouwde informatieleemte.')
  } else if (a.concept.trim()) throw new Error('Alleen een onderbouwde informatieleemte mag een concept krijgen.')
  return a
}

export const WOO_BESLUITEN = { te_beoordelen: 'Te beoordelen', goedgekeurd: 'Goedgekeurd voor indiening', afgewezen: 'Afgewezen' } as const
export type WooBesluit = keyof typeof WOO_BESLUITEN

export function wooBewerking(analyse: WooAnalyse, actie: unknown, concept: unknown, huidigConcept: string): { concept: string; besluit: WooBesluit } {
  valideerWooAnalyse(analyse)
  if (actie === 'afwijzen') return { concept: huidigConcept, besluit: 'afgewezen' }
  if (analyse.uitkomst !== 'informatieleemte') throw new Error('Deze controle-uitkomst staat geen concept of goedkeuring toe.')
  if (!tekst(concept)) throw new Error('Het concept ontbreekt of is te lang.')
  if (actie === 'opslaan') return { concept: concept.trim(), besluit: 'te_beoordelen' }
  if (actie === 'goedkeuren') {
    if (concept !== huidigConcept) throw new Error('Sla het gewijzigde concept eerst op en beoordeel daarna de opgeslagen versie.')
    return { concept, besluit: 'goedgekeurd' }
  }
  throw new Error('Ongeldige bewerking.')
}
