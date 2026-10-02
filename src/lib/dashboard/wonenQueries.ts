/* eslint-disable @typescript-eslint/no-explicit-any */
// Queries voor het woondashboard op /beleidsadviseur.
//
// Doelgroep is de beleidsadviseur wonen van de gemeente Amersfoort. Alles hier
// is feitelijk en herleidbaar naar een officiële bron: bekendmakingen,
// raadsstukken, dPi-opgaven van corporaties, het subsidieregister en het
// feitenregister van het dossier Woningbouw en wonen. Redactionele tips, scores
// en beslissingen van de redactie blijven buiten dit dashboard.
//
// Turso telt elke bekeken rij (zie docs/DATABASE-LEZEN.md). Daarom loopt elke
// query hier via een geïndexeerde kolom (source_id, dossier_id, jaar) en staat
// het geheel in unstable_cache met een lange revalidatie: de bronnen worden
// hooguit dagelijks bijgewerkt, dus zes uur cache kost niets aan actualiteit.
import { unstable_cache } from 'next/cache'
import { q, qOne } from '@/lib/turso'

/** Bron-id's zoals ze in de tabel `sources` staan. */
const BRON = {
  omgevingsvergunningen: 109,
  gemeentebladOverig: 111,
  verordeningen: 121,
  beleidsregels: 122,
  schriftelijkeVragen: 115,
  moties: 116,
  amendementen: 117,
  raadsinformatiebrieven: 118,
  ingekomenStukken: 119,
  vergaderingen: 120,
  alliantie: 20,
  dpi: 151,
} as const

const RAAD_BRONNEN = [
  BRON.schriftelijkeVragen, BRON.moties, BRON.amendementen,
  BRON.raadsinformatiebrieven, BRON.ingekomenStukken, BRON.vergaderingen,
]
const REGEL_BRONNEN = [BRON.gemeentebladOverig, BRON.verordeningen, BRON.beleidsregels]

/** Het dossier Woningbouw en wonen en de aanpalende dossiers. */
export const WOON_DOSSIER_ID = 4
const AANPALENDE_DOSSIERS = [19, 14, 10] // Skaeve Huse, asielopvang/flexwoningen, legalisatie

/**
 * Woningcorporaties met opgaven voor Amersfoort in dPi 2025. Namen zijn
 * gecontroleerd tegen het Handelsregister (2 oktober 2026); de database kent
 * alleen De Alliantie bij naam.
 */
export const CORPORATIES: Record<string, string> = {
  '39048769': 'De Alliantie',
  '30038487': 'Portaal',
  '31014972': 'Omnia Wonen',
  '33107894': 'Woonzorg Nederland',
  '30038801': 'Habion',
  '30092565': 'SSH (studentenhuisvesting)',
  '31015064': 'Omthuis (voorheen Woningstichting Leusden)',
  '87052253': 'Hof Wonen',
}

const CACHE_SECONDEN = 6 * 60 * 60
// De datacache van Next overleeft een nieuwe build. Verhoog deze versie bij
// elke wijziging in een query of in de verwerking, anders blijft de oude
// uitkomst tot de revalidatie staan.
const CACHE_VERSIE = 'v2'

// Woordenlijst voor "woon-gerelateerd" in titels van raadsstukken en regels.
// LIKE kent geen woordgrenzen, dus de meeste patronen eisen een spatie of het
// begin van de titel ervoor: 'buitengewoon' is geen 'woon', 'inhuur' geen 'huur'
// en 'bedrijfshuisvesting' geen 'huisvesting'.
const WOON_PATRONEN = [
  '%woning%', 'wonen%', '% wonen%', 'woon%', '% woon%', 'huur%', '% huur%', '%verhuur%',
  '%omgevingsplan%', '%grondexploitatie%', '%corporatie%', 'huisvesting%', '% huisvesting%',
  '%starterslening%', '%flexwon%',
]
function woonWaar(kolom: string): { sql: string; args: string[] } {
  return {
    sql: `(${WOON_PATRONEN.map(() => `${kolom} LIKE ?`).join(' OR ')})`,
    args: [...WOON_PATRONEN],
  }
}

/**
 * Soort besluit, afgeleid van de vaste openingswoorden van de bekendmaking.
 * De gemeente publiceert via Officiële Bekendmakingen met een vast stramien;
 * "overig" vangt de uitzonderingen (rectificaties, kennisgevingen zonder stramien).
 */
