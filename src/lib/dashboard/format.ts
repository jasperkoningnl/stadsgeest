// Formatting- en parsing-helpers voor het redactionele dashboard.

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
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
