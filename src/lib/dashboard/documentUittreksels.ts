export interface DocumentCitaat {
  tekst: string
  plek: string
}

export interface DocumentFeit {
  soort: string
  zin: string
  bewijsstatus: 'direct' | 'samengesteld'
  citaten: DocumentCitaat[]
}

export interface TipDocumentUittreksel {
  sleutel: string
  titel: string
  url: string | null
  bron: string
  kern: string
  afgekapt: boolean
  feiten: DocumentFeit[]
}

export function parseDocumentFeiten(json: string | null): DocumentFeit[] {
  try {
    const parsed = JSON.parse(json || '[]') as Array<DocumentFeit & { bewijsstatus?: string }>
    return parsed
      .filter((feit) => feit.bewijsstatus === 'direct' || feit.bewijsstatus === 'samengesteld')
      .slice(0, 8)
      .map((feit) => ({ ...feit, citaten: (feit.citaten || []).slice(0, 3) })) as DocumentFeit[]
  } catch { return [] }
}
