// Queries voor de verkenner: alles wat Stadsgeest over een naam of onderwerp
// heeft. Puur lezend. De ingang is een klik op een betrokkene bij een tip, of
// een losse zoekopdracht.
//
// Sinds 3 oktober 2026 zoekt de verkenner eerst via de kennisgraaf: bekende
// partijen (kg_entities en hun aliassen) en de naamvermeldingen in documenten
// (document_mentions), allebei op een genormaliseerde naam met een indexeerbaar
// voorvoegselbereik. Daarmee kost een klik op een naam geen tabelscan over alle
// documenten meer. De oude `LIKE '%…%'` over raw_items staat alleen nog achter
// `alles=1` ("zoek ook in alle documenttitels"); zie docs/DATABASE-LEZEN.md.
// Tips, sporen, dossierfeiten en subsidies zijn kleine tabellen en houden hun
// LIKE.
import { q, qOne } from '@/lib/turso'

export interface VerkennerTip {
  id: number
  titel: string
  kern: string
  status: string
  created_at: string
}

export interface VerkennerSignaal {
  id: number
  title: string
  status: string
  confirmations: number
  first_seen_at: string
}

export interface VerkennerFeit {
  id: number
  titel: string
  datum: string | null
  details: string | null
  zekerheid: string
  dossier: string
  dossier_slug: string
  primaire_bron_url: string | null
}

export interface VerkennerSubsidie {
  jaar: number
  ontvanger: string
  omschrijving: string | null
  deelprogramma: string | null
  bedrag: number
}

export interface VerkennerDocument {
  titel: string
  url: string | null
  datum: string
  bron: string
  /** Hoe vaak de naam in het document is herkend; alleen bij vermeldingen. */
  vermeldingen?: number
}

export interface VerkennerPartij {
  id: number
  naam: string
  soort: 'person' | 'organization' | 'location'
  /** Documenten waarin deze partij bevestigd is herkend. */
  documenten: number
  /** Via welke naam de partij is gevonden, als dat een alias was. */
  alias: string | null
}

export interface VerkennerResultaat {
  term: string
  verbreedNaar: string | null
  /** Of de zware zoektocht door alle documenttitels is meegenomen. */
  alles: boolean
  tips: VerkennerTip[]
  signalen: VerkennerSignaal[]
  feiten: VerkennerFeit[]
  subsidies: VerkennerSubsidie[]
  subsidieTotalen: { jaar: number; totaal: number; aantal: number }[]
  partijen: VerkennerPartij[]
  documenten: VerkennerDocument[]
  documentenTotaal: number
  /** Documenten gevonden via naamvermeldingen (de goedkope route). */
  documentenViaVermeldingen: number
}

function veilig(term: string): string {
  // LIKE-jokers uit de invoer halen; de zoekterm is data, geen patroon.
  return term.replace(/[%_]/g, ' ').trim()
}

