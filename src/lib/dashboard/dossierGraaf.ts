/* eslint-disable @typescript-eslint/no-explicit-any */
// Partijengraaf per dossier.
//
// Keten: dossier → dossierfeiten → signalen → unieke brondocumenten →
// gekoppelde vermeldingen → partijen. Een lijn tussen twee partijen bestaat
// alleen als ze samen in een passage staan (zelfde alinea, tabelrij of
// opsommingsregel; een venster van 400 tekens alleen waar de tekststructuur
// verloren is) of als de kennisgraaf een vastgelegde relatie heeft. Alleen in
// hetzelfde document staan is géén lijn.
//
// Vaste regels (afgesproken 1 oktober 2026):
// 1. Per partijenpaar telt een document hoogstens één keer.
// 2. Een naamvorm doet alleen mee als hij volledig en onderscheidend is en naar
//    precies één KG-entiteit wijst. Personen alleen met voor- en achternaam.
// 3. Tekststructuur eerst, 400 tekens alleen als terugval.
// 4. Zelfde document is geen partij-partijlijn.
// 5. Passages met meer dan vijf partijen zijn lijstpassages en tellen niet mee;
//    hetzelfde geldt voor opsommingen en ondertekeningsblokken (namen zonder
//    zin ertussen). Beide worden apart gerapporteerd.
//
// Leest alleen via indexen (dossier_id, signal_id, raw_item_id, entity_id,
// normalized_alias) en wordt zes uur gecachet. De zware tekstverwerking
// gebeurt in de functie, niet in de database.
import { unstable_cache } from 'next/cache'
import { q } from '@/lib/turso'

const MAX_PARTIJEN_PER_PASSAGE = 5
const VENSTER = 400
const MAX_ALINEA = 1500
const BOILERPLATE_DOCS = 3
const VERBORGEN = /^gemeente (amersfoort|leusden)$/i
const GENERIEK = new Set(['gemeente', 'college', 'raad', 'provincie', 'rijk', 'stichting', 'vereniging', 'bv', 'b.v.'])

export type Koppeling = 'bevestigd' | 'kandidaat'

export interface GraafPartij {
  id: number
  naam: string
  soort: 'organization' | 'person' | 'location'
  koppeling: Koppeling
  documenten: number
  signalen: number
  feiten: number
}

export interface GraafPassage {
  doc: number
  tekst: string
  vorm: 'alinea' | 'regel' | 'venster'
}

export interface GraafLijn {
  a: number
  b: number
  soort: 'passage' | 'relatie'
  documenten: number
  passages: number
  /** Sterkste structuurvorm waarin de partijen samen staan. */
  vorm?: 'alinea' | 'regel' | 'venster'
  voorbeelden: GraafPassage[]
  relatie?: string
}

export interface GraafDocument {
  id: number
  titel: string
  url: string | null
  datum: string | null
  partijen: number[]
}

export interface DossierGraaf {
  partijen: GraafPartij[]
  lijnen: GraafLijn[]
  documenten: GraafDocument[]
  verantwoording: {
    feiten: number
    signalen: number
    documenten: number
    naief: { naam: string; feiten: number }[]
    naDeduplicatie: { naam: string; documenten: number }[]
    paren: { zelfdeDocument: number; naPassagefilter: number; relaties: number }
    lijstpassages: { aantal: number; voorbeelden: { doc: number; partijen: string[]; tekst: string }[] }
    boilerplate: { aantal: number; voorbeelden: { documenten: number; tekst: string }[] }
    verborgen: { naam: string; documenten: number }[]
    geschrapteNaamvormen: { vorm: string; reden: string }[]
    nietGekoppeld: { naam: string; documenten: number }[]
  }
  berekend: string
}

// ── hulpfuncties ─────────────────────────────────────────────

