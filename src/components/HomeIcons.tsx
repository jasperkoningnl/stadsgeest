// Lijniconen voor de voorpagina. Bewust inline en zonder pakket: de site heeft
// verder geen icoonbibliotheek en dit zijn er drie.

type IconProps = { className?: string }

const gedeeld = {
  width: 30,
  height: 30,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

// Stapel documenten met een vergrootglas: de bronnen die worden doorgenomen.
export function IconDoorzoeken({ className }: IconProps) {
  return (
    <svg {...gedeeld} className={className}>
      <path d="M4 3.5h9l3.5 3.5v4" />
      <path d="M4 3.5v13h5" />
      <path d="M12.5 3.5V7H16" />
      <path d="M6.5 7.5h4M6.5 10.5h5M6.5 13.5h3" />
      <circle cx="15.5" cy="15.5" r="4" />
      <path d="M18.5 18.5 21 21" />
    </svg>
  )
}

// Trechter: veel gaat erin, weinig komt eruit.
export function IconWegen({ className }: IconProps) {
  return (
    <svg {...gedeeld} className={className}>
      <path d="M3 4h18l-7 8v8l-4-2.5V12L3 4Z" />
      <path d="M7.5 7.5h9" />
    </svg>
  )
}

// Venster met een pijl erin: het signaal dat op het dashboard belandt.
export function IconDoorgeven({ className }: IconProps) {
  return (
    <svg {...gedeeld} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 8.5h18" />
      <path d="M8 14.5h7" />
      <path d="M12 11.5l3 3-3 3" />
    </svg>
  )
}
