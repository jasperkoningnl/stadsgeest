import { FORMAT_LABELS, FORMAT_COLORS } from '@/lib/utils'

interface Props {
  format: string
}

export default function FormatBadge({ format }: Props) {
  const label = FORMAT_LABELS[format] || 'Nieuws'
  const color = FORMAT_COLORS[format] || 'var(--accent)'

  return (
    <div className="art-format" style={{ color }}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="4" fill="currentColor" />
      </svg>
      {label}
    </div>
  )
}