const SOORT_SQL = `CASE
  WHEN title LIKE 'Ontvangen aanvraag%' OR title LIKE 'Kennisgeving ontvangen aanvraag%' THEN 'aanvraag'
  WHEN title LIKE 'Verleend%' THEN 'verleend'
  WHEN title LIKE 'Weigering%' OR title LIKE 'Geweigerd%' THEN 'geweigerd'
  WHEN title LIKE '%beslistermijn%' OR title LIKE 'Verlenging%' THEN 'verlengd'
  WHEN title LIKE '%buiten behandeling%' THEN 'buiten_behandeling'
  WHEN title LIKE '%intrekken%' OR title LIKE '%ingetrokken%' THEN 'ingetrokken'
  WHEN title LIKE '%vergunningvrij%' OR title LIKE '%geen vergunning%' THEN 'vergunningvrij'
  ELSE 'overig' END`

export type VergunningSoort = 'aanvraag' | 'verleend' | 'geweigerd' | 'verlengd' | 'buiten_behandeling' | 'ingetrokken' | 'vergunningvrij' | 'overig'

export const SOORT_LABEL: Record<VergunningSoort, string> = {
  aanvraag: 'aanvraag ontvangen',
  verleend: 'verleend',
  geweigerd: 'geweigerd',
  verlengd: 'beslistermijn verlengd',
  buiten_behandeling: 'buiten behandeling',
  ingetrokken: 'ingetrokken',
  vergunningvrij: 'vergunningvrij',
  overig: 'overig',
}

/**
 * Thema van de activiteit, afgeleid van de titel. Een vergunning kan in meer
 * thema's vallen (een dakopbouw voor een extra woning is uitbreiding én
 * woningtoevoeging); de thema's zijn dus niet optelbaar tot het totaal.
 */
export const THEMAS = [
  { id: 'woningtoevoeging', label: 'Woningen toevoegen in bestaande panden', termen: ['splits', 'transform', 'kamerverhuur', 'studio', 'naar wonen', 'tot wonen', 't.b.v. wonen', 'tbv wonen', 'tot % appartementen', 'naar % appartementen', 'tot % woningen', 'naar % woningen', 'appartement op de', 'appartement achter', 'realiseren van % woningen', 'realiseren van % appartementen', 'beneden- en bovenwoning', 'boven de winkel', 'bovenwoning'] },
  { id: 'nieuwbouw', label: 'Nieuwbouw woning(en)', termen: ['nieuwbouw', 'bouwen van een woning', 'bouwen van % woningen', 'bouw van % woningen', 'bouwen van % appartementen', 'bouw van % appartementen', 'pand met % appartementen'] },
  { id: 'uitbreiding', label: 'Uitbreiden bestaande woning', termen: ['dakopbouw', 'dakkapel', 'uitbouw', 'uitbreiden', 'aanbouw', 'veranda', 'nokverhoging', 'verhogen van de kap'] },
  { id: 'verduurzaming', label: 'Verduurzaming', termen: ['isolat', 'verduurza', 'zonnepan', 'warmtepomp', 'kozijn'] },
  { id: 'sloop', label: 'Sloop', termen: ['slopen', 'sloop'] },
  { id: 'kap', label: 'Bomen kappen', termen: ['kappen', 'vellen', 'boom', 'bomen'] },
  { id: 'monument', label: 'Monument', termen: ['monument'] },
] as const

export type ThemaId = (typeof THEMAS)[number]['id']

function themaSql(termen: readonly string[]): string {
  // Een thema is een OR van LIKE's; % in een term is een bewuste joker.
  return `(${termen.map((t) => `title LIKE '%${t.replace(/'/g, "''")}%'`).join(' OR ')})`
}

export interface MaandTelling {
  maand: string
  aanvraag: number
  verleend: number
  overig: number
  totaal: number
}

export interface ThemaTelling {
  id: ThemaId
  label: string
  totaal: number
  verleend: number
  aanvraag: number
}

export interface WijkTelling {
  wijk: string
  code: string
  totaal: number
  verleend: number
}

export interface VergunningRegel {
  id: number
  titel: string
  url: string | null
  datum: string
  soort: VergunningSoort
}

