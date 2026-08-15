// Formatting- en parsing-helpers voor het redactiedashboard.
//
// Alle timestamps in de database staan in UTC (SQLite's datetime('now') en de
// scrapers schrijven beide UTC weg). Weergave gebeurt altijd via deze helpers,
// die expliciet naar Europe/Amsterdam converteren — dit is het ene punt dat
// dat doet, gebruik het overal in plaats van zelf met Date te rekenen.
const TIJDZONE = 'Europe/Amsterdam'

export function formatDateTime(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TIJDZONE })
}

export function formatDate(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIJDZONE })
}

export function formatTime(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TIJDZONE })
}

export function parseDbDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s - m * 60)
  return `${m}m ${rem}s`
}

export function daysSince(iso: string | null | undefined): number | null {
  const d = parseDbDate(iso)
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

/** yyyy-mm-dd in Nederlandse tijd — voor kalenderdagvergelijkingen. */
function dagString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TIJDZONE })
}

/** Kalenderdagen geleden in Nederlandse tijd (0 = vandaag, 1 = gisteren). */
export function kalenderdagenGeleden(iso: string | null | undefined): number | null {
  const d = parseDbDate(iso)
  if (!d) return null
  return Math.round((Date.parse(dagString(new Date())) - Date.parse(dagString(d))) / 86400000)
}

/**
 * "vandaag" en "gisteren" zijn in één oogopslag duidelijk; daarna is een echte
 * datum sneller te plaatsen dan "9 dagen geleden". Kalenderdagen in
 * Nederlandse tijd, dus iets van gisteravond heet ook 's ochtends "gisteren".
 * Het jaartal verschijnt alleen buiten het lopende jaar.
 */
export function formatRelative(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return 'nooit'
  const nu = new Date()
  const dagVerschil = Math.round(
    (Date.parse(dagString(nu)) - Date.parse(dagString(d))) / 86400000,
  )
  if (dagVerschil <= 0) return 'vandaag'
  if (dagVerschil === 1) return 'gisteren'
  const zelfdeJaar = dagString(d).slice(0, 4) === dagString(nu).slice(0, 4)
  return d.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    ...(zelfdeJaar ? {} : { year: 'numeric' }),
    timeZone: TIJDZONE,
  })
}

/**
 * De routines schrijven JSON weg in tekstvelden. Bij onparsebare inhoud geven
 * deze helpers `null` terug in plaats van de pagina te laten crashen — een
 * fout van een routine mag het dashboard niet omleggen.
 */
export function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw || !raw.trim()) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Zoals safeParseJson, maar geeft alleen iets terug als het resultaat ook echt een array is. */
export function safeParseJsonArray<T>(raw: string | null | undefined): T[] | null {
  const parsed = safeParseJson<unknown>(raw)
  return Array.isArray(parsed) ? (parsed as T[]) : null
}
