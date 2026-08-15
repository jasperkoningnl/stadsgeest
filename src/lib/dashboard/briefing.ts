// Parser voor het vaste briefingformat van de weegroutine.
//
// Elke briefing die de weger schrijft heeft dezelfde zes koppen (gecontroleerd
// op 15 augustus 2026: alle twintig tips voldoen): WAT WE WETEN, BETROKKEN
// PERSONEN EN ORGANISATIES, HOE DIT IS GEVONDEN, WAT WE NIET WETEN, WAT HIER
// NIET IN MAG, ELDERS GEBRACHT. Onder WAT WE WETEN staan genummerde feiten met
// achteraan "— bron, tier, URL, datum"; onder BETROKKEN staan regels in de vorm
// "- naam — rol — waarom relevant".
//
// De parser is bewust tolerant: ontbreekt de structuur, dan geeft `volledig`
// false terug en valt de pagina terug op de platte weergave. Liever lelijk
// getoond dan stilletjes informatie kwijt.

export interface BriefingFeit {
  tekst: string
  bron: string | null
  url: string | null
}

export interface Betrokkene {
  naam: string
  rol: string | null
  toelichting: string | null
}

export interface GeparsedeBriefing {
  volledig: boolean
  weten: BriefingFeit[]
  betrokkenen: Betrokkene[]
  gevonden: string | null
  nietWeten: string[]
  nietInMag: string[]
  elders: string | null
}

const KOPPEN = [
  'WAT WE WETEN',
  'BETROKKEN PERSONEN EN ORGANISATIES',
  'HOE DIT IS GEVONDEN',
  'WAT WE NIET WETEN',
  'WAT HIER NIET IN MAG',
  'ELDERS GEBRACHT',
] as const

function knipSecties(briefing: string): Map<string, string> {
  const secties = new Map<string, string>()
  // Posities van alle koppen die op een eigen regel staan
  const posities: { kop: string; start: number; eind: number }[] = []
  for (const kop of KOPPEN) {
    const m = briefing.match(new RegExp(`^\\s*${kop}\\s*$`, 'm'))
    if (m && m.index !== undefined) {
      posities.push({ kop, start: m.index, eind: m.index + m[0].length })
    }
  }
  posities.sort((a, b) => a.start - b.start)
  for (let i = 0; i < posities.length; i++) {
    const tot = i + 1 < posities.length ? posities[i + 1].start : briefing.length
    secties.set(posities[i].kop, briefing.slice(posities[i].eind, tot).trim())
  }
  return secties
}

// "feittekst — Bron, tier 1, https://…, 1 april 2026" → tekst + bronregel.
// De feittekst kan zelf gedachtestreepjes bevatten; we splitsen daarom op het
// láátste " — " waarvan de staart op een bronregel lijkt (URL of "tier").
function knipFeit(regel: string): BriefingFeit {
  const stukken = regel.split(/\s+—\s+/)
  if (stukken.length > 1) {
    const staart = stukken[stukken.length - 1]
    if (/https?:\/\/|tier\s*\d/i.test(staart)) {
      const tekst = stukken.slice(0, -1).join(' — ').trim()
      const url = (staart.match(/https?:\/\/\S+/) || [null])[0]
      const bron = staart.replace(/https?:\/\/\S+,?\s*/, '').replace(/\s{2,}/g, ' ').trim().replace(/^,|,$/g, '').trim()
      return { tekst, bron: bron || null, url: url ? url.replace(/[),.]+$/, '') : null }
    }
  }
  return { tekst: regel.trim(), bron: null, url: null }
}

function parseWeten(tekst: string): BriefingFeit[] {
  // Genummerde feiten; een feit kan over meerdere regels doorlopen.
  const delen = tekst.split(/\n\s*(?=\d+\.\s)/)
  const feiten: BriefingFeit[] = []
  for (const deel of delen) {
    const zonderNr = deel.replace(/^\s*\d+\.\s*/, '').replace(/\s*\n\s*/g, ' ').trim()
    if (zonderNr.length > 3) feiten.push(knipFeit(zonderNr))
  }
  return feiten
}

function parseBetrokkenen(tekst: string): Betrokkene[] {
  const uit: Betrokkene[] = []
  for (const regel of tekst.split(/\n\s*(?=[-•]\s)/)) {
    const schoon = regel.replace(/^[-•]\s*/, '').replace(/\s*\n\s*/g, ' ').trim()
    if (schoon.length < 2) continue
    const stukken = schoon.split(/\s+—\s+/)
    uit.push({
      naam: stukken[0].trim(),
      rol: stukken[1]?.trim() ?? null,
      toelichting: stukken.length > 2 ? stukken.slice(2).join(' — ').trim() : null,
    })
  }
  return uit
}

function parseLijst(tekst: string): string[] {
  const regels = tekst.split(/\n\s*(?=[-•]\s)/)
    .map((r) => r.replace(/^[-•]\s*/, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter((r) => r.length > 1)
  return regels.length > 0 ? regels : (tekst.trim() ? [tekst.replace(/\s*\n\s*/g, ' ').trim()] : [])
}

export function parseBriefing(briefing: string): GeparsedeBriefing {
  const secties = knipSecties(briefing)
  const weten = secties.has('WAT WE WETEN') ? parseWeten(secties.get('WAT WE WETEN')!) : []

  return {
    // De platte terugval geldt zodra het hart van de briefing er niet uitkomt.
    volledig: weten.length > 0,
    weten,
    betrokkenen: secties.has('BETROKKEN PERSONEN EN ORGANISATIES')
      ? parseBetrokkenen(secties.get('BETROKKEN PERSONEN EN ORGANISATIES')!)
      : [],
    gevonden: secties.get('HOE DIT IS GEVONDEN')?.replace(/\s*\n\s*/g, ' ').trim() || null,
    nietWeten: secties.has('WAT WE NIET WETEN') ? parseLijst(secties.get('WAT WE NIET WETEN')!) : [],
    nietInMag: secties.has('WAT HIER NIET IN MAG') ? parseLijst(secties.get('WAT HIER NIET IN MAG')!) : [],
    elders: secties.get('ELDERS GEBRACHT')?.replace(/\s*\n\s*/g, ' ').trim() || null,
  }
}

// Zoekterm voor de verkenner: bij "W. Stegeman" zoekt de achternaam beter dan
// het voorletter-plus-punt-geheel; bij organisaties gaat de rechtsvorm eraf.
export function verkennerTerm(naam: string): string {
  let n = naam.trim()
  n = n.replace(/\s*\b(B\.?V\.?|N\.?V\.?|C\.?V\.?|V\.?O\.?F\.?)\s*$/i, '').trim()
  const m = n.match(/^[A-Z]\.\s*(?:[A-Z]\.\s*)*(.+)$/)
  if (m) return m[1].trim()
  return n
}