export interface VergunningenOverzicht {
  /** Eerste en laatste publicatiedatum in de gevolgde periode. */
  van: string | null
  tot: string | null
  totaal: number
  perSoort: Record<VergunningSoort, number>
  laatste30: Record<VergunningSoort, number>
  perMaand: MaandTelling[]
  perThema: ThemaTelling[]
  perWijk: WijkTelling[]
  /** Aandeel bekendmakingen met een exact gekoppeld BAG-adres. */
  gekoppeldAandeel: number
  woningtoevoegingen: VergunningRegel[]
}

const DATUM = `substr(COALESCE(published_at, scraped_at), 1, 10)`

async function laadVergunningen(): Promise<VergunningenOverzicht> {
  const bron = BRON.omgevingsvergunningen
  const [bereik, soorten, soorten30, maanden, themas, wijken, koppeling, toevoegingen] = await Promise.all([
    qOne<any>(`SELECT MIN(${DATUM}) AS van, MAX(${DATUM}) AS tot, COUNT(*) AS n FROM raw_items WHERE source_id = ?`, [bron]),
    q<any>(`SELECT ${SOORT_SQL} AS soort, COUNT(*) AS n FROM raw_items WHERE source_id = ? GROUP BY soort`, [bron]),
    q<any>(`SELECT ${SOORT_SQL} AS soort, COUNT(*) AS n FROM raw_items WHERE source_id = ? AND ${DATUM} >= date('now', '-30 days') GROUP BY soort`, [bron]),
    q<any>(
      `SELECT substr(${DATUM}, 1, 7) AS maand, ${SOORT_SQL} AS soort, COUNT(*) AS n
       FROM raw_items WHERE source_id = ? GROUP BY maand, soort ORDER BY maand`,
      [bron],
    ),
    qOne<any>(
      `SELECT ${THEMAS.map((t) => `SUM(${themaSql(t.termen)}) AS ${t.id}, SUM(${themaSql(t.termen)} AND title LIKE 'Verleend%') AS ${t.id}_verleend, SUM(${themaSql(t.termen)} AND (title LIKE 'Ontvangen aanvraag%' OR title LIKE 'Kennisgeving ontvangen aanvraag%')) AS ${t.id}_aanvraag`).join(', ')}
       FROM raw_items WHERE source_id = ?`,
      [bron],
    ),
    // Buurtcode BU0307xxyy → wijkcode WK0307xx; area_versions kent beide.
    q<any>(
      `SELECT 'WK' || substr(da.buurtcode, 3, 6) AS code, COUNT(DISTINCT da.raw_item_id) AS n,
              COUNT(DISTINCT CASE WHEN ri.title LIKE 'Verleend%' THEN da.raw_item_id END) AS verleend
       FROM document_addresses da JOIN raw_items ri ON ri.id = da.raw_item_id
       WHERE ri.source_id = ? AND da.match_status = 'exact' AND da.buurtcode LIKE 'BU0307%'
       GROUP BY code ORDER BY n DESC`,
      [bron],
    ),
    qOne<any>(
      `SELECT COUNT(DISTINCT da.raw_item_id) AS n FROM document_addresses da JOIN raw_items ri ON ri.id = da.raw_item_id
       WHERE ri.source_id = ? AND da.match_status = 'exact'`,
      [bron],
    ),
    q<any>(
      `SELECT id, title AS titel, external_url AS url, ${DATUM} AS datum, ${SOORT_SQL} AS soort
       FROM raw_items WHERE source_id = ? AND ${themaSql(THEMAS[0].termen)}
         AND NOT (title LIKE '%kappen%' OR title LIKE '%tijdelijk gebruik van de weg%' OR title LIKE '%dakkapel%'
                  OR title LIKE '%verduurza%' OR title LIKE '%renover%' OR title LIKE '%isol%')
       ORDER BY datum DESC, id DESC LIMIT 25`,
      [bron],
    ),
  ])

  const wijkNamen = await q<any>(
    `SELECT area_code, area_name FROM area_versions WHERE municipality_code = 'GM0307' AND area_code LIKE 'WK%'`,
  )
  const naam = new Map<string, string>(wijkNamen.map((r) => [r.area_code, r.area_name]))

  const leeg = (): Record<VergunningSoort, number> => ({
    aanvraag: 0, verleend: 0, geweigerd: 0, verlengd: 0, buiten_behandeling: 0, ingetrokken: 0, vergunningvrij: 0, overig: 0,
  })
  const perSoort = leeg()
  for (const r of soorten) perSoort[r.soort as VergunningSoort] = Number(r.n)
  const laatste30 = leeg()
  for (const r of soorten30) laatste30[r.soort as VergunningSoort] = Number(r.n)

  const perMaandMap = new Map<string, MaandTelling>()
  for (const r of maanden) {
    const m = perMaandMap.get(r.maand) ?? { maand: r.maand, aanvraag: 0, verleend: 0, overig: 0, totaal: 0 }
    const n = Number(r.n)
    if (r.soort === 'aanvraag') m.aanvraag += n
    else if (r.soort === 'verleend') m.verleend += n
    else m.overig += n
    m.totaal += n
    perMaandMap.set(r.maand, m)
  }

  const perThema: ThemaTelling[] = THEMAS.map((t) => ({
    id: t.id,
    label: t.label,
    totaal: Number(themas?.[t.id] ?? 0),
    verleend: Number(themas?.[`${t.id}_verleend`] ?? 0),
    aanvraag: Number(themas?.[`${t.id}_aanvraag`] ?? 0),
  })).sort((a, b) => b.totaal - a.totaal)

  return {
    van: bereik?.van ?? null,
    tot: bereik?.tot ?? null,
    totaal: Number(bereik?.n ?? 0),
    perSoort,
    laatste30,
    perMaand: [...perMaandMap.values()],
    perThema,
    perWijk: wijken.map((r) => ({ code: r.code, wijk: naam.get(r.code) ?? r.code, totaal: Number(r.n), verleend: Number(r.verleend) })),
    gekoppeldAandeel: bereik?.n ? Number(koppeling?.n ?? 0) / Number(bereik.n) : 0,
    woningtoevoegingen: toevoegingen,
  }
}

