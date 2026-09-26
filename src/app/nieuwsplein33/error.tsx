'use client'

// Foutgrens voor de redactiepagina's. De kop en navigatie (layout) blijven
// staan; alleen de inhoud van de pagina valt weg. In productie geeft Next.js
// de foutmelding niet door aan de browser, dus hier staat alleen wat je kunt
// doen. Als het leesquotum van Turso op is, staat daarover een melding in de kop.
export default function RedactieFout({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="np-leeg">
      <p className="np-leeg-kop">Deze pagina kon niet worden geladen</p>
      <p>
        Waarschijnlijk gaf de database een fout. Staat er hierboven een melding over het leesquotum,
        dan werkt dit weer zodra Turso de database vrijgeeft.
      </p>
      <p style={{ marginTop: 16 }}>
        <button type="button" className="np-knop np-knop-stil" onClick={() => reset()}>Opnieuw proberen</button>
      </p>
    </div>
  )
}
