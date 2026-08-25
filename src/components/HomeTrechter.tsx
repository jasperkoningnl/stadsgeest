// Trechtergrafiek voor de voorpagina: veel bronnen links, één verhaal rechts.
// De streepjes zijn deterministisch berekend, niet willekeurig, zodat de
// server- en clientrender identiek zijn en er geen hydratiefout ontstaat.

const KOLOMMEN = [
  { n: 34, label: 'bronnen', toon: 'var(--t3)' },
  { n: 14, label: 'signalen', toon: 'var(--t2)' },
  { n: 3, label: 'redactie', toon: 'var(--accent)' },
]

export default function HomeTrechter() {
  return (
    <div className="home-trechter" role="img" aria-label="Van tientallen bronnen per dag blijven enkele signalen over die de redactie bereiken.">
      {KOLOMMEN.map((kol, i) => (
        <div key={kol.label} className="home-trechter-kolom">
          <div className="home-trechter-staven">
            {Array.from({ length: kol.n }, (_, j) => (
              <span
                key={j}
                className="home-trechter-staaf"
                style={{
                  background: kol.toon,
                  // Lichte hoogtevariatie zodat het geen streepjescode wordt.
                  height: 9 + ((j * 7) % 5) * 2,
                  opacity: i === 2 ? 1 : 0.55 + ((j * 3) % 4) * 0.09,
                }}
              />
            ))}
          </div>
          <span className="home-trechter-label" style={{ color: i === 2 ? 'var(--accent)' : 'var(--t3)' }}>
            {kol.label}
          </span>
        </div>
      ))}
    </div>
  )
}