function normaliseer(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function inStukken<T>(ids: (number | string)[], maak: (gaten: string, stuk: (number | string)[]) => Promise<T[]>): Promise<T[]> {
  const uit: T[] = []
  for (let i = 0; i < ids.length; i += 400) {
    const stuk = ids.slice(i, i + 400)
    if (stuk.length === 0) continue
    uit.push(...(await maak(stuk.map(() => '?').join(','), stuk)))
  }
  return uit
}

/** Waarom een naamvorm niet veilig is, of null als hij mag. */
function naamvormProbleem(vorm: string, soort: string): string | null {
  const v = vorm.trim()
  if (v.length < 3) return 'te kort'
  if (GENERIEK.has(normaliseer(v))) return 'algemeen woord'
  if (soort === 'person') {
    const delen = v.split(/\s+/)
    if (delen.length < 2) return 'alleen achternaam of voornaam'
    if (/^[A-Z]\.?$/.test(delen[0]) || /^([A-Z]\.)+/.test(delen[0])) return 'initialen'
  }
  return null
}

/** Een afkorting (alleen hoofdletters) wordt hoofdlettergevoelig gezocht. */
function maakPatroon(vorm: string): RegExp {
  const isAfkorting = vorm === vorm.toUpperCase() && /[A-Z]/.test(vorm) && vorm.length <= 6
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(vorm).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, isAfkorting ? 'gu' : 'giu')
}

interface Eenheid { start: number; eind: number; vorm: 'alinea' | 'regel' | 'venster' }

/** Deelt een tekst op in alinea's; lijstachtige alinea's in regels; te lange alinea's krijgen venstermodus. */
function eenheden(tekst: string): Eenheid[] {
  const uit: Eenheid[] = []
  const scheiding = /\n[ \t]*\n/g
  let begin = 0
  const blokken: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = scheiding.exec(tekst)) !== null) {
    blokken.push([begin, m.index])
    begin = m.index + m[0].length
  }
  blokken.push([begin, tekst.length])
  for (const [s, e] of blokken) {
    if (e - s < 2) continue
    const blok = tekst.slice(s, e)
    const regels = blok.split('\n')
    const lijstRegels = regels.filter((r) => /^\s*([-•*·▪–]|\d+[.)]|[a-z][.)])\s+/.test(r) || r.includes('\t') || /\s{3,}\S/.test(r.trim())).length
    if (regels.length >= 3 && lijstRegels / regels.length >= 0.5) {
      let pos = s
      for (const r of regels) {
        if (r.trim().length > 0) uit.push({ start: pos, eind: pos + r.length, vorm: 'regel' })
        pos += r.length + 1
      }
    } else if (e - s > MAX_ALINEA) {
      uit.push({ start: s, eind: e, vorm: 'venster' })
    } else {
      uit.push({ start: s, eind: e, vorm: 'alinea' })
    }
  }
  return uit
}

/**
 * Een opsomming of ondertekeningsblok: namen die alleen gescheiden worden door
 * leestekens, andere namen of partijnamen (woorden met een hoofdletter), zoals
 * "Marcel Koning ChristenUnie Hans van Wegen BPA" of "de Alliantie, Portaal,
 * Omnia Wonen". Een gewoon woord als "en" of "met" ertussen maakt het een zin.
 */
