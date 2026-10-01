// Server-gerenderde netwerktekening: eenvoudige krachtgerichte opmaak
// (Fruchterman-Reingold) met vaste beginposities, zodat dezelfde data altijd
// dezelfde tekening geeft. Alleen zoomen en verslepen draait in de browser
// (ZoomVlak); een klik op een bol of blokje springt naar de lijst eronder.
import ZoomVlak from './ZoomVlak'

export interface TekenKnoop {
  id: string
  label: string
  grootte: number // 1..n, bepaalt de straal
  soort: 'organization' | 'person' | 'location' | 'document'
  stippel: boolean
  href: string
  titel: string
}

export interface TekenLijn {
  van: string
  naar: string
  dikte: number // 1..n
  soort: 'passage' | 'relatie' | 'bron'
  href?: string
  titel: string
}

const B = 1000
const H = 620

function opmaak(knopen: TekenKnoop[], lijnen: TekenLijn[]): Map<string, { x: number; y: number }> {
  const n = knopen.length
  const pos = new Map<string, { x: number; y: number }>()
  // Beginposities op een spiraal: deterministisch en goed verspreid.
  knopen.forEach((k, i) => {
    const hoek = i * 2.399963
    const r = 40 + 260 * Math.sqrt((i + 0.5) / Math.max(n, 1))
    pos.set(k.id, { x: B / 2 + r * Math.cos(hoek), y: H / 2 + r * Math.sin(hoek) * 0.85 })
  })
  if (n < 2) return pos
  const k = Math.sqrt((B * H) / n) * 0.42
  let temp = B / 8
  const ids = knopen.map((x) => x.id)
  for (let iter = 0; iter < 350; iter++) {
    const disp = new Map<string, { x: number; y: number }>(ids.map((id) => [id, { x: 0, y: 0 }]))
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos.get(ids[i])!, b = pos.get(ids[j])!
      let dx = a.x - b.x, dy = a.y - b.y
      let d = Math.hypot(dx, dy)
      if (d < 0.01) { dx = 0.01 * (i - j); dy = 0.01; d = 0.02 }
      const f = (k * k) / d
      disp.get(ids[i])!.x += (dx / d) * f; disp.get(ids[i])!.y += (dy / d) * f
      disp.get(ids[j])!.x -= (dx / d) * f; disp.get(ids[j])!.y -= (dy / d) * f
    }
    for (const l of lijnen) {
      const a = pos.get(l.van), b = pos.get(l.naar)
      if (!a || !b) continue
      const dx = a.x - b.x, dy = a.y - b.y
      const d = Math.max(Math.hypot(dx, dy), 0.01)
      const f = ((d * d) / k) * (0.6 + 0.15 * Math.min(l.dikte, 4))
      disp.get(l.van)!.x -= (dx / d) * f; disp.get(l.van)!.y -= (dy / d) * f
      disp.get(l.naar)!.x += (dx / d) * f; disp.get(l.naar)!.y += (dy / d) * f
    }
    for (const id of ids) {
      const p = pos.get(id)!, v = disp.get(id)!
      // Lichte trek naar het midden houdt losse groepjes in beeld.
      v.x += (B / 2 - p.x) * 0.05 * k / 10
      v.y += (H / 2 - p.y) * 0.08 * k / 10
      const d = Math.max(Math.hypot(v.x, v.y), 0.01)
      p.x += (v.x / d) * Math.min(d, temp)
      p.y += (v.y / d) * Math.min(d, temp)
      // Rechts ruimte houden voor het label naast de knoop.
      p.x = Math.min(B - 190, Math.max(30, p.x))
      p.y = Math.min(H - 25, Math.max(25, p.y))
    }
    temp = Math.max(1, temp * 0.985)
  }
  return pos
}

function straal(k: TekenKnoop): number {
  if (k.soort === 'document') return 5
  return 6 + Math.min(16, Math.sqrt(k.grootte) * 3.2)
}

function kort(s: string, n = 28): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export default function GraafTekening({ knopen, lijnen, label }: { knopen: TekenKnoop[]; lijnen: TekenLijn[]; label: string }) {
  const pos = opmaak(knopen, lijnen)
  return (
    <figure className="np-graaf" aria-label={label}>
      <ZoomVlak breedte={B} hoogte={H} label={label}>
        <g>
          {lijnen.map((l, i) => {
            const a = pos.get(l.van), b = pos.get(l.naar)
            if (!a || !b) return null
            const lijn = (
              <>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`np-graaf-lijn np-graaf-lijn-${l.soort}`}
                  strokeWidth={l.soort === 'bron' ? 1 : 1 + Math.min(l.dikte, 6) * 0.9} />
                {/* Brede onzichtbare lijn als klikvlak. */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="np-graaf-klikvlak" strokeWidth={12}>
                  <title>{l.titel}</title>
                </line>
              </>
            )
            return l.href ? <a key={i} href={l.href}>{lijn}</a> : <g key={i}>{lijn}</g>
          })}
        </g>
        <g>
          {knopen.map((k) => {
            const p = pos.get(k.id)!
            const r = straal(k)
            return (
              <a key={k.id} href={k.href} className={`np-graaf-knoop np-graaf-${k.soort}${k.stippel ? ' np-graaf-stippel' : ''}`}>
                <title>{k.titel}</title>
                {k.soort === 'document'
                  ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={1.5} />
                  : <circle cx={p.x} cy={p.y} r={r} />}
                {/* Kort label in het overzicht; ingezoomd verschijnt de volledige naam. */}
                <text x={p.x + r + 4} y={p.y + 4} className="np-graaf-label np-graaf-label-kort">{kort(k.label, k.soort === 'document' ? 24 : 26)}</text>
                <text x={p.x + r + 4} y={p.y + 4} className="np-graaf-label np-graaf-label-lang">{kort(k.label, 90)}</text>
              </a>
            )
          })}
        </g>
      </ZoomVlak>
    </figure>
  )
}