/** Zelfde normalisatie als de entity-resolver en de NER-extractie: kleine letters, geen punten, enkele spaties. */
export function normaliseer(naam: string): string {
  return naam.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

/** Bovengrens van een voorvoegselbereik: alles wat met `prefix` begint ligt vóór deze waarde. */
function bovengrens(prefix: string): string {
  return prefix + '￿'
}

const DOC_LIMIET = 12

async function zoekPartijen(norm: string): Promise<VerkennerPartij[]> {
  const [direct, viaAlias] = await Promise.all([
    q<{ id: number; naam: string; soort: VerkennerPartij['soort'] }>(
      `SELECT id, canonical_name AS naam, entity_type AS soort FROM kg_entities
       WHERE merged_into_id IS NULL AND normalized_name >= ? AND normalized_name < ?
       ORDER BY length(normalized_name) LIMIT 8`,
      [norm, bovengrens(norm)],
    ),
    q<{ id: number; naam: string; soort: VerkennerPartij['soort']; alias: string }>(
      `SELECT ke.id, ke.canonical_name AS naam, ke.entity_type AS soort, ka.alias
       FROM kg_aliases ka JOIN kg_entities ke ON ke.id = ka.entity_id
       WHERE ke.merged_into_id IS NULL AND ka.normalized_alias >= ? AND ka.normalized_alias < ?
       ORDER BY length(ka.normalized_alias) LIMIT 8`,
      [norm, bovengrens(norm)],
    ),
  ])
  const uniek = new Map<number, VerkennerPartij>()
  for (const r of direct) uniek.set(Number(r.id), { id: Number(r.id), naam: r.naam, soort: r.soort, documenten: 0, alias: null })
  for (const r of viaAlias) if (!uniek.has(Number(r.id))) uniek.set(Number(r.id), { id: Number(r.id), naam: r.naam, soort: r.soort, documenten: 0, alias: r.alias })
  const partijen = [...uniek.values()].slice(0, 8)
  if (partijen.length === 0) return []
  // Bevestigde vermeldingen per partij, via de index op resolved_entity_id.
  const tellingen = await q<{ id: number; n: number }>(
    `SELECT resolved_entity_id AS id, COUNT(DISTINCT raw_item_id) AS n FROM document_mentions
     WHERE resolved_entity_id IN (${partijen.map(() => '?').join(',')}) GROUP BY resolved_entity_id`,
    partijen.map((p) => p.id),
  )
  const perId = new Map(tellingen.map((t) => [Number(t.id), Number(t.n)]))
  for (const p of partijen) p.documenten = perId.get(p.id) ?? 0
  return partijen.sort((a, b) => b.documenten - a.documenten)
}

/** Documenten waarin de naam is herkend, zwaarst vermeld eerst. Index idx_dm_norm. */
async function zoekViaVermeldingen(norm: string): Promise<{ documenten: VerkennerDocument[]; totaal: number }> {
  const treffers = await q<{ raw_item_id: number; n: number }>(
    `SELECT raw_item_id, SUM(occurrences) AS n FROM document_mentions
     WHERE entity_type IN ('person','organization','location') AND normalized_text >= ? AND normalized_text < ?
     GROUP BY raw_item_id`,
    [norm, bovengrens(norm)],
  )
  if (treffers.length === 0) return { documenten: [], totaal: 0 }
  const perItem = new Map(treffers.map((t) => [Number(t.raw_item_id), Number(t.n)]))
  const ids = [...perItem.keys()]
  // Nieuwste documenten eerst; hoogstens enkele honderden ids via de primaire sleutel.
  const rijen = await q<VerkennerDocument & { id: number }>(
    `SELECT ri.id, ri.title AS titel, ri.external_url AS url,
            COALESCE(ri.published_at, ri.scraped_at) AS datum, s.name AS bron
     FROM raw_items ri JOIN sources s ON s.id = ri.source_id
     WHERE ri.id IN (${ids.slice(0, 400).map(() => '?').join(',')})
     ORDER BY datum DESC LIMIT ?`,
    [...ids.slice(0, 400), DOC_LIMIET],
  )
  return {
    documenten: rijen.map((r) => ({ titel: r.titel, url: r.url, datum: r.datum, bron: r.bron, vermeldingen: perItem.get(Number(r.id)) })),
    totaal: ids.length,
  }
}

/** De oude, zware route: LIKE over alle documenttitels. Alleen op verzoek. */
async function zoekInAlleTitels(term: string): Promise<{ documenten: VerkennerDocument[]; totaal: number }> {
  const like = `%${term}%`
  const [documenten, telling] = await Promise.all([
    q<VerkennerDocument>(
      `SELECT ri.title AS titel, ri.external_url AS url,
              COALESCE(ri.published_at, ri.scraped_at) AS datum, s.name AS bron
       FROM raw_items ri JOIN sources s ON s.id = ri.source_id
       WHERE ri.title LIKE ?
       ORDER BY datum DESC LIMIT ?`,
      [like, DOC_LIMIET],
    ),
    qOne<{ n: number }>(`SELECT COUNT(*) AS n FROM raw_items WHERE title LIKE ?`, [like]),
  ])
  return { documenten, totaal: Number(telling?.n ?? 0) }
}

async function zoek(term: string, alles: boolean) {
  const like = `%${term}%`
  const norm = normaliseer(term)
  const [tips, signalen, feiten, subsidies, subsidieTotalen, partijen, viaVermeldingen] = await Promise.all([
    q<VerkennerTip>(
      `SELECT id, titel, kern, status, created_at FROM tips
       WHERE titel LIKE ? OR kern LIKE ? OR briefing LIKE ?
       ORDER BY created_at DESC LIMIT 10`,
      [like, like, like],
    ),
    q<VerkennerSignaal>(
      `SELECT id, title, status, confirmations, first_seen_at FROM signals
       WHERE title LIKE ? OR summary LIKE ?
       ORDER BY last_seen_at DESC LIMIT 15`,
      [like, like],
    ),
    q<VerkennerFeit>(
      `SELECT f.id, f.titel, f.datum, f.details, f.zekerheid, f.primaire_bron_url, d.naam AS dossier, d.slug AS dossier_slug
       FROM dossier_facts f JOIN dossiers d ON d.id = f.dossier_id
       WHERE f.titel LIKE ? OR f.details LIKE ? OR f.locatie LIKE ?
       ORDER BY COALESCE(f.datum, f.created_at) DESC LIMIT 15`,
      [like, like, like],
    ),
    q<VerkennerSubsidie>(
      `SELECT jaar, ontvanger, omschrijving, deelprogramma, bedrag FROM subsidies
       WHERE ontvanger LIKE ? AND is_particulier = 0
       ORDER BY jaar DESC, bedrag DESC LIMIT 20`,
      [like],
    ),
    q<{ jaar: number; totaal: number; aantal: number }>(
      `SELECT jaar, SUM(bedrag) AS totaal, COUNT(*) AS aantal FROM subsidies
       WHERE ontvanger LIKE ? AND is_particulier = 0
       GROUP BY jaar ORDER BY jaar DESC`,
      [like],
    ),
    norm.length >= 2 ? zoekPartijen(norm) : Promise.resolve([]),
    norm.length >= 2 ? zoekViaVermeldingen(norm) : Promise.resolve({ documenten: [], totaal: 0 }),
  ])
  const titels = alles ? await zoekInAlleTitels(term) : null
  // Met `alles` staan de titeltreffers voorop; vermeldingen die daar niet in zitten komen erachter.
  let documenten = viaVermeldingen.documenten
  let documentenTotaal = viaVermeldingen.totaal
  if (titels) {
    const bekend = new Set(titels.documenten.map((d) => d.url ?? d.titel))
    documenten = [...titels.documenten, ...viaVermeldingen.documenten.filter((d) => !bekend.has(d.url ?? d.titel))].slice(0, DOC_LIMIET * 2)
    documentenTotaal = Math.max(titels.totaal, viaVermeldingen.totaal)
  }
  return {
    tips, signalen, feiten, subsidies, subsidieTotalen, partijen, documenten, documentenTotaal,
    documentenViaVermeldingen: viaVermeldingen.totaal,
  }
}

export async function verken(ruweTerm: string, alles = false): Promise<VerkennerResultaat> {
  const term = veilig(ruweTerm)
  let uit = await zoek(term, alles)
  let verbreedNaar: string | null = null

  // Niets gevonden en de term bestaat uit meerdere woorden? Probeer dan het
  // langste woord — "Robin de Jongh" vindt zo alsnog alles met "Jongh".
  const leeg = uit.tips.length + uit.signalen.length + uit.feiten.length
    + uit.subsidies.length + uit.partijen.length + uit.documentenTotaal === 0
  if (leeg && term.includes(' ')) {
    const langste = term.split(/\s+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0]
    if (langste && langste.toLowerCase() !== term.toLowerCase()) {
      uit = await zoek(langste, alles)
      verbreedNaar = langste
    }
  }

  return { term, verbreedNaar, alles, ...uit }
}
