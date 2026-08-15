// Queries voor de verkenner: alles wat Stadsgeest over een naam of onderwerp
// heeft. Puur lezend. De ingang is een klik op een betrokkene bij een tip, of
// een losse zoekopdracht.
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
}

export interface VerkennerResultaat {
  term: string
  verbreedNaar: string | null
  tips: VerkennerTip[]
  signalen: VerkennerSignaal[]
  feiten: VerkennerFeit[]
  subsidies: VerkennerSubsidie[]
  subsidieTotalen: { jaar: number; totaal: number; aantal: number }[]
  documenten: VerkennerDocument[]
  documentenTotaal: number
}

function veilig(term: string): string {
  // LIKE-jokers uit de invoer halen; de zoekterm is data, geen patroon.
  return term.replace(/[%_]/g, ' ').trim()
}

async function zoek(term: string) {
  const like = `%${term}%`
  const [tips, signalen, feiten, subsidies, subsidieTotalen, documenten, docTelling] = await Promise.all([
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
      `SELECT f.id, f.titel, f.datum, f.details, f.zekerheid, f.primaire_bron_url, d.naam AS dossier
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
    q<VerkennerDocument>(
      `SELECT ri.title AS titel, ri.external_url AS url,
              COALESCE(ri.published_at, ri.scraped_at) AS datum, s.name AS bron
       FROM raw_items ri JOIN sources s ON s.id = ri.source_id
       WHERE ri.title LIKE ?
       ORDER BY datum DESC LIMIT 12`,
      [like],
    ),
    qOne<{ n: number }>(`SELECT COUNT(*) AS n FROM raw_items WHERE title LIKE ?`, [like]),
  ])
  return { tips, signalen, feiten, subsidies, subsidieTotalen, documenten, documentenTotaal: Number(docTelling?.n ?? 0) }
}

export async function verken(ruweTerm: string): Promise<VerkennerResultaat> {
  const term = veilig(ruweTerm)
  let uit = await zoek(term)
  let verbreedNaar: string | null = null

  // Niets gevonden en de term bestaat uit meerdere woorden? Probeer dan het
  // langste woord — "Robin de Jongh" vindt zo alsnog alles met "Jongh".
  const leeg = uit.tips.length + uit.signalen.length + uit.feiten.length
    + uit.subsidies.length + uit.documentenTotaal === 0
  if (leeg && term.includes(' ')) {
    const langste = term.split(/\s+/).filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)[0]
    if (langste && langste.toLowerCase() !== term.toLowerCase()) {
      uit = await zoek(langste)
      verbreedNaar = langste
    }
  }

  return { term, verbreedNaar, ...uit }
}
