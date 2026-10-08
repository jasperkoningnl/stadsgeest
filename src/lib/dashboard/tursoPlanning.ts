const TIJDZONE = 'Europe/Amsterdam'

// Geplande jobs op de notebook, in Nederlandse tijd: de PM2-jobs (`pm2 jlist`),
// de Windows-taken Stadsgeest Intake en Detection, de dagelijkse Codex-weger
// en de supertip-run. Stand van 08-10-2026; pas dit aan als tijden veranderen.
// NDW draait elk kwartier en staat hier niet per uur in. Losse scripts en het
// dashboard zelf draaien op wisselende momenten.
const JOBS: { uur: number; naam: string; dagen?: string }[] = [
  { uur: 1, naam: 'scrape-browser' },
  { uur: 2, naam: 'scrape-dagelijks, scrape-ob' },
  { uur: 3, naam: 'scrape-wekelijks' },
  { uur: 3, naam: 'scrape-nieuw', dagen: 'ma' },
  { uur: 3, naam: 'scrape-subsidies', dagen: 'zo' },
  { uur: 4, naam: 'fetch-fulltext' },
  { uur: 5, naam: 'extract-entities, Intake (05:30)' },
  { uur: 6, naam: 'dwarsverbanden2-nacht, Detection (06:15)' },
  { uur: 9, naam: 'Stadsgeest-weger' },
  { uur: 9, naam: 'supertip-run (Codex)', dagen: 'do' },
  { uur: 11, naam: 'scrape-dagelijks-middag1' },
  { uur: 21, naam: 'scrape-dagelijks-avond' },
]

export function jobsOpUur(van: Date): string {
  const uur = Number(van.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TIJDZONE }))
  const dag = van.toLocaleDateString('nl-NL', { weekday: 'short', timeZone: TIJDZONE }).slice(0, 2)
  return JOBS.filter(j => j.uur === uur && (!j.dagen || j.dagen === dag)).map(j => j.naam).join(', ')
}
