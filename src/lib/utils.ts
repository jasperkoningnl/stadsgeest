export function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 2) return 'zojuist'
  if (diffMins < 60) return `${diffMins} min geleden`
  if (diffHours < 24) return `${diffHours} uur geleden`
  if (diffDays === 1) return 'gisteren'
  if (diffDays < 7) return `${diffDays} dagen geleden`
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })
}

export const TAG_COLORS: Record<string, string> = {
  'Wonen':           '#4a9b6a',
  'Politiek':        '#4a7bb5',
  'Verkeer':         '#c4902a',
  'Veiligheid':      '#b55a4a',
  'Cultuur':         '#8a5ab5',
  'Economie':        '#4a9a9a',
  'Duurzaamheid':    '#5a9a5a',
  'Analyse':         '#7a7ab5',
  '112':             '#c44a30',
  'Vathorst':        '#3a8a9a',
  'Soesterkwartier': '#9a7a4a',
  'Centrum':         '#7a7a8a',
}

export const FORMAT_LABELS: Record<string, string> = {
  nieuws:    'Nieuws',
  brief:     'Brief',
  analyse:   'Analyse',
  feature:   'Feature',
  interview: 'Interview',
  '112':     '112',
}

export const FORMAT_COLORS: Record<string, string> = {
  analyse:   'var(--c-analyse)',
  feature:   'var(--accent)',
  '112':     'var(--c-112)',
  interview: 'var(--c-cultuur)',
  nieuws:    'var(--accent)',
  brief:     'var(--accent)',
}
