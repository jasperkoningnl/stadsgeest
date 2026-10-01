'use client'

import { useRef, useState, type ReactNode } from 'react'

// In- en uitzoomen en verslepen van een server-gerenderde SVG. De tekening
// zelf (knopen, lijnen, labels) komt als children van de server; hier wordt
// alleen de viewBox aangepast. Slepen verschuift het beeld; een korte klik
// blijft een gewone klik op een link.

const MIN_BREEDTE = 150

export default function ZoomVlak({ breedte, hoogte, label, children }: {
  breedte: number
  hoogte: number
  label: string
  children: ReactNode
}) {
  const [vak, setVak] = useState({ x: 0, y: 0, b: breedte, h: hoogte })
  const svgRef = useRef<SVGSVGElement>(null)
  const sleep = useRef<{ px: number; py: number; x: number; y: number; bewogen: boolean } | null>(null)
  const zojuistGesleept = useRef(false)

  const zoom = (factor: number) => setVak((v) => {
    const b = Math.min(breedte, Math.max(MIN_BREEDTE, v.b * factor))
    const h = (b / breedte) * hoogte
    const cx = v.x + v.b / 2, cy = v.y + v.h / 2
    return { x: cx - b / 2, y: cy - h / 2, b, h }
  })
  const herstel = () => setVak({ x: 0, y: 0, b: breedte, h: hoogte })
  const ingezoomd = vak.b < breedte - 1

  return (
    <div className="np-zoom">
      <div className="np-zoom-knoppen" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoom(0.7)} aria-label="Inzoomen" title="Inzoomen">+</button>
        <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Uitzoomen" title="Uitzoomen" disabled={!ingezoomd}>−</button>
        <button type="button" onClick={herstel} disabled={!ingezoomd} title="Hele tekening tonen">passend</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vak.x} ${vak.y} ${vak.b} ${vak.h}`}
        role="img"
        aria-label={label}
        className={`np-graaf-svg${ingezoomd ? ' np-zoom-sleepbaar' : ''}${vak.b <= breedte * 0.5 ? ' np-zoom-ver' : ''}`}
        onPointerDown={(e) => {
          if (!ingezoomd) return
          sleep.current = { px: e.clientX, py: e.clientY, x: vak.x, y: vak.y, bewogen: false }
        }}
        onPointerMove={(e) => {
          const s = sleep.current
          if (!s || !svgRef.current) return
          const dx = e.clientX - s.px, dy = e.clientY - s.py
          if (!s.bewogen && Math.hypot(dx, dy) < 4) return
          if (!s.bewogen) { s.bewogen = true; svgRef.current.setPointerCapture(e.pointerId) }
          const schaal = vak.b / svgRef.current.getBoundingClientRect().width
          const x = Math.min(breedte - vak.b, Math.max(0, s.x - dx * schaal))
          const y = Math.min(hoogte - vak.h, Math.max(0, s.y - dy * schaal))
          setVak((v) => ({ ...v, x, y }))
        }}
        onPointerUp={() => {
          zojuistGesleept.current = !!sleep.current?.bewogen
          sleep.current = null
        }}
        onClickCapture={(e) => {
          // Na slepen geen link volgen.
          if (zojuistGesleept.current) { e.preventDefault(); e.stopPropagation(); zojuistGesleept.current = false }
        }}
      >
        {children}
      </svg>
    </div>
  )
}
