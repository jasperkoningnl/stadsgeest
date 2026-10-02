// CBS StatLine-cijfers voor het woondashboard op /beleidsadviseur.
//
// Deze laag leest rechtstreeks uit de open data van het CBS en raakt Turso
// niet. Elke tabel is één HTTP-verzoek met een filter op gemeente Amersfoort
// (GM0307) of op de Amersfoortse wijken (WK0307xx); het resultaat staat
// 24 uur in unstable_cache. CBS werkt de meeste tabellen maandelijks of
// jaarlijks bij, dus dat kost niets aan actualiteit.
//
// Twee API's, omdat het CBS midden in een migratie zit:
// - de klassieke OData v3 (opendata.cbs.nl) levert de meeste tabellen volledig;
// - de nieuwe dataportaal-API (datasets.cbs.nl) is nodig voor de
//   woningkenmerken per wijk in "Kerncijfers wijken en buurten", die v3 voor
//   die tabel leeg laat (gecontroleerd op 2 oktober 2026).
//
// Tabelnummers en veldnamen zijn op 2 oktober 2026 gecontroleerd tegen de
// catalogus; de controlescripts staan beschreven in docs/HANDOFFS/2026-10.md.
import { unstable_cache } from 'next/cache'

const GEMEENTE = 'GM0307'
// CBS vult regiocodes in v3 aan tot zes tekens; 'NL01' heeft dus twee spaties.
const NEDERLAND = 'NL01  '
const CACHE_SECONDEN = 24 * 60 * 60
// Verhoog bij elke wijziging in een tabel, filter of verwerking.
const CACHE_VERSIE = 'v2'

const V3 = 'https://opendata.cbs.nl/ODataApi/odata/'
const V4 = 'https://datasets.cbs.nl/odata/v1/CBS/'

type Rij = Record<string, string | number | null>

async function haal(url: string): Promise<Rij[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`CBS ${res.status} voor ${url}`)
  const json = (await res.json()) as { value?: Rij[] }
  return json.value ?? []
}

/** OData v3: TypedDataSet met een $filter. Spaties en quotes worden hier gecodeerd. */
function v3(tabel: string, filter: string): Promise<Rij[]> {
  return haal(`${V3}${tabel}/TypedDataSet?$filter=${encodeURIComponent(filter)}&$format=json`)
}

