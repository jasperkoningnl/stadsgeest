// Filter op de vergunningenlijst, gedeeld door de pagina en de CSV-export,
// zodat wat je ziet ook is wat je downloadt.
import type { ThemaId, VergunningItem, VergunningSoort } from './wonenQueries'

export interface VergunningFilter {
  soort: VergunningSoort | ''
  thema: ThemaId | ''
  wijk: string
  periode: '30' | '90' | '180' | 'alles'
  zoek: string
}

export type ZoekParams = Record<string, string | string[] | undefined>

function een(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export function leesFilter(params: ZoekParams): VergunningFilter {
  const periode = een(params.periode)
  return {
    soort: een(params.soort) as VergunningFilter['soort'],
    thema: een(params.thema) as VergunningFilter['thema'],
    wijk: een(params.wijk),
    periode: periode === '30' || periode === '180' || periode === 'alles' ? periode : '90',
    zoek: een(params.zoek).trim().slice(0, 80),
  }
}

export function pasFilterToe(items: VergunningItem[], f: VergunningFilter): VergunningItem[] {
  const grens = f.periode === 'alles' ? '' : new Date(Date.now() - Number(f.periode) * 86400000).toISOString().slice(0, 10)
  const zoek = f.zoek.toLowerCase()
  return items.filter((it) =>
    (!f.soort || it.soort === f.soort)
    && (!f.thema || it.themas.includes(f.thema))
    && (!f.wijk || it.wijkCode === f.wijk)
    && (!grens || it.datum >= grens)
    && (!zoek || it.titel.toLowerCase().includes(zoek)),
  )
}

export function filterNaarQuery(f: VergunningFilter, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.soort) p.set('soort', f.soort)
  if (f.thema) p.set('thema', f.thema)
  if (f.wijk) p.set('wijk', f.wijk)
  if (f.periode !== '90') p.set('periode', f.periode)
  if (f.zoek) p.set('zoek', f.zoek)
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}
