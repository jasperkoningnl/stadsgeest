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

export function daysSince(iso: string | null | undefined): number | null {
  const d = parseDbDate(iso)
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export function formatRelative(iso: string | null | undefined): string {
  const dagen = daysSince(iso)
  if (dagen === null) return 'nooit'
  if (dagen <= 0) return 'vandaag'
  if (dagen === 1) return 'gisteren'
  if (dagen < 30) return `${dagen} dagen geleden`
  const maanden = Math.floor(dagen / 30)
  if (maanden < 12) return `${maanden} maand${maanden > 1 ? 'en' : ''} geleden`
  return `${Math.floor(dagen / 365)} jaar geleden`
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