/** Nieuwe dataportaal-API: Observations (één rij per meting). */
function v4(tabel: string, filter: string, select: string): Promise<Rij[]> {
  return haal(`${V4}${tabel}/Observations?$filter=${encodeURIComponent(filter)}&$select=${select}`)
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function n0(v: unknown): number {
  return n(v) ?? 0
}

/** CBS-periodecodes: 2024JJ00 (jaar), 2026MM08 (maand), 2026KW02 (kwartaal), 2025HJ01 (halfjaar). */
function periode(code: string): { soort: 'jaar' | 'maand' | 'kwartaal' | 'halfjaar'; jaar: number; nr: number } | null {
  const m = /^(\d{4})(JJ|MM|KW|HJ)(\d{2})$/.exec(code.trim())
  if (!m) return null
  const soort = m[2] === 'JJ' ? 'jaar' : m[2] === 'MM' ? 'maand' : m[2] === 'KW' ? 'kwartaal' : 'halfjaar'
  return { soort, jaar: Number(m[1]), nr: Number(m[3]) }
}

// ── Woningvoorraad en bouwproductie (86098NED, Levensloop van woningen) ─────

export interface VoorraadJaar {
  jaar: number
  begin: number
  vergund: number | null
  gestart: number
  nieuwbouw: number
  toevoegingen: number
  sloop: number
  onttrekkingen: number
  saldo: number
  eind: number
}

export interface VoorraadMaand {
  maand: string
  vergund: number | null
  gestart: number
  nieuwbouw: number
  toevoegingen: number
  sloop: number
  onttrekkingen: number
  saldo: number
  eind: number
}

export interface Woningvoorraad {
  perJaar: VoorraadJaar[]
  /** Laatste 24 maanden met maandcijfers. */
  maanden: VoorraadMaand[]
  /** Lopend jaar tot en met de laatste beschikbare maand. */
  ditJaar: { jaar: number; totMaand: number; nieuwbouw: number; toevoegingen: number; saldo: number; gestart: number }
  /** Dezelfde maanden een jaar eerder. */
  vorigJaarTotMaand: { nieuwbouw: number; toevoegingen: number; saldo: number; gestart: number }
  /** Nederland per jaar: groei van de voorraad in procenten, als ijkpunt. */
  nederland: { jaar: number; nieuwbouw: number; eind: number; groeiPct: number }[]
  laatsteMaand: string
}

function voorraadVelden(r: Rij) {
  return {
    vergund: n(r.VergundeNieuwbouw_2),
    gestart: n0(r.BouwGestart_3),
    nieuwbouw: n0(r.NieuwbouwTotaal_6),
    toevoegingen: n0(r.ToevoegingenTotaal_13),
    sloop: n0(r.Sloop_15),
    onttrekkingen: n0(r.Onttrekkingen_16),
    saldo: n0(r.SaldoVoorraad_21),
    eind: n0(r.EindstandVoorraad_22),
  }
}

async function laadWoningvoorraad(): Promise<Woningvoorraad> {
  const [rijen, nl] = await Promise.all([
    v3('86098NED', `RegioS eq '${GEMEENTE}' and Gebruiksfunctie eq 'A045364'`),
    v3('86098NED', `RegioS eq '${NEDERLAND}' and Gebruiksfunctie eq 'A045364' and Perioden ge '2015'`),
  ])
  const perJaar: VoorraadJaar[] = []
  const maanden: VoorraadMaand[] = []
  for (const r of rijen) {
    const p = periode(String(r.Perioden))
    if (!p) continue
    if (p.soort === 'jaar') perJaar.push({ jaar: p.jaar, begin: n0(r.BeginstandVoorraad_1), ...voorraadVelden(r) })
    if (p.soort === 'maand') maanden.push({ maand: `${p.jaar}-${String(p.nr).padStart(2, '0')}`, ...voorraadVelden(r) })
  }
  perJaar.sort((a, b) => a.jaar - b.jaar)
  maanden.sort((a, b) => a.maand.localeCompare(b.maand))
  const laatste = maanden[maanden.length - 1]
  const laatsteMaand = laatste?.maand ?? ''
  const jaar = Number(laatsteMaand.slice(0, 4))
  const totMaand = Number(laatsteMaand.slice(5, 7))
  const som = (lijst: VoorraadMaand[]) => ({
    nieuwbouw: lijst.reduce((s, m) => s + m.nieuwbouw, 0),
    toevoegingen: lijst.reduce((s, m) => s + m.toevoegingen, 0),
    saldo: lijst.reduce((s, m) => s + m.saldo, 0),
    gestart: lijst.reduce((s, m) => s + m.gestart, 0),
  })
  const dit = maanden.filter((m) => Number(m.maand.slice(0, 4)) === jaar)
  const vorig = maanden.filter((m) => Number(m.maand.slice(0, 4)) === jaar - 1 && Number(m.maand.slice(5, 7)) <= totMaand)
  const nederland = nl
    .map((r) => ({ p: periode(String(r.Perioden)), r }))
    .filter((x) => x.p?.soort === 'jaar')
    .map(({ p, r }) => {
      const begin = n0(r.BeginstandVoorraad_1)
      const eind = n0(r.EindstandVoorraad_22)
      return { jaar: p!.jaar, nieuwbouw: n0(r.NieuwbouwTotaal_6), eind, groeiPct: begin > 0 ? ((eind - begin) / begin) * 100 : 0 }
    })
    .sort((a, b) => a.jaar - b.jaar)
  return {
    perJaar,
    maanden: maanden.slice(-24),
    ditJaar: { jaar, totMaand, ...som(dit) },
    vorigJaarTotMaand: som(vorig),
    nederland,
    laatsteMaand,
  }
}

export const getWoningvoorraad = unstable_cache(laadWoningvoorraad, [`cbs-voorraad-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Eigendom en leegstand (86286NED) ────────────────────────────────────────

export interface EigendomJaar {
  jaar: number
  totaal: number
  koop: number
  huur: number
  corporatie: number
  particuliereVerhuur: number
  bedrijven: number
  overig: number
  leegstand: number
  /** Landelijk aandeel koop en corporatie in hetzelfde jaar, in procenten. */
  nlKoopPct: number | null
  nlCorporatiePct: number | null
}

async function laadEigendom(): Promise<EigendomJaar[]> {
  const [gm, nl] = await Promise.all([
    v3('86286NED', `RegioS eq '${GEMEENTE}'`),
    v3('86286NED', `RegioS eq '${NEDERLAND}' and StatusVanBewoning eq 'T001742'`),
  ])
  const nlPerJaar = new Map<number, Rij>()
  for (const r of nl) { const p = periode(String(r.Perioden)); if (p) nlPerJaar.set(p.jaar, r) }
  const perJaar = new Map<number, EigendomJaar>()
  for (const r of gm) {
    const p = periode(String(r.Perioden))
    if (!p) continue
    const j = perJaar.get(p.jaar) ?? {
      jaar: p.jaar, totaal: 0, koop: 0, huur: 0, corporatie: 0, particuliereVerhuur: 0, bedrijven: 0, overig: 0, leegstand: 0,
      nlKoopPct: null, nlCorporatiePct: null,
    }
    if (r.StatusVanBewoning === 'T001742') {
      j.totaal = n0(r.TotaleWoningvoorraad_1)
      j.koop = n0(r.Koopwoningen_2)
      j.huur = n0(r.TotaalHuurwoningen_3)
      j.corporatie = n0(r.EigendomWoningcorporaties_5)
      j.particuliereVerhuur = n0(r.EigendomNatuurlijkePersonen_4)
      j.bedrijven = n0(r.EigendomBVSEnNVS_6)
      j.overig = n0(r.EigendomOverigeRechtspersonen_7) + n0(r.EigendomOnbekend_8)
    } else if (r.StatusVanBewoning === 'A059383') {
      j.leegstand = n0(r.TotaleWoningvoorraad_1)
    }
    const nlr = nlPerJaar.get(p.jaar)
    if (nlr && n0(nlr.TotaleWoningvoorraad_1) > 0) {
      j.nlKoopPct = (n0(nlr.Koopwoningen_2) / n0(nlr.TotaleWoningvoorraad_1)) * 100
      j.nlCorporatiePct = (n0(nlr.EigendomWoningcorporaties_5) / n0(nlr.TotaleWoningvoorraad_1)) * 100
    }
    perJaar.set(p.jaar, j)
  }
  return [...perJaar.values()].sort((a, b) => a.jaar - b.jaar)
}

export const getEigendom = unstable_cache(laadEigendom, [`cbs-eigendom-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Bouwvergunningen nieuwbouw (83671NED) ───────────────────────────────────

export interface BouwvergunningKwartaal {
  kwartaal: string
  jaar: number
  nr: number
  totaal: number
  huur: number
  koop: number
  overheidCorporatie: number
  markt: number
  particulier: number
}

export interface Bouwvergunningen {
  kwartalen: BouwvergunningKwartaal[]
  perJaar: { jaar: number; totaal: number; huur: number; koop: number; overheidCorporatie: number; markt: number; particulier: number; volledig: boolean }[]
}

async function laadBouwvergunningen(): Promise<Bouwvergunningen> {
  const rijen = await v3('83671NED', `RegioS eq '${GEMEENTE}' and Perioden ge '2018'`)
  const perKwartaal = new Map<string, BouwvergunningKwartaal>()
  for (const r of rijen) {
    const p = periode(String(r.Perioden))
    if (!p || p.soort !== 'kwartaal') continue
    const sleutel = `${p.jaar}K${p.nr}`
    const k = perKwartaal.get(sleutel) ?? { kwartaal: sleutel, jaar: p.jaar, nr: p.nr, totaal: 0, huur: 0, koop: 0, overheidCorporatie: 0, markt: 0, particulier: 0 }
    const w = n0(r.Woningen_2)
    const opdr = String(r.Opdrachtgever)
    const eig = String(r.Eigendom)
    if (opdr === 'T001209' && eig === 'T001258') k.totaal = w
    else if (opdr === 'T001209' && eig === 'A028867') k.huur = w
    else if (opdr === 'T001209' && eig === 'A028868') k.koop = w
    else if (eig === 'T001258' && opdr === 'A028184') k.overheidCorporatie = w
    else if (eig === 'T001258' && opdr === 'A028185') k.markt = w
    else if (eig === 'T001258' && opdr === 'A028186') k.particulier = w
    perKwartaal.set(sleutel, k)
  }
  const kwartalen = [...perKwartaal.values()].sort((a, b) => a.jaar - b.jaar || a.nr - b.nr)
  const jaren = new Map<number, Bouwvergunningen['perJaar'][number]>()
  for (const k of kwartalen) {
    const j = jaren.get(k.jaar) ?? { jaar: k.jaar, totaal: 0, huur: 0, koop: 0, overheidCorporatie: 0, markt: 0, particulier: 0, volledig: false }
    j.totaal += k.totaal; j.huur += k.huur; j.koop += k.koop
    j.overheidCorporatie += k.overheidCorporatie; j.markt += k.markt; j.particulier += k.particulier
    jaren.set(k.jaar, j)
  }
  for (const j of jaren.values()) j.volledig = kwartalen.filter((k) => k.jaar === j.jaar).length === 4
  return { kwartalen: kwartalen.slice(-12), perJaar: [...jaren.values()].sort((a, b) => a.jaar - b.jaar) }
}

export const getBouwvergunningen = unstable_cache(laadBouwvergunningen, [`cbs-bouwvergunningen-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Woningwaarde (85036NED WOZ, 83625NED verkoopprijzen) ────────────────────

export interface WaardeJaar {
  jaar: number
  /** Gemiddelde WOZ-waarde in duizenden euro's, per eigendomsvorm. */
  wozTotaal: number | null
  wozKoop: number | null
  wozCorporatie: number | null
  wozOverigeVerhuur: number | null
  wozNederland: number | null
  /** Gemiddelde verkoopprijs bestaande koopwoningen in euro's (jaar ervoor beschikbaar). */
  verkoopprijs: number | null
}

async function laadWaarde(): Promise<WaardeJaar[]> {
  const [woz, wozNl, prijs] = await Promise.all([
    v3('85036NED', `RegioS eq '${GEMEENTE}'`),
    v3('85036NED', `RegioS eq '${NEDERLAND}' and Eigendom eq 'T001132'`),
    v3('83625NED', `RegioS eq '${GEMEENTE}' and Perioden ge '2015'`),
  ])
  const perJaar = new Map<number, WaardeJaar>()
  const rij = (jaar: number) => {
    const j = perJaar.get(jaar) ?? { jaar, wozTotaal: null, wozKoop: null, wozCorporatie: null, wozOverigeVerhuur: null, wozNederland: null, verkoopprijs: null }
    perJaar.set(jaar, j)
    return j
  }
  for (const r of woz) {
    const p = periode(String(r.Perioden)); if (!p) continue
    const j = rij(p.jaar); const w = n(r.GemiddeldeWOZWaardeVanWoningen_1)
    if (r.Eigendom === 'T001132') j.wozTotaal = w
    else if (r.Eigendom === '1014800') j.wozKoop = w
    else if (r.Eigendom === 'A047047') j.wozCorporatie = w
    else if (r.Eigendom === 'A047048') j.wozOverigeVerhuur = w
  }
  for (const r of wozNl) { const p = periode(String(r.Perioden)); if (p) rij(p.jaar).wozNederland = n(r.GemiddeldeWOZWaardeVanWoningen_1) }
  for (const r of prijs) { const p = periode(String(r.Perioden)); if (p) rij(p.jaar).verkoopprijs = n(r.GemiddeldeVerkoopprijs_1) }
  return [...perJaar.values()].filter((j) => j.jaar >= 2019).sort((a, b) => a.jaar - b.jaar)
}

export const getWaarde = unstable_cache(laadWaarde, [`cbs-waarde-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Huishoudens (71486ned) en bevolking naar leeftijd (85644NED) ────────────

export interface HuishoudensJaar {
  jaar: number
  totaal: number
  eenpersoons: number
  metKinderen: number
  zonderKinderen: number
  /** Huishoudens met een referentiepersoon van 65 jaar of ouder, resp. 75 jaar of ouder. */
  ref65plus: number
  ref75plus: number
}

const LEEFTIJD_65PLUS = ['71400', '71500', '71600', '71700', '71800', '71900', '22000']
const LEEFTIJD_75PLUS = ['71600', '71700', '71800', '71900', '22000']

async function laadHuishoudens(): Promise<HuishoudensJaar[]> {
  const codes = ['10000', ...LEEFTIJD_65PLUS]
  const rijen = await v3('71486ned', `RegioS eq '${GEMEENTE}' and Perioden ge '2014' and (${codes.map((c) => `LeeftijdReferentiepersoon eq '${c}'`).join(' or ')})`)
  const perJaar = new Map<number, HuishoudensJaar>()
  for (const r of rijen) {
    const p = periode(String(r.Perioden)); if (!p) continue
    const j = perJaar.get(p.jaar) ?? { jaar: p.jaar, totaal: 0, eenpersoons: 0, metKinderen: 0, zonderKinderen: 0, ref65plus: 0, ref75plus: 0 }
    const code = String(r.LeeftijdReferentiepersoon).trim()
    const tot = n0(r.TotaalParticuliereHuishoudens_1)
    if (code === '10000') {
      j.totaal = tot
      j.eenpersoons = n0(r.Eenpersoonshuishouden_2)
      j.metKinderen = n0(r.MeerpersoonshuishoudensMetKinderen_5)
      j.zonderKinderen = n0(r.MeerpersoonshuishoudensZonderKinderen_4)
    } else {
      if (LEEFTIJD_65PLUS.includes(code)) j.ref65plus += tot
      if (LEEFTIJD_75PLUS.includes(code)) j.ref75plus += tot
    }
    perJaar.set(p.jaar, j)
  }
  return [...perJaar.values()].sort((a, b) => a.jaar - b.jaar)
}

export const getHuishoudens = unstable_cache(laadHuishoudens, [`cbs-huishoudens-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

export interface BevolkingJaar {
  jaar: number
  totaal: number
  j65tot75: number
  j75tot85: number
  j85plus: number
}

async function laadBevolking(): Promise<BevolkingJaar[]> {
  const codes = ['10000', '71400', '71500', '71600', '71700', '71800', '71900', '22000']
  const rijen = await v3('85644NED', `RegioS eq '${GEMEENTE}' and Geslacht eq 'T001038' and Nationaliteit eq 'T001059' and (${codes.map((c) => `Leeftijd eq '${c}'`).join(' or ')})`)
  const perJaar = new Map<number, BevolkingJaar>()
  for (const r of rijen) {
    const p = periode(String(r.Perioden)); if (!p) continue
    const j = perJaar.get(p.jaar) ?? { jaar: p.jaar, totaal: 0, j65tot75: 0, j75tot85: 0, j85plus: 0 }
    const code = String(r.Leeftijd).trim()
    const w = n0(r.Bevolking_1)
    if (code === '10000') j.totaal = w
    else if (code === '71400' || code === '71500') j.j65tot75 += w
    else if (code === '71600' || code === '71700') j.j75tot85 += w
    else j.j85plus += w
    perJaar.set(p.jaar, j)
  }
  return [...perJaar.values()].sort((a, b) => a.jaar - b.jaar)
}

export const getBevolking = unstable_cache(laadBevolking, [`cbs-bevolking-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

/** Regionale bevolkingsprognose PBL/CBS 2023-2050 (85171NED), alleen totaal; in duizenden. */
export interface PrognoseJaar { jaar: number; bevolkingDuizend: number }

async function laadPrognose(): Promise<PrognoseJaar[]> {
  const rijen = await v3('85171NED', `RegioIndeling2021 eq '${GEMEENTE}' and Leeftijd eq '10000' and Geslacht eq 'T001038'`)
  return rijen
    .map((r) => ({ p: periode(String(r.Perioden)), w: n(r.TotaleBevolking_1) }))
    .filter((x) => x.p && x.w !== null)
    .map((x) => ({ jaar: x.p!.jaar, bevolkingDuizend: x.w! }))
    .sort((a, b) => a.jaar - b.jaar)
}

export const getPrognose = unstable_cache(laadPrognose, [`cbs-prognose-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Verhuizingen (60048ned) ─────────────────────────────────────────────────

export interface VerhuizingenJaar { jaar: number; binnen: number; gevestigd: number; vertrokken: number; saldo: number }

async function laadVerhuizingen(): Promise<VerhuizingenJaar[]> {
  const rijen = await v3('60048ned', `RegioS eq '${GEMEENTE}' and Perioden ge '2015'`)
  return rijen
    .map((r) => ({ p: periode(String(r.Perioden)), r }))
    .filter((x) => x.p?.soort === 'jaar')
    .map(({ p, r }) => ({
      jaar: p!.jaar,
      binnen: n0(r.BinnenGemeentenVerhuisdePersonen_1),
      gevestigd: n0(r.TussenGemeentenGevestigdePersonen_2),
      vertrokken: n0(r.TussenGemeentenVertrokkenPersonen_3),
      saldo: n0(r.BinnenlandsMigratiesaldo_4),
    }))
    .sort((a, b) => a.jaar - b.jaar)
}

export const getVerhuizingen = unstable_cache(laadVerhuizingen, [`cbs-verhuizingen-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Wijken: bevolking 2026 (86358NED), woningen 2024 (85984NED), Wmo 2025 (86158NED) ──

export interface Wijk {
  code: string
  naam: string
  /** Bevolking per 1 januari 2026. */
  inwoners: number
  j65tot80: number
  j80plus: number
  huishoudens: number
  eenpersoons: number
  /** Woningkenmerken per 1 januari 2024 (nieuwste jaar met wijkcijfers). */
  woningen: number | null
  nieuwbouw: number | null
  wozDuizend: number | null
  meergezinsPct: number | null
  koopPct: number | null
  huurPct: number | null
  corporatiePct: number | null
  bouwjaarRecentPct: number | null
  laagInkomenPct: number | null
  /** Wmo-cliënten 2025 (heel jaar), per 1.000 inwoners en absoluut. */
  wmoPer1000: number | null
  wmoClienten: number | null
  wmoThuis: number | null
  wmoHulpHuishouden: number | null
  wmoHulpmiddelen: number | null
  wmoVerblijf: number | null
}

export interface WijkOverzicht {
  wijken: Wijk[]
  gemeente: { inwoners: number; j65tot80: number; j80plus: number; huishoudens: number; eenpersoons: number; wmoPer1000: number | null; wmoClienten: number | null }
  bevolkingsjaar: number
  woningjaar: number
  wmoJaar: number
}

const KWB_MATEN = {
  woningen: 'M000297', nieuwbouw: 'M003003', woz: 'M001642', meergezins: 'ZW10340',
  koop: '1014800', huur: '1014850_2', corporatie: 'A047047', bouwjaarRecent: 'M008210', laagInkomen: 'D000186',
} as const

const WMO_TYPEN = { totaal: 'T001024', thuis: 'A019506', hulpHuishouden: 'A019507', verblijf: 'A019508', hulpmiddelen: 'A019509' } as const

async function laadWijken(): Promise<WijkOverzicht> {
  const maten = Object.values(KWB_MATEN).map((m) => `'${m}'`).join(',')
  const [bevolking, gemeente, namen, woningen, wmo] = await Promise.all([
    v3('86358NED', `startswith(WijkenEnBuurten,'WK0307')`),
    v3('86358NED', `WijkenEnBuurten eq 'GM0307    '`),
    haal(`${V3}86358NED/WijkenEnBuurten?$filter=${encodeURIComponent("startswith(Key,'WK0307')")}&$format=json`),
    v4('85984NED', `startswith(WijkenEnBuurten,'WK0307') and Measure in (${maten})`, 'WijkenEnBuurten,Measure,Value'),
    v3('86158NED', `startswith(Wijken,'WK0307') and Perioden eq '2025JJ00'`).then(async (w) => [...w, ...(await v3('86158NED', `Wijken eq 'GM0307    ' and Perioden eq '2025JJ00'`))]),
  ])
  const naam = new Map<string, string>(namen.map((r) => [String(r.Key).trim(), String(r.Title).trim()]))
  const perWijk = new Map<string, Wijk>()
  for (const r of bevolking) {
    const code = String(r.WijkenEnBuurten).trim()
    perWijk.set(code, {
      code, naam: naam.get(code) ?? code,
      inwoners: n0(r.AantalInwoners_5), j65tot80: n0(r.k_65JaarTot80Jaar_12), j80plus: n0(r.k_80JaarOfOuder_13),
      huishoudens: n0(r.HuishoudensTotaal_30), eenpersoons: n0(r.Eenpersoonshuishoudens_31),
      woningen: null, nieuwbouw: null, wozDuizend: null, meergezinsPct: null, koopPct: null, huurPct: null, corporatiePct: null, bouwjaarRecentPct: null, laagInkomenPct: null,
      wmoPer1000: null, wmoClienten: null, wmoThuis: null, wmoHulpHuishouden: null, wmoHulpmiddelen: null, wmoVerblijf: null,
    })
  }
  for (const r of woningen) {
    const w = perWijk.get(String(r.WijkenEnBuurten).trim())
    if (!w) continue
    const v = n(r.Value)
    switch (String(r.Measure)) {
      case KWB_MATEN.woningen: w.woningen = v; break
      case KWB_MATEN.nieuwbouw: w.nieuwbouw = v; break
      case KWB_MATEN.woz: w.wozDuizend = v; break
      case KWB_MATEN.meergezins: w.meergezinsPct = v; break
      case KWB_MATEN.koop: w.koopPct = v; break
      case KWB_MATEN.huur: w.huurPct = v; break
      case KWB_MATEN.corporatie: w.corporatiePct = v; break
      case KWB_MATEN.bouwjaarRecent: w.bouwjaarRecentPct = v; break
      case KWB_MATEN.laagInkomen: w.laagInkomenPct = v; break
    }
  }
  let gemeenteWmo: { per1000: number | null; clienten: number | null } = { per1000: null, clienten: null }
  for (const r of wmo) {
    const code = String(r.Wijken).trim()
    const type = String(r.TypeMaatwerkvoorziening)
    if (code === GEMEENTE) {
      if (type === WMO_TYPEN.totaal) gemeenteWmo = { per1000: n(r.WmoClientenPer1000Inwoners_6), clienten: n(r.WmoClienten_5) }
      continue
    }
    const w = perWijk.get(code)
    if (!w) continue
    const c = n(r.WmoClienten_5)
    if (type === WMO_TYPEN.totaal) { w.wmoClienten = c; w.wmoPer1000 = n(r.WmoClientenPer1000Inwoners_6) }
    else if (type === WMO_TYPEN.thuis) w.wmoThuis = c
    else if (type === WMO_TYPEN.hulpHuishouden) w.wmoHulpHuishouden = c
    else if (type === WMO_TYPEN.verblijf) w.wmoVerblijf = c
    else if (type === WMO_TYPEN.hulpmiddelen) w.wmoHulpmiddelen = c
  }
  const g = gemeente[0] ?? {}
  return {
    // Bedrijventerreinen en bosgebied hebben nauwelijks inwoners; die vertekenen elke ranglijst.
    wijken: [...perWijk.values()].filter((w) => w.inwoners >= 500).sort((a, b) => b.inwoners - a.inwoners),
    gemeente: {
      inwoners: n0(g.AantalInwoners_5), j65tot80: n0(g.k_65JaarTot80Jaar_12), j80plus: n0(g.k_80JaarOfOuder_13),
      huishoudens: n0(g.HuishoudensTotaal_30), eenpersoons: n0(g.Eenpersoonshuishoudens_31),
      wmoPer1000: gemeenteWmo.per1000, wmoClienten: gemeenteWmo.clienten,
    },
    bevolkingsjaar: 2026,
    woningjaar: 2024,
    wmoJaar: 2025,
  }
}

export const getWijken = unstable_cache(laadWijken, [`cbs-wijken-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Wmo-voorzieningen gemeente: stand, instroom, uitstroom (86051NED) ───────

export interface WmoJaar {
  jaar: number
  /** Cliënten met een maatwerkvoorziening op 1 januari, instroom en uitstroom in het jaar. */
  stand: number | null
  instroom: number | null
  uitstroom: number | null
  thuisStand: number | null
  hulpHuishoudenStand: number | null
  hulpmiddelenStand: number | null
  verblijfStand: number | null
}

async function laadWmo(): Promise<WmoJaar[]> {
  const rijen = await v3('86051NED', `RegioS eq '${GEMEENTE}'`)
  const perJaar = new Map<number, WmoJaar>()
  for (const r of rijen) {
    const p = periode(String(r.Perioden)); if (!p || p.soort !== 'jaar') continue
    const j = perJaar.get(p.jaar) ?? { jaar: p.jaar, stand: null, instroom: null, uitstroom: null, thuisStand: null, hulpHuishoudenStand: null, hulpmiddelenStand: null, verblijfStand: null }
    const type = String(r.TypeMaatwerkvoorziening)
    if (type === WMO_TYPEN.totaal) { j.stand = n(r.Stand_1); j.instroom = n(r.Instroom_2); j.uitstroom = n(r.Uitstroom_3) }
    else if (type === WMO_TYPEN.thuis) j.thuisStand = n(r.Stand_1)
    else if (type === WMO_TYPEN.hulpHuishouden) j.hulpHuishoudenStand = n(r.Stand_1)
    else if (type === WMO_TYPEN.hulpmiddelen) j.hulpmiddelenStand = n(r.Stand_1)
    else if (type === WMO_TYPEN.verblijf) j.verblijfStand = n(r.Stand_1)
    perJaar.set(p.jaar, j)
  }
  return [...perJaar.values()].filter((j) => j.stand !== null).sort((a, b) => a.jaar - b.jaar)
}

export const getWmo = unstable_cache(laadWmo, [`cbs-wmo-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

/** Bronverwijzingen voor de verantwoording onder aan de tabbladen. */
export const CBS_BRONNEN = [
  { tabel: '86098NED', titel: 'Levensloop van woningen en niet-woningen; gebruiksfunctie, regio', gebruik: 'woningvoorraad, nieuwbouw, sloop, toevoegingen en onttrekkingen per maand en jaar' },
  { tabel: '86286NED', titel: 'Voorraad woningen; eigendom, type eigenaar, status van bewoning, regio', gebruik: 'koop, huur, corporatiebezit en leegstand per 1 januari' },
  { tabel: '83671NED', titel: 'Bouwvergunningen woonruimten; type, opdrachtgever, eigendom, gemeente', gebruik: 'verleende bouwvergunningen nieuwbouw per kwartaal' },
  { tabel: '85036NED', titel: 'Gemiddelde WOZ-waarde van woningen; eigendom, regio', gebruik: 'WOZ-waarde per eigendomsvorm' },
  { tabel: '83625NED', titel: 'Bestaande koopwoningen; gemiddelde verkoopprijzen, regio', gebruik: 'gemiddelde verkoopprijs per jaar' },
  { tabel: '71486ned', titel: 'Huishoudens; samenstelling, grootte, regio, 1 januari', gebruik: 'huishoudens, eenpersoonshuishoudens en huishoudens van 65-plussers' },
  { tabel: '85644NED', titel: 'Bevolking; geslacht, leeftijd, nationaliteit en regio, 1 januari', gebruik: 'inwoners naar leeftijd' },
  { tabel: '85171NED', titel: 'Regionale prognose 2023-2050; bevolking, regio-indeling 2021 (PBL/CBS)', gebruik: 'verwachte bevolkingsomvang' },
  { tabel: '60048ned', titel: 'Verhuisde personen; binnen gemeenten, tussen gemeenten, regio', gebruik: 'vestiging, vertrek en verhuizingen binnen de stad' },
  { tabel: '86358NED', titel: 'Kerncijfers wijken en buurten 2026', gebruik: 'inwoners, 65-plussers, 80-plussers en huishoudens per wijk' },
  { tabel: '85984NED', titel: 'Kerncijfers wijken en buurten 2024', gebruik: 'woningvoorraad, eigendom, WOZ, bouwjaar en inkomen per wijk' },
  { tabel: '86158NED', titel: 'Wmo-cliënten; type maatwerkvoorziening, wijken, 2025', gebruik: 'Wmo-cliënten per wijk en per 1.000 inwoners' },
  { tabel: '86051NED', titel: 'Wmo-voorzieningen; stand, instroom, uitstroom, regio', gebruik: 'Wmo-cliënten per jaar, instroom en uitstroom' },
] as const

export function cbsUrl(tabel: string): string {
  return `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${tabel}/table`
}