const OPSOMMINGSGAT = /^[\s,;:·•|/()\-–]*(?:[A-Z0-9][\p{L}\p{N}&.'’-]*[\s,;:·•|/()\-–]*)*$/u
function isOpsommingsgat(tussen: string): boolean {
  return tussen.length <= 60 && OPSOMMINGSGAT.test(tussen)
}

function fragment(tekst: string, van: number, tot: number): string {
  const s = Math.max(0, van - 60)
  const e = Math.min(tekst.length, tot + 60)
  return `${s > 0 ? '…' : ''}${tekst.slice(s, e).replace(/\s+/g, ' ').trim()}${e < tekst.length ? '…' : ''}`
}

// ── berekening ───────────────────────────────────────────────

async function berekenGraaf(dossierId: number): Promise<DossierGraaf> {
  // 1. Feiten → signalen → unieke documenten.
  const feiten = await q<any>(
    `SELECT id, signal_id FROM dossier_facts WHERE dossier_id = ? AND signal_id IS NOT NULL`, [dossierId])
  const signaalNaarFeiten = new Map<number, number[]>()
  for (const f of feiten) {
    const s = Number(f.signal_id)
    signaalNaarFeiten.set(s, [...(signaalNaarFeiten.get(s) ?? []), Number(f.id)])
  }
  const signaalIds = [...signaalNaarFeiten.keys()]
  const items = await inStukken<any>(signaalIds, (g, a) =>
    // Ook de deelitems van lange documenten (raw_item_parts, sinds 2026-10-03):
    // de partijen uit deel 2 en verder van een Woo-besluit horen bij het dossier.
    q(`SELECT signal_id, raw_item_id FROM signal_items WHERE signal_id IN (${g})
       UNION ALL
       SELECT si.signal_id, p.part_id AS raw_item_id
       FROM signal_items si JOIN raw_item_parts p ON p.parent_id = si.raw_item_id
       WHERE si.signal_id IN (${g})`, [...a, ...a]))
  const docSignalen = new Map<number, Set<number>>()
  const docFeiten = new Map<number, Set<number>>()
  for (const r of items) {
    const d = Number(r.raw_item_id), s = Number(r.signal_id)
    if (!docSignalen.has(d)) { docSignalen.set(d, new Set()); docFeiten.set(d, new Set()) }
    docSignalen.get(d)!.add(s)
    for (const f of signaalNaarFeiten.get(s) ?? []) docFeiten.get(d)!.add(f)
  }
  const docIds = [...docSignalen.keys()]

  // 2. Gekoppelde vermeldingen: NER (kandidaat/bevestigd) en de oudere extractor.
  const [nerRijen, oudRijen, ongekoppeld, docs] = await Promise.all([
    inStukken<any>(docIds, (g, a) => q(
      `SELECT raw_item_id, resolved_entity_id, mention_text, resolution_status, entity_type
       FROM document_mentions WHERE raw_item_id IN (${g})
       AND resolved_entity_id IS NOT NULL AND resolution_status IN ('candidate', 'confirmed')
       AND entity_type IN ('organization', 'person')`, a)),
    inStukken<any>(docIds, (g, a) => q(
      `SELECT raw_item_id, name, entity_type, organization_id, person_id FROM entities
       WHERE raw_item_id IN (${g}) AND (organization_id IS NOT NULL OR person_id IS NOT NULL)`, a)),
    inStukken<any>(docIds, (g, a) => q(
      `SELECT raw_item_id, mention_text, normalized_text FROM document_mentions
       WHERE raw_item_id IN (${g}) AND resolution_status = 'unresolved' AND entity_type = 'organization'`, a)),
    inStukken<any>(docIds, (g, a) => q(
      `SELECT id, title, external_url, published_at, scraped_at, summary, content, full_text
       FROM raw_items WHERE id IN (${g})`, a)),
  ])

  // 3. KG-entiteiten erbij; de oudere extractor via source_org_id/source_person_id.
  const orgIds = [...new Set(oudRijen.filter((r) => r.organization_id).map((r) => Number(r.organization_id)))]
  const persIds = [...new Set(oudRijen.filter((r) => r.person_id).map((r) => Number(r.person_id)))]
  const nerIds = [...new Set(nerRijen.map((r) => Number(r.resolved_entity_id)))]
  const kgRijen: any[] = [
    ...(await inStukken<any>(nerIds, (g, a) => q(
      `SELECT id, entity_type, canonical_name, normalized_name, merged_into_id, source_org_id, source_person_id FROM kg_entities WHERE id IN (${g})`, a))),
    ...(orgIds.length || persIds.length ? await q<any>(
      `SELECT id, entity_type, canonical_name, normalized_name, merged_into_id, source_org_id, source_person_id FROM kg_entities
       WHERE ${[orgIds.length ? `source_org_id IN (${orgIds.map(() => '?').join(',')})` : '', persIds.length ? `source_person_id IN (${persIds.map(() => '?').join(',')})` : ''].filter(Boolean).join(' OR ')}`,
      [...orgIds, ...persIds]) : []),
  ]
  // Samengevoegde entiteiten verwijzen naar hun wortel.
  const wortelIds = [...new Set(kgRijen.filter((r) => r.merged_into_id).map((r) => Number(r.merged_into_id)))]
  const wortels = await inStukken<any>(wortelIds, (g, a) => q(
    `SELECT id, entity_type, canonical_name, normalized_name, merged_into_id, source_org_id, source_person_id FROM kg_entities WHERE id IN (${g})`, a))
  const kg = new Map<number, any>()
  for (const r of [...kgRijen, ...wortels]) kg.set(Number(r.id), r)
  const wortel = (id: number): number => {
    let huidig = id
    for (let i = 0; i < 5; i++) {
      const r = kg.get(huidig)
      if (!r?.merged_into_id) return huidig
      huidig = Number(r.merged_into_id)
    }
    return huidig
  }
  const viaOrg = new Map<number, number>(), viaPers = new Map<number, number>()
  for (const r of kgRijen) {
    if (r.source_org_id) viaOrg.set(Number(r.source_org_id), wortel(Number(r.id)))
    if (r.source_person_id) viaPers.set(Number(r.source_person_id), wortel(Number(r.id)))
  }

  // Per document de gekoppelde partijen en hun naamvormen.
  const partijDocs = new Map<number, Set<number>>()
  const naamvormen = new Map<number, Set<string>>()
  const bevestigd = new Set<number>()
  const voegToe = (ent: number, doc: number, vorm: string | null) => {
    if (!partijDocs.has(ent)) partijDocs.set(ent, new Set())
    partijDocs.get(ent)!.add(doc)
    if (vorm) {
      if (!naamvormen.has(ent)) naamvormen.set(ent, new Set())
      naamvormen.get(ent)!.add(vorm.trim())
    }
  }
  for (const r of nerRijen) {
    const ent = wortel(Number(r.resolved_entity_id))
    voegToe(ent, Number(r.raw_item_id), r.mention_text)
    if (r.resolution_status === 'confirmed') bevestigd.add(ent)
  }
  for (const r of oudRijen) {
    const ent = r.organization_id ? viaOrg.get(Number(r.organization_id)) : viaPers.get(Number(r.person_id))
    if (ent) voegToe(ent, Number(r.raw_item_id), r.name)
  }
  const entIds = [...partijDocs.keys()]
  for (const id of entIds) {
    const r = kg.get(id)
    if (r?.canonical_name) {
      if (!naamvormen.has(id)) naamvormen.set(id, new Set())
      naamvormen.get(id)!.add(String(r.canonical_name))
    }
  }

  // 4. Aliassen en de eenduidigheidscontrole (regel 2).
  const aliassen = await inStukken<any>(entIds, (g, a) => q(
    `SELECT entity_id, alias FROM kg_aliases WHERE entity_id IN (${g})`, a))
  for (const r of aliassen) {
    const id = wortel(Number(r.entity_id))
    if (naamvormen.has(id)) naamvormen.get(id)!.add(String(r.alias).trim())
  }
  const alleNorm = [...new Set([...naamvormen.values()].flatMap((s) => [...s].map(normaliseer)))]
  const [aliasTreffers, naamTreffers] = await Promise.all([
    inStukken<any>(alleNorm, (g, a) => q(`SELECT normalized_alias AS n, entity_id AS id FROM kg_aliases WHERE normalized_alias IN (${g})`, a)),
    inStukken<any>(alleNorm, (g, a) => q(`SELECT normalized_name AS n, id, merged_into_id FROM kg_entities WHERE normalized_name IN (${g})`, a)),
  ])
  const normNaarEnt = new Map<string, Set<number>>()
  for (const r of [...aliasTreffers, ...naamTreffers]) {
    const id = r.merged_into_id ? Number(r.merged_into_id) : Number(r.id)
    if (!normNaarEnt.has(r.n)) normNaarEnt.set(r.n, new Set())
    normNaarEnt.get(r.n)!.add(kg.has(id) ? wortel(id) : id)
  }
  const geschrapt: { vorm: string; reden: string }[] = []
  const patronen = new Map<number, RegExp[]>()
  const verborgenIds = new Set<number>()
  for (const id of entIds) {
    const r = kg.get(id)
    const soort = r?.entity_type ?? 'organization'
    if (r && VERBORGEN.test(String(r.canonical_name))) verborgenIds.add(id)
    const goed: RegExp[] = []
    for (const vorm of naamvormen.get(id) ?? []) {
      let reden = naamvormProbleem(vorm, soort)
      const treffers = normNaarEnt.get(normaliseer(vorm))
      if (!reden && treffers && treffers.size > 1) reden = 'wijst naar meerdere KG-entiteiten'
      if (reden) { if (!geschrapt.some((g) => g.vorm === vorm)) geschrapt.push({ vorm, reden }); continue }
      goed.push(maakPatroon(vorm))
    }
    patronen.set(id, goed)
  }

  // 5. Passages per document.
  type Vondst = { ent: number; pos: number; eind: number }
  const eenheidTeksten = new Map<string, Set<number>>() // boilerplate-detectie
  const perDoc: { doc: number; tekst: string; eenheden: { e: Eenheid; vondsten: Vondst[]; sleutel: string }[] }[] = []
  for (const d of docs) {
    const docId = Number(d.id)
    const delen = [d.title, d.summary, d.content, d.full_text].filter((x: unknown) => typeof x === 'string' && x.trim().length > 0) as string[]
    // content en full_text overlappen soms volledig; dubbel opnemen voegt niets toe.
    const tekst = [...new Set(delen)].join('\n\n')
    const vondsten: Vondst[] = []
    for (const id of entIds) {
      if (!partijDocs.get(id)?.has(docId)) continue
      for (const p of patronen.get(id) ?? []) {
        p.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = p.exec(tekst)) !== null) {
          vondsten.push({ ent: id, pos: m.index, eind: m.index + m[0].length })
          if (m[0].length === 0) p.lastIndex++
        }
      }
    }
    vondsten.sort((a, b) => a.pos - b.pos || (b.eind - b.pos) - (a.eind - a.pos))
    // Overlappende treffers (naam en alias op dezelfde plek) tellen één keer.
    const uniek: Vondst[] = []
    for (const v of vondsten) if (uniek.length === 0 || v.pos >= uniek[uniek.length - 1].eind) uniek.push(v)
    vondsten.length = 0
    vondsten.push(...uniek)
    const lijst: { e: Eenheid; vondsten: Vondst[]; sleutel: string }[] = []
    let vi = 0
    for (const e of eenheden(tekst)) {
      while (vi < vondsten.length && vondsten[vi].pos < e.start) vi++
      const binnen: Vondst[] = []
      for (let j = vi; j < vondsten.length && vondsten[j].pos < e.eind; j++) binnen.push(vondsten[j])
      if (binnen.length === 0) continue
      const sleutel = normaliseer(tekst.slice(e.start, e.eind)).slice(0, 300)
      if (!eenheidTeksten.has(sleutel)) eenheidTeksten.set(sleutel, new Set())
      eenheidTeksten.get(sleutel)!.add(docId)
      lijst.push({ e, vondsten: binnen, sleutel })
    }
    perDoc.push({ doc: docId, tekst, eenheden: lijst })
  }

  const naam = (id: number) => String(kg.get(id)?.canonical_name ?? `#${id}`)
  const paarDocs = new Map<string, Set<number>>()
  const paarPassages = new Map<string, GraafPassage[]>()
  const paarAantal = new Map<string, number>()
  const paarVorm = new Map<string, 'alinea' | 'regel' | 'venster'>()
  const lijstVoorbeelden: { doc: number; partijen: string[]; tekst: string }[] = []
  let lijstAantal = 0
  const boilerVoorbeelden = new Map<string, { documenten: number; tekst: string }>()
  let boilerAantal = 0
  const rang = { regel: 0, alinea: 1, venster: 2 } as const

  const registreer = (a: number, b: number, doc: number, tekst: string, van: number, tot: number, vorm: 'alinea' | 'regel' | 'venster') => {
    if (a === b) return
    const [x, y] = a < b ? [a, b] : [b, a]
    const k = `${x}-${y}`
    if (!paarDocs.has(k)) { paarDocs.set(k, new Set()); paarPassages.set(k, []) }
    paarDocs.get(k)!.add(doc) // regel 1: een document telt één keer
    paarAantal.set(k, (paarAantal.get(k) ?? 0) + 1)
    const huidig = paarVorm.get(k)
    if (!huidig || rang[vorm] < rang[huidig]) paarVorm.set(k, vorm)
    const lijst = paarPassages.get(k)!
    const frag = fragment(tekst, van, tot)
    if (lijst.length < 4 && !lijst.some((p) => p.doc === doc)) lijst.push({ doc, tekst: frag, vorm })
  }

  for (const { doc, tekst, eenheden: lijst } of perDoc) {
    for (const { e, vondsten, sleutel } of lijst) {
      const alleZichtbaar = vondsten.filter((v) => !verborgenIds.has(v.ent))
      if (new Set(alleZichtbaar.map((v) => v.ent)).size < 2) continue
      // Opsommingen en ondertekeningsblokken (regel 5): reeksen namen zonder zin ertussen.
      const inReeks = new Set<number>()
      for (let i = 0; i + 1 < alleZichtbaar.length; i++) {
        const a = alleZichtbaar[i], b = alleZichtbaar[i + 1]
        if (a.ent !== b.ent && b.pos >= a.eind && isOpsommingsgat(tekst.slice(a.eind, b.pos))) { inReeks.add(i); inReeks.add(i + 1) }
      }
      if (inReeks.size > 0) {
        const reeks = [...inReeks].sort((x, y) => x - y).map((i) => alleZichtbaar[i])
        lijstAantal++
        if (lijstVoorbeelden.length < 8) lijstVoorbeelden.push({ doc, partijen: [...new Set(reeks.map((v) => naam(v.ent)))], tekst: fragment(tekst, reeks[0].pos, Math.min(reeks[reeks.length - 1].eind, reeks[0].pos + 240)) })
      }
      const zichtbaar = alleZichtbaar.filter((_, i) => !inReeks.has(i))
      const partijen = new Set(zichtbaar.map((v) => v.ent))
      if (partijen.size < 2) continue
      // Boilerplate: dezelfde passage in drie of meer documenten.
      const nDocs = eenheidTeksten.get(sleutel)?.size ?? 0
      if (nDocs >= BOILERPLATE_DOCS) {
        boilerAantal++
        if (!boilerVoorbeelden.has(sleutel) && boilerVoorbeelden.size < 5) {
          boilerVoorbeelden.set(sleutel, { documenten: nDocs, tekst: fragment(tekst, e.start, Math.min(e.eind, e.start + 240)) })
        }
        continue
      }
      if (e.vorm !== 'venster') {
        if (partijen.size > MAX_PARTIJEN_PER_PASSAGE) {
          lijstAantal++
          if (lijstVoorbeelden.length < 6) lijstVoorbeelden.push({ doc, partijen: [...partijen].map(naam), tekst: fragment(tekst, e.start, Math.min(e.eind, e.start + 240)) })
          continue
        }
        const ids = [...partijen]
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          const va = zichtbaar.find((v) => v.ent === ids[i])!, vb = zichtbaar.find((v) => v.ent === ids[j])!
          registreer(ids[i], ids[j], doc, tekst, Math.min(va.pos, vb.pos), Math.max(va.eind, vb.eind), e.vorm)
        }
      } else {
        // Venstermodus: paren binnen 400 tekens; een venster met meer dan vijf partijen is een lijst.
        const gezienLijst = new Set<number>()
        for (let i = 0; i < zichtbaar.length; i++) {
          for (let j = i + 1; j < zichtbaar.length && zichtbaar[j].pos - zichtbaar[i].pos <= VENSTER; j++) {
            const a = zichtbaar[i], b = zichtbaar[j]
            if (a.ent === b.ent) continue
            const van = a.pos - 100, tot = b.eind + 100
            const rond = new Set(zichtbaar.filter((v) => v.pos >= van && v.pos <= tot).map((v) => v.ent))
            if (rond.size > MAX_PARTIJEN_PER_PASSAGE) {
              const anker = Math.floor(a.pos / VENSTER)
              if (!gezienLijst.has(anker)) {
                gezienLijst.add(anker)
                lijstAantal++
                if (lijstVoorbeelden.length < 6) lijstVoorbeelden.push({ doc, partijen: [...rond].map(naam), tekst: fragment(tekst, a.pos, Math.min(b.eind, a.pos + 240)) })
              }
              continue
            }
            registreer(a.ent, b.ent, doc, tekst, a.pos, b.eind, 'venster')
          }
        }
      }
    }
  }

  // 6. Vastgelegde relaties uit de kennisgraaf.
  const relRijen = await inStukken<any>(entIds, (g, a) => q(
    `SELECT subject_id, predicate, object_id, role_title FROM kg_relations WHERE subject_id IN (${g})`, a))
  const entSet = new Set(entIds)
  const relaties: GraafLijn[] = []
  for (const r of relRijen) {
    const a = wortel(Number(r.subject_id)), b = wortel(Number(r.object_id))
    if (!entSet.has(a) || !entSet.has(b) || a === b || verborgenIds.has(a) || verborgenIds.has(b)) continue
    if (relaties.some((x) => x.a === a && x.b === b && x.relatie === r.predicate)) continue
    relaties.push({ a, b, soort: 'relatie', documenten: 0, passages: 0, voorbeelden: [], relatie: [String(r.predicate).toLowerCase(), r.role_title].filter(Boolean).join(': ') })
  }

  // 7. Uitkomst.
  const docSignalenVan = (id: number) => new Set([...(partijDocs.get(id) ?? [])].flatMap((d) => [...(docSignalen.get(d) ?? [])]))
  const docFeitenVan = (id: number) => new Set([...(partijDocs.get(id) ?? [])].flatMap((d) => [...(docFeiten.get(d) ?? [])]))
  const partijen: GraafPartij[] = entIds
    .filter((id) => !verborgenIds.has(id) && kg.has(id))
    .map((id) => ({
      id,
      naam: naam(id),
      soort: (kg.get(id)?.entity_type ?? 'organization') as GraafPartij['soort'],
      koppeling: (bevestigd.has(id) ? 'bevestigd' : 'kandidaat') as Koppeling,
      documenten: partijDocs.get(id)!.size,
      signalen: docSignalenVan(id).size,
      feiten: docFeitenVan(id).size,
    }))
    .sort((a, b) => b.documenten - a.documenten || b.signalen - a.signalen || a.naam.localeCompare(b.naam))

  const passageLijnen: GraafLijn[] = [...paarDocs.entries()].map(([k, set]) => {
    const [a, b] = k.split('-').map(Number)
    return { a, b, soort: 'passage' as const, documenten: set.size, passages: paarAantal.get(k) ?? 0, vorm: paarVorm.get(k), voorbeelden: paarPassages.get(k) ?? [] }
  }).sort((x, y) => y.documenten - x.documenten || y.passages - x.passages)

  // Paren die alleen in hetzelfde document staan (ter vergelijking, regel 4).
  const zichtbareIds = partijen.map((p) => p.id)
  let zelfdeDocument = 0
  for (let i = 0; i < zichtbareIds.length; i++) for (let j = i + 1; j < zichtbareIds.length; j++) {
    const A = partijDocs.get(zichtbareIds[i])!, B = partijDocs.get(zichtbareIds[j])!
    for (const d of A) if (B.has(d)) { zelfdeDocument++; break }
  }

  const onNaam = new Map<string, { naam: string; docs: Set<number> }>()
  for (const r of ongekoppeld) {
    const k = String(r.normalized_text)
    if (!onNaam.has(k)) onNaam.set(k, { naam: String(r.mention_text), docs: new Set() })
    onNaam.get(k)!.docs.add(Number(r.raw_item_id))
  }

  const documenten: GraafDocument[] = docs.map((d) => ({
    id: Number(d.id),
    titel: String(d.title ?? `document ${d.id}`),
    url: d.external_url ?? null,
    datum: d.published_at ?? d.scraped_at ?? null,
    partijen: entIds.filter((id) => partijDocs.get(id)?.has(Number(d.id)) && !verborgenIds.has(id)),
  }))

  return {
    partijen,
    lijnen: [...passageLijnen, ...relaties],
    documenten,
    verantwoording: {
      feiten: feiten.length,
      signalen: signaalIds.length,
      documenten: docIds.length,
      naief: entIds.map((id) => ({ naam: naam(id), feiten: docFeitenVan(id).size })).sort((a, b) => b.feiten - a.feiten).slice(0, 10),
      naDeduplicatie: entIds.map((id) => ({ naam: naam(id), documenten: partijDocs.get(id)!.size })).sort((a, b) => b.documenten - a.documenten).slice(0, 10),
      paren: { zelfdeDocument, naPassagefilter: passageLijnen.length, relaties: relaties.length },
      lijstpassages: { aantal: lijstAantal, voorbeelden: lijstVoorbeelden },
      boilerplate: { aantal: boilerAantal, voorbeelden: [...boilerVoorbeelden.values()] },
      verborgen: [...verborgenIds].map((id) => ({ naam: naam(id), documenten: partijDocs.get(id)?.size ?? 0 })),
      geschrapteNaamvormen: geschrapt.slice(0, 30),
      nietGekoppeld: [...onNaam.values()].map((v) => ({ naam: v.naam, documenten: v.docs.size }))
        .sort((a, b) => b.documenten - a.documenten).slice(0, 15),
    },
    berekend: new Date().toISOString(),
  }
}

/** Zes uur gecachet: de graaf verandert alleen als de weger feiten toevoegt. */
export function getDossierGraaf(dossierId: number): Promise<DossierGraaf> {
  return unstable_cache(() => berekenGraaf(dossierId), ['dossier-graaf-v3', String(dossierId)], { revalidate: 21600 })()
}
