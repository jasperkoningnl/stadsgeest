'use client'

/**
 * Houdt bij hoeveel tips iemand vandaag heeft afgehandeld, zodat de vraag om
 * feedback komt op het moment dat het werk net is gedaan — en niet midden in
 * het lezen van een brondocument.
 *
 * Alles staat in localStorage, per browser. Bewust niet in de database: dit is
 * geen meetmateriaal maar alleen een timer, en een verkeerde stand hoort niet
 * meer te kunnen doen dan één balkje te vroeg of te laat tonen.
 *
 * Bij het verlaten van de pagina vragen (beforeunload) werkt niet: browsers
 * blokkeren dialogen op dat moment en een verzoek tijdens het sluiten wordt
 * afgekapt. Je kunt dan niemand nog iets laten typen.
 */

/** Vanaf hoeveel afgehandelde tips op één dag de balk verschijnt. */
export const DREMPEL = 3

/** Wordt afgevuurd na een vastgelegde beslissing, zodat de balk kan meekijken. */
export const GEBEURTENIS = 'np-beslissing-vastgelegd'

const SLEUTEL_TELLER = 'np-fb-beslissingen'
const SLEUTEL_GETOOND = 'np-fb-getoond'

/** jjjj-mm-dd in Nederlandse tijd; de dag draait om middernacht hier, niet in UTC. */
export function vandaag(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
}

function lees(sleutel: string): string | null {
  try { return localStorage.getItem(sleutel) } catch { return null }
}

function schrijf(sleutel: string, waarde: string): void {
  try { localStorage.setItem(sleutel, waarde) } catch { /* privémodus: dan geen balk */ }
}

/** Aantal beslissingen van vandaag; een stand van gisteren telt niet mee. */
export function standVandaag(): number {
  const ruw = lees(SLEUTEL_TELLER)
  if (!ruw) return 0
  const [dag, n] = ruw.split('|')
  return dag === vandaag() ? Number(n) || 0 : 0
}

/** Roept TipActies aan na een succesvol vastgelegde beslissing. */
export function noteerBeslissing(): void {
  schrijf(SLEUTEL_TELLER, `${vandaag()}|${standVandaag() + 1}`)
  window.dispatchEvent(new Event(GEBEURTENIS))
}

export function alGetoondVandaag(): boolean {
  return lees(SLEUTEL_GETOOND) === vandaag()
}

/** Eén keer per dag is genoeg — ook als er niets is ingevuld. */
export function markeerGetoond(): void {
  schrijf(SLEUTEL_GETOOND, vandaag())
  schrijf(SLEUTEL_TELLER, `${vandaag()}|0`)
}