export const getVergunningenOverzicht = unstable_cache(laadVergunningen, [`wonen-vergunningen-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Corporaties (dPi) ────────────────────────────────────────────────────────

export interface CorporatieReeks {
  kvk: string
  naam: string
  /** Totaal zelfstandige woonruimte (DAEB + niet-DAEB) per doeljaar, dPi 2025. */
  perJaar: { jaar: number; daeb: number; nietDaeb: number }[]
  /** Verdeling over huurklassen in het eerste doeljaar. */
  segmenten: { label: string; aantal: number }[]
  onzelfstandig: number
}

export interface DpiOverzicht {
  dpiJaar: number
  gemeente: string
  jaren: number[]
  corporaties: CorporatieReeks[]
  /** Som over corporaties per doeljaar. */
  totaalPerJaar: { jaar: number; daeb: number; nietDaeb: number }[]
  /** Grootste verschuivingen tussen dPi 2024 en dPi 2025 voor hetzelfde doeljaar. */
  verschuivingen: { kvk: string; naam: string; metric: string; doeljaar: string; vorige: number; huidige: number }[]
  opgehaald: string | null
}

const SEGMENTEN = [
  ['Aantal zelfstandige eenheden woonruimte goedkoop', 'goedkoop'],
  ['Aantal zelfstandige eenheden woonruimte betaalbaar', 'betaalbaar'],
  ['Aantal zelfstandige eenheden woonruimte duur tot huurtoeslaggrens', 'duur tot huurtoeslaggrens'],
  ['Aantal zelfstandige eenheden woonruimte duur vanaf huurtoeslaggrens tot middenhuurgrens', 'tot middenhuurgrens'],
  ['Aantal zelfstandige eenheden woonruimte vanaf middenhuurgrens', 'vanaf middenhuurgrens'],
] as const

async function laadDpi(): Promise<DpiOverzicht> {
  // Eén doorgang over de dPi-records van de bron (idx_sr_source_key), daarna
  // verwerking in code. json_extract leest elke rij één keer.
  const [rijen, yoy, meta] = await Promise.all([
    q<any>(
      `SELECT json_extract(raw_object, '$.data.kvk_nummer') AS kvk,
              json_extract(raw_object, '$.data.jaar') AS jaar,
              json_extract(raw_object, '$.data.daeb_indicatie') AS daeb,
              json_extract(raw_object, '$.data.omschrijving') AS omschrijving,
              SUM(CAST(json_extract(raw_object, '$.data.waarde') AS REAL)) AS waarde
       FROM source_records
       WHERE source_id = ? AND source_key LIKE 'dpi:2025:%'
         AND json_extract(raw_object, '$.data.gemeente') = 'Amersfoort'
         AND json_extract(raw_object, '$.data.soort_instelling') = 'TI'
       GROUP BY kvk, jaar, daeb, omschrijving`,
      [BRON.dpi],
    ),
    q<any>(
      `SELECT json_extract(raw_object, '$.comparison') AS c FROM source_records
       WHERE source_id = ? AND source_key LIKE 'dpi:yoy:%'
         AND json_extract(raw_object, '$.comparison.municipality') = 'Amersfoort'
         AND json_extract(raw_object, '$.comparison.absoluteChange') <> 0`,
      [BRON.dpi],
    ),
    qOne<any>(`SELECT MAX(fetched_at) AS t FROM source_records WHERE source_id = ? AND source_key LIKE 'dpi:2025:%'`, [BRON.dpi]),
  ])

  const perKvk = new Map<string, CorporatieReeks>()
  const jarenSet = new Set<number>()
  for (const r of rijen) {
    const kvk = String(r.kvk)
    const jaar = Number(r.jaar)
    jarenSet.add(jaar)
    const c = perKvk.get(kvk) ?? { kvk, naam: CORPORATIES[kvk] ?? `KVK ${kvk}`, perJaar: [], segmenten: [], onzelfstandig: 0 }
    const w = Number(r.waarde ?? 0)
    if (r.omschrijving === 'Totaal van aantal eenheden zelfstandige woonruimte') {
      let j = c.perJaar.find((x) => x.jaar === jaar)
      if (!j) { j = { jaar, daeb: 0, nietDaeb: 0 }; c.perJaar.push(j) }
      if (r.daeb === 'J') j.daeb += w; else j.nietDaeb += w
    }
    perKvk.set(kvk, c)
  }
  const jaren = [...jarenSet].sort()
  const eersteJaar = jaren[0]
  for (const c of perKvk.values()) {
    c.perJaar.sort((a, b) => a.jaar - b.jaar)
    c.segmenten = SEGMENTEN.map(([omschrijving, label]) => ({
      label,
      aantal: rijen.filter((r) => String(r.kvk) === c.kvk && Number(r.jaar) === eersteJaar && r.omschrijving === omschrijving)
        .reduce((som, r) => som + Number(r.waarde ?? 0), 0),
    }))
    c.onzelfstandig = rijen.filter((r) => String(r.kvk) === c.kvk && Number(r.jaar) === eersteJaar && r.omschrijving === 'Aantal onzelfstandige eenheden woonruimte')
      .reduce((som, r) => som + Number(r.waarde ?? 0), 0)
  }

  const corporaties = [...perKvk.values()]
    .filter((c) => c.perJaar.some((j) => j.daeb + j.nietDaeb > 0))
    .sort((a, b) => (b.perJaar[0]?.daeb ?? 0) + (b.perJaar[0]?.nietDaeb ?? 0) - (a.perJaar[0]?.daeb ?? 0) - (a.perJaar[0]?.nietDaeb ?? 0))

  const totaalPerJaar = jaren.map((jaar) => ({
    jaar,
    daeb: corporaties.reduce((s, c) => s + (c.perJaar.find((j) => j.jaar === jaar)?.daeb ?? 0), 0),
    nietDaeb: corporaties.reduce((s, c) => s + (c.perJaar.find((j) => j.jaar === jaar)?.nietDaeb ?? 0), 0),
  }))

  const verschuivingen = yoy
    .map((r) => { try { return JSON.parse(r.c) } catch { return null } })
    .filter((c) => c && /woonruimte/i.test(c.metric))
    .map((c) => {
      const kvk = String(c.organization).replace(/^KVK\s*/, '')
      return {
        kvk,
        naam: CORPORATIES[kvk] ?? `KVK ${kvk}`,
        metric: String(c.metric)
          .replace('Totaal van aantal eenheden zelfstandige woonruimte', 'totaal zelfstandige woonruimte')
          .replace(/^Aantal (zelfstandige eenheden )?/, ''),
        doeljaar: String(c.targetYear),
        vorige: Number(c.previousValue),
        huidige: Number(c.currentValue),
      }
    })
    .sort((a, b) => Math.abs(b.huidige - b.vorige) - Math.abs(a.huidige - a.vorige))
    .slice(0, 12)

  return { dpiJaar: 2025, gemeente: 'Amersfoort', jaren, corporaties, totaalPerJaar, verschuivingen, opgehaald: meta?.t ?? null }
}

export const getDpiOverzicht = unstable_cache(laadDpi, [`wonen-dpi-${CACHE_VERSIE}`], { revalidate: 24 * 60 * 60 })

// ── Dossier Woningbouw en wonen ──────────────────────────────────────────────

export interface WoonFeit {
  id: number
  fact_type: string
  datum: string | null
  locatie: string | null
  titel: string
  details: string | null
  zekerheid: string
  primaire_bron_url: string | null
  dossier: string
  dossier_slug: string
}

export interface DossierOverzicht {
  feiten: WoonFeit[]
  totaal: number
  perMaand: { maand: string; n: number }[]
  perType: { type: string; n: number }[]
  aanpalend: { naam: string; slug: string; omschrijving: string | null; feiten: number; laatste: string | null }[]
}

/**
 * De details van een feit zijn door de weger geschreven voor de redactie en
 * verwijzen soms naar interne tips, signalen of runs. Die zinnen zeggen een
 * externe lezer niets; de feitelijke zinnen blijven staan.
 */
function zonderRedactiejargon(details: string | null): string | null {
  if (!details) return null
  const zinnen = details.split(/(?<=[.!?])\s+/)
  const over = zinnen.filter((z) => !/\b(tip|signaal|signalen)\s+\d|\bClaude\b|\bsweep\b|\bweger\b/i.test(z))
  const uit = over.join(' ').trim()
  return uit.length > 0 ? uit : null
}

async function laadDossier(): Promise<DossierOverzicht> {
  const ids = [WOON_DOSSIER_ID, ...AANPALENDE_DOSSIERS]
  const gaten = ids.map(() => '?').join(',')
  const [feiten, telling, maanden, typen, aanpalend] = await Promise.all([
    // Alleen officiële of door een tweede bron bevestigde feiten; claims en
    // onbevestigde meldingen blijven bij de redactie.
    q<WoonFeit>(
      `SELECT f.id, f.fact_type, f.datum, f.locatie, f.titel, f.details, f.zekerheid, f.primaire_bron_url,
              d.naam AS dossier, d.slug AS dossier_slug
       FROM dossier_facts f JOIN dossiers d ON d.id = f.dossier_id
       WHERE f.dossier_id IN (${gaten}) AND f.zekerheid IN ('officieel', 'bevestigd') AND f.superseded_by IS NULL
       ORDER BY COALESCE(f.datum, f.created_at) DESC LIMIT 40`,
      ids,
    ),
    qOne<any>(`SELECT COUNT(*) AS n FROM dossier_facts WHERE dossier_id = ? AND zekerheid IN ('officieel', 'bevestigd')`, [WOON_DOSSIER_ID]),
    q<any>(
      `SELECT substr(datum, 1, 7) AS maand, COUNT(*) AS n FROM dossier_facts
       WHERE dossier_id = ? AND datum >= date('now', '-12 months') AND datum <= date('now') GROUP BY maand ORDER BY maand`,
      [WOON_DOSSIER_ID],
    ),
    q<any>(`SELECT fact_type AS type, COUNT(*) AS n FROM dossier_facts WHERE dossier_id = ? GROUP BY fact_type ORDER BY n DESC`, [WOON_DOSSIER_ID]),
    q<any>(
      `SELECT d.naam, d.slug, d.omschrijving, COUNT(f.id) AS feiten, MAX(f.datum) AS laatste
       FROM dossiers d LEFT JOIN dossier_facts f ON f.dossier_id = d.id
       WHERE d.id IN (${AANPALENDE_DOSSIERS.map(() => '?').join(',')}) GROUP BY d.id ORDER BY laatste DESC`,
      AANPALENDE_DOSSIERS,
    ),
  ])
  // Twaalf maanden tot en met de huidige, ook de maanden zonder feiten.
  const nu = new Date()
  const reeks: { maand: string; n: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - i, 1))
    const maand = d.toISOString().slice(0, 7)
    reeks.push({ maand, n: Number(maanden.find((r) => r.maand === maand)?.n ?? 0) })
  }
  return {
    feiten: feiten.map((f) => ({ ...f, details: zonderRedactiejargon(f.details) })),
    totaal: Number(telling?.n ?? 0),
    perMaand: reeks,
    perType: typen.map((r) => ({ type: r.type, n: Number(r.n) })),
    aanpalend: aanpalend.map((r) => ({ ...r, feiten: Number(r.feiten) })),
  }
}

export const getWoonDossier = unstable_cache(laadDossier, [`wonen-dossier-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Raad en regelgeving ──────────────────────────────────────────────────────

export interface Stuk {
  id: number
  titel: string
  url: string | null
  datum: string
  bron: string
}

export interface RaadOverzicht {
  stukken: Stuk[]
  /** Aantal woon-gerelateerde raadsstukken in de periode, ook buiten de getoonde lijst. */
  totaal: number
  perBron: { bron: string; n: number }[]
  regels: Stuk[]
}

async function laadRaad(): Promise<RaadOverzicht> {
  const woon = woonWaar('ri.title')
  const raadGaten = RAAD_BRONNEN.map(() => '?').join(',')
  const regelGaten = REGEL_BRONNEN.map(() => '?').join(',')
  const [stukken, perBron, regels] = await Promise.all([
    q<Stuk>(
      `SELECT ri.id, ri.title AS titel, ri.external_url AS url, substr(COALESCE(ri.published_at, ri.scraped_at), 1, 10) AS datum, s.name AS bron
       FROM raw_items ri JOIN sources s ON s.id = ri.source_id
       WHERE ri.source_id IN (${raadGaten}) AND ${woon.sql}
         AND COALESCE(ri.published_at, ri.scraped_at) >= date('now', '-180 days')
       ORDER BY datum DESC, ri.id DESC LIMIT 40`,
      [...RAAD_BRONNEN, ...woon.args],
    ),
    q<any>(
      `SELECT s.name AS bron, COUNT(*) AS n FROM raw_items ri JOIN sources s ON s.id = ri.source_id
       WHERE ri.source_id IN (${raadGaten}) AND ${woon.sql}
         AND COALESCE(ri.published_at, ri.scraped_at) >= date('now', '-180 days')
       GROUP BY s.name ORDER BY n DESC`,
      [...RAAD_BRONNEN, ...woon.args],
    ),
    q<Stuk>(
      `SELECT ri.id, ri.title AS titel, ri.external_url AS url, substr(COALESCE(ri.published_at, ri.scraped_at), 1, 10) AS datum, s.name AS bron
       FROM raw_items ri JOIN sources s ON s.id = ri.source_id
       WHERE ri.source_id IN (${regelGaten}) AND ${woon.sql} AND ri.title NOT LIKE '%sloopmelding%'
       ORDER BY datum DESC, ri.id DESC LIMIT 15`,
      [...REGEL_BRONNEN, ...woon.args],
    ),
  ])
  // Ingekomen stukken hebben lange, aaneengeplakte titels uit de raadsmodule;
  // de kern staat vóór de datum-en-afdoening.
  const kort = (s: Stuk): Stuk => ({ ...s, titel: s.titel.replace(/\s+\d{2}-\d{2}-\d{4}\s.*$/, '').replace(/^\d\.\s[A-Za-z]+\s\d+\s/, '') })
  // Notubiz levert hetzelfde stuk soms twee keer (versie /1/ en /2/, of een
  // gecorrigeerde titel). Eén regel per genormaliseerde titel is genoeg.
  const gezien = new Set<string>()
  const uniek = stukken.map(kort).filter((s) => {
    const sleutel = s.titel.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)
    if (gezien.has(sleutel)) return false
    gezien.add(sleutel)
    return true
  })
  const totaal = perBron.reduce((som, r) => som + Number(r.n), 0)
  return { stukken: uniek, totaal, perBron: perBron.map((r) => ({ bron: r.bron.replace('Raad Amersfoort — ', ''), n: Number(r.n) })), regels }
}

export const getRaadOverzicht = unstable_cache(laadRaad, [`wonen-raad-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })

// ── Subsidies en corporatienieuws ────────────────────────────────────────────

export interface SubsidieRegel {
  regeling: string
  jaar: number
  aantal: number
  totaal: number
  ontvanger: string | null
}

export interface SubsidieOverzicht {
  regelingen: SubsidieRegel[]
  jaren: number[]
}

async function laadSubsidies(): Promise<SubsidieOverzicht> {
  // Het subsidieregister is klein (enkele honderden regels per jaar) en heeft
  // een index op jaar; twee gerichte groeperingen volstaan.
  const [wonen, isolatie, doorstroom] = await Promise.all([
    q<any>(
      `SELECT jaar, ontvanger, omschrijving, COUNT(*) AS n, SUM(bedrag) AS totaal FROM subsidies
       WHERE deelprogramma = 'Wonen' GROUP BY jaar, ontvanger, omschrijving`,
    ),
    q<any>(
      `SELECT jaar, COUNT(*) AS n, SUM(bedrag) AS totaal FROM subsidies
       WHERE jaar >= 2024 AND omschrijving LIKE 'Woningisolatie%' GROUP BY jaar`,
    ),
    q<any>(
      `SELECT jaar, ontvanger, COUNT(*) AS n, SUM(bedrag) AS totaal FROM subsidies
       WHERE jaar >= 2024 AND omschrijving = 'doorstroomwoningen' GROUP BY jaar, ontvanger`,
    ),
  ])
  const regelingen: SubsidieRegel[] = []
  for (const r of wonen) {
    // Particulieren staan in het register als "Burger"; door een importfout
    // zijn soms meerdere regels in één cel samengeplakt. Die tellen als één groep.
    const particulier = /^Burger/.test(r.ontvanger ?? '')
    regelingen.push({
      regeling: particulier ? 'Doorstroomregeling Van Groot naar Beter' : String(r.omschrijving),
      jaar: Number(r.jaar),
      aantal: Number(r.n),
      totaal: Number(r.totaal ?? 0),
      ontvanger: particulier ? 'huishoudens' : r.ontvanger,
    })
  }
  for (const r of isolatie) regelingen.push({ regeling: 'Subsidieregeling woningisolatie voor woningeigenaren', jaar: Number(r.jaar), aantal: Number(r.n), totaal: Number(r.totaal ?? 0), ontvanger: 'woningeigenaren' })
  for (const r of doorstroom) regelingen.push({ regeling: 'Doorstroomwoningen (programma Zorg)', jaar: Number(r.jaar), aantal: Number(r.n), totaal: Number(r.totaal ?? 0), ontvanger: r.ontvanger })

  // Samenvoegen op regeling + jaar + ontvanger.
  const samen = new Map<string, SubsidieRegel>()
  for (const r of regelingen) {
    const sleutel = `${r.regeling}|${r.jaar}|${r.ontvanger}`
    const b = samen.get(sleutel)
    if (b) { b.aantal += r.aantal; b.totaal += r.totaal } else samen.set(sleutel, { ...r })
  }
  const lijst = [...samen.values()].sort((a, b) => b.jaar - a.jaar || b.totaal - a.totaal)
  return { regelingen: lijst, jaren: [...new Set(lijst.map((r) => r.jaar))].sort((a, b) => b - a) }
}

export const getSubsidieOverzicht = unstable_cache(laadSubsidies, [`wonen-subsidies-${CACHE_VERSIE}`], { revalidate: 24 * 60 * 60 })

export interface Bericht {
  id: number
  titel: string
  url: string | null
  datum: string
}

async function laadCorporatieNieuws(): Promise<Bericht[]> {
  // De Alliantie publiceert regionaal; alleen berichten met een lokale
  // plaatsaanduiding in de titel. Publicatiedatum ontbreekt bij deze bron,
  // dus de scrapedatum is de beste benadering.
  return q<Bericht>(
    `SELECT id, title AS titel, external_url AS url, substr(COALESCE(published_at, scraped_at), 1, 10) AS datum
     FROM raw_items WHERE source_id = ?
       AND (title LIKE '%Amersfoort%' OR title LIKE '%Vathorst%' OR title LIKE '%Kruiskamp%' OR title LIKE '%Liendert%'
            OR title LIKE '%Soesterkwartier%' OR title LIKE '%Schothorst%' OR title LIKE '%Hoogland%' OR title LIKE '%Leusderweg%'
            OR title LIKE '%De Hoef%' OR title LIKE '%Nieuwland%' OR title LIKE '%Randenbroek%' OR title LIKE '%Jeruzalem%')
     ORDER BY id DESC LIMIT 10`,
    [BRON.alliantie],
  )
}

export const getCorporatieNieuws = unstable_cache(laadCorporatieNieuws, [`wonen-corporatienieuws-${CACHE_VERSIE}`], { revalidate: CACHE_SECONDEN })
