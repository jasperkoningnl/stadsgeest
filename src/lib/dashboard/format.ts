// Formatting- en parsing-helpers voor het redactionele dashboard.
//
// Alle timestamps in de database staan in UTC (SQLite's datetime('now') en de
// scrapers schrijven beide UTC weg). Weergave gebeurt altijd via deze helpers,
// die expliciet naar Europe/Amsterdam converteren — dit is het ene punt dat
// dat doet, gebruik het overal in plaats van zelf met Date te rekenen.
const DASHBOARD_TIME_ZONE = 'Europe/Amsterdam'

export function formatDateTime(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: DASHBOARD_TIME_ZONE })
}

export function formatDate(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DASHBOARD_TIME_ZONE })
}

export function formatTime(iso: string | null | undefined): string {
  const d = parseDbDate(iso)
  if (!d) return '—'
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: DASHBOARD_TIME_ZONE })
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
  const days = daysSince(iso)
  if (days === null) return 'nooit'
  if (days <= 0) return 'vandaag'
  if (days === 1) return 'gisteren'
  if (days < 30) return `${days} dagen geleden`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} maand${months > 1 ? 'en' : ''} geleden`
  const years = Math.floor(days / 365)
  return `${years} jaar geleden`
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

// ── Signalen ──────────────────────────────────────────────

export const SIGNAL_STATUS_META: Record<string, { label: string; desc: string; color: string }> = {
  new: { label: 'Nieuw', desc: 'net binnen, nog niet beoordeeld', color: 'var(--primary)' },
  watching: { label: 'Watching', desc: 'bevestigd maar nog niet nieuwswaardig genoeg', color: 'var(--amber)' },
  researching: { label: 'Researching', desc: 'geselecteerd als kandidaat', color: 'var(--accent)' },
  published: { label: 'Published', desc: 'artikel verschenen', color: '#5fd97a' },
  discarded: { label: 'Discarded', desc: 'afgevallen', color: 'var(--t3)' },
  parked: { label: 'Parked', desc: 'geparkeerd, later opnieuw bekijken', color: 'var(--border-s)' },
}

export const TIER_META: Record<number, { label: string; desc: string }> = {
  1: { label: 'Tier 1', desc: 'publicatiebron — zelfstandig artikelkandidaat' },
  2: { label: 'Tier 2', desc: 'corroboratiebron' },
  3: { label: 'Tier 3', desc: 'detectiebron — alleen trigger' },
}

export const SOURCE_HEALTH_META: Record<string, { label: string; color: string; desc: string }> = {
  ok: { label: 'OK', color: '#5fd97a', desc: 'levert in lijn met verwachting' },
  verdacht: { label: 'Verdacht', color: 'var(--amber)', desc: 'blijft leeg of faalt vaker dan gebruikelijk voor deze bron' },
  dood: { label: 'Dood', color: 'var(--red, #c0392b)', desc: 'meerdere runs op rij leeg of foutief — waarschijnlijk gestopt of gewijzigd' },
  uitgeschakeld: { label: 'Uitgeschakeld', color: 'var(--t3)', desc: 'bewust uitgezet, wordt niet meer gecontroleerd' },
}

export const BETROUWBAARHEID_META: Record<string, { label: string; color: string }> = {
  hoog: { label: 'Hoog', color: '#5fd97a' },
  middel: { label: 'Middel', color: 'var(--amber)' },
  laag: { label: 'Laag', color: 'var(--t3)' },
}

export const DECISION_META: Record<string, { label: string; color: string }> = {
  new_signal: { label: 'Nieuw signaal', color: 'var(--accent)' },
  historical_signal: { label: 'Historisch signaal', color: 'var(--t3)' },
  matched: { label: 'Gekoppeld', color: 'var(--amber)' },
  filtered: { label: 'Gefilterd', color: 'var(--t3)' },
}

export const NO_HISTORY_MESSAGE =
  'Geen beslisgeschiedenis vastgelegd — dit signaal is verwerkt voordat de logging bestond.'

// ── Briefing-parser ───────────────────────────────────────

export interface BriefingTag {
  key: string
  label: string
  emphasis?: boolean
}

export interface BriefingSection {
  kind: 'main' | 'onderzoeksopdracht' | 'research-aanvulling'
  heading: string
  paragraphs: string[]
}

export interface ParsedBriefing {
  tags: BriefingTag[]
  sections: BriefingSection[]
}

const BRACKET_RE = /\[([^\]]+)\]/g
const FIELD_LINE_RE = /^(TYPE|FORMAT|LABEL|PRIORITEIT|UPDATE-DOELARTIKEL)\s*:\s*(.+)$/i

function classifyBracket(inner: string): BriefingTag | null {
  const t = inner.trim()
  let m: RegExpExecArray | null
  // [TIER: n] uit de briefing is de tier zoals de intake die bij aanmaak zag — niet meer
  // getoond als los label, want de effectieve tier (sterkste bevestigende bron, elders
  // getoond) is de actuele waarheid en kan afwijken als het signaal later is bevestigd
  // door een sterkere bron.
  if (/^TIER\s*:/i.test(t)) return null
  if ((m = /^NOVELTY\s*:\s*(.+)$/i.exec(t))) return { key: `novelty:${m[1]}`, label: `Novelty ${m[1].trim()}` }
  if ((m = /^TYPE\s*:\s*(.+)$/i.exec(t))) {
    const val = m[1].trim()
    return { key: `type:${val}`, label: `Type: ${val}`, emphasis: /update/i.test(val) }
  }
  if ((m = /^LABEL\s*:\s*(.+)$/i.exec(t))) return { key: `label:${m[1]}`, label: m[1].trim(), emphasis: true }
  if (/HISTORISCH/i.test(t)) return { key: 'historisch', label: 'Historisch — context, geen actief signaal', emphasis: true }
  return null
}

function classifyFieldLine(key: string, value: string): BriefingTag {
  const k = key.toUpperCase()
  const v = value.trim()
  if (k === 'LABEL') return { key: `label:${v}`, label: v, emphasis: /weekanalyse/i.test(v) }
  if (k === 'TYPE') return { key: `type:${v}`, label: `Type: ${v}`, emphasis: /update/i.test(v) }
  if (k === 'UPDATE-DOELARTIKEL') return { key: `update-target:${v}`, label: `Update van: ${v}`, emphasis: true }
  return { key: `${k.toLowerCase()}:${v}`, label: `${k.charAt(0)}${k.slice(1).toLowerCase()}: ${v}` }
}

function dedupeTags(tags: BriefingTag[]): BriefingTag[] {
  const seen = new Set<string>()
  const out: BriefingTag[] = []
  for (const t of tags) {
    if (seen.has(t.key)) continue
    seen.add(t.key)
    out.push(t)
  }
  return out
}

/**
 * Ontleedt het `summary`-veld van een signaal. Herkent de blokken die de
 * speurder/researcher-routines erin zetten ([TIER: n], ONDERZOEKSOPDRACHT
 * VOOR RESEARCHER, RESEARCH-AANVULLING, LABEL: WEEKANALYSE, TYPE: update)
 * zonder aannames te doen over de rest van de structuur — die blijft gewoon
 * leesbare tekst.
 */
export function parseBriefing(raw: string | null | undefined): ParsedBriefing {
  if (!raw || !raw.trim()) return { tags: [], sections: [] }

  const tags: BriefingTag[] = []
  let m: RegExpExecArray | null
  BRACKET_RE.lastIndex = 0
  while ((m = BRACKET_RE.exec(raw))) {
    const tag = classifyBracket(m[1])
    if (tag) tags.push(tag)
  }

  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.replace(/^-{3,}\s*/, '').replace(/\s*-{3,}$/, '').trim())
    .filter(Boolean)

  const sections: BriefingSection[] = []
  let current: BriefingSection = { kind: 'main', heading: 'Briefing', paragraphs: [] }
  sections.push(current)

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim())

    // Blok bestaat alleen uit velden (TYPE:/FORMAT:/LABEL:/...) en/of bracket-tags → metadata, geen lopende tekst
    const nonEmptyLines = lines.filter(Boolean)
    const allFieldLines = nonEmptyLines.length > 0 && nonEmptyLines.every((l) => FIELD_LINE_RE.test(l) || /^(\[[^\]]+\]\s*)+$/.test(l))
    if (allFieldLines) {
      for (const l of nonEmptyLines) {
        const fm = FIELD_LINE_RE.exec(l)
        if (fm) tags.push(classifyFieldLine(fm[1], fm[2]))
      }
      continue
    }

    // Blok is uitsluitend de titel "BRIEFING ARTIKELKANDIDAAT" → gebruiken als kop, niet als tekst
    if (/^BRIEFING ARTIKELKANDIDAAT$/i.test(block)) {
      current.heading = 'Briefing artikelkandidaat'
      continue
    }

    const firstLine = lines[0] || ''
    const withoutBrackets = block.replace(BRACKET_RE, '').trim()

    if (/^RESEARCH-AANVULLING/i.test(firstLine)) {
      current = { kind: 'research-aanvulling', heading: firstLine, paragraphs: [] }
      sections.push(current)
      const rest = lines.slice(1).join('\n').trim()
      if (rest) current.paragraphs.push(rest)
      continue
    }
    if (/^ONDERZOEKSOPDRACHT VOOR RESEARCHER/i.test(firstLine)) {
      current = { kind: 'onderzoeksopdracht', heading: 'Onderzoeksopdracht voor researcher', paragraphs: [] }
      sections.push(current)
      const rest = lines.slice(1).join('\n').trim()
      if (rest) current.paragraphs.push(rest)
      continue
    }

    if (!withoutBrackets) continue // was alleen bracket-tags
    current.paragraphs.push(block)
  }

  return {
    tags: dedupeTags(tags),
    sections: sections.filter((s) => s.paragraphs.length > 0),
  }
}

// ── Statusverantwoording ──────────────────────────────────

const SPEURDER_RE = /\[SPEURDER\s+(\d{1,2})-(\d{1,2})\]/i
const NL_MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

/** Herkent `[SPEURDER dd-mm]` in de briefingtekst en zet het om in leesbare vorm. */
export function parseSpeurderNote(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = SPEURDER_RE.exec(raw)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  if (month < 1 || month > 12) return null
  return `beoordeeld door de speurder op ${day} ${NL_MONTHS[month - 1]}`
}

// ── Persberichten ─────────────────────────────────────────

/**
 * Parseert JSON die door de redactieassistent is weggeschreven (facts, open_questions,
 * sources op press_releases). De agent schrijft dit veld, dus bij onparsebare of
 * onverwachte inhoud geven we `null` terug in plaats van de pagina te laten crashen —
 * de aanroeper toont dan de ruwe waarde.
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

export interface PressReleaseFact {
  feit: string
  bron_naam?: string
  bron_url?: string
}

export interface PressReleaseSource {
  naam: string
  url?: string
  tier?: number
}

interface PressReleaseTextFields {
  headline: string | null
  lead: string | null
  body: string | null
  facts: string | null
  open_questions: string | null
  sources: string | null
}

/**
 * Bouwt de platte-tekstversie voor de kopieerknop: kop, lead, body, dan feiten met
 * bronnen, open vragen en de bronnenlijst — leesbaar buiten de browser, in een
 * tekstverwerker of mail. Bij onparsebare JSON valt dit terug op de ruwe waarde,
 * zodat kopiëren nooit vastloopt op wat de agent heeft weggeschreven.
 */
export function buildPressReleaseClipboardText(pr: PressReleaseTextFields): string {
  const parts: string[] = []
  if (pr.headline) parts.push(pr.headline)
  if (pr.lead) parts.push(pr.lead)
  if (pr.body) parts.push(pr.body)

  // Let op: safeParseJsonArray geeft `[]` terug voor een geldige lege array — dat is
  // niet hetzelfde als `null` (onparsebaar/geen array). Alleen bij `null` valt dit terug
  // op de ruwe tekst; een geldige lege array levert gewoon geen sectie op.
  const facts = safeParseJsonArray<PressReleaseFact>(pr.facts)
  if (facts) {
    if (facts.length > 0) {
      parts.push(
        ['FEITEN EN BRONNEN', ...facts.map((f) => `- ${f.feit}${f.bron_naam ? ` — bron: ${f.bron_naam}` : ''}${f.bron_url ? ` (${f.bron_url})` : ''}`)].join('\n')
      )
    }
  } else if (pr.facts && pr.facts.trim()) {
    parts.push(`FEITEN EN BRONNEN\n${pr.facts}`)
  }

  const questions = safeParseJsonArray<string>(pr.open_questions)
  if (questions) {
    if (questions.length > 0) {
      parts.push(['OPEN VRAGEN VOOR DE REDACTIE', ...questions.map((q) => `- ${q}`)].join('\n'))
    }
  } else if (pr.open_questions && pr.open_questions.trim()) {
    parts.push(`OPEN VRAGEN VOOR DE REDACTIE\n${pr.open_questions}`)
  }

  const sources = safeParseJsonArray<PressReleaseSource>(pr.sources)
  if (sources) {
    if (sources.length > 0) {
      parts.push(
        ['BRONNEN', ...sources.map((s) => `- ${s.naam}${s.tier ? ` (T${s.tier})` : ''}${s.url ? ` — ${s.url}` : ''}`)].join('\n')
      )
    }
  } else if (pr.sources && pr.sources.trim()) {
    parts.push(`BRONNEN\n${pr.sources}`)
  }

  return parts.join('\n\n')
}
