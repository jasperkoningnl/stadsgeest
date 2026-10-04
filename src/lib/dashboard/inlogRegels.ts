// Regels voor de rem op inlogpogingen. Zuivere functies zonder imports, zodat
// ze met de dashboardtests mee kunnen draaien (zie __tests__/inlogRegels.test.ts).

export const VENSTER_MINUTEN = 15

// Drie tellers per mislukte poging. De combinatie van naam en adres is de
// eigenlijke rem; de andere twee vangen raden over veel namen of veel adressen.
// Bewust niet alleen op naam: dan kan iemand een redacteur buitensluiten door
// vijf keer een fout wachtwoord bij haar naam te typen.
export const GRENZEN = { combinatie: 5, adres: 20, gebruiker: 30 } as const

export type Soort = keyof typeof GRENZEN

export function sleutels(gebruikersnaam: string, adresHash: string): Record<Soort, string> {
  const naam = gebruikersnaam.trim().toLowerCase().slice(0, 60)
  return {
    combinatie: `c:${naam}:${adresHash}`,
    adres: `a:${adresHash}`,
    gebruiker: `g:${naam}`,
  }
}

/** Mag er nog een poging worden gedaan, gegeven het aantal mislukte per sleutelsoort? */
export function magProberen(telling: Partial<Record<Soort, number>>): boolean {
  return (Object.keys(GRENZEN) as Soort[]).every((soort) => (telling[soort] ?? 0) < GRENZEN[soort])
}
