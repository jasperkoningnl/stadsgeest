import type { Client } from '@libsql/client'
import { valideerWooAnalyse, wooBewerking } from './wooFactor.ts'
import type { WooAnalyse, WooBesluit } from './wooFactor.ts'

export interface WooZaak {
  analyse: WooAnalyse
  dossier_naam: string
  concept: string
  revision: number
  besluit: WooBesluit
  decided_by: string | null
  decided_at: string | null
  updated_at: string
}

export class WooConflict extends Error {}

export async function leesWooZaken(db: Client): Promise<WooZaak[]> {
  const result = await db.execute(`SELECT c.*,d.naam dossier_naam FROM woo_factor_cases c
    JOIN dossiers d ON d.id=c.dossier_id ORDER BY c.created_at DESC,c.id LIMIT 100`)
  return result.rows.map(r => ({
    analyse: valideerWooAnalyse(JSON.parse(String(r.analyse_json))), dossier_naam: String(r.dossier_naam),
    concept: String(r.concept), revision: Number(r.revision), besluit: r.besluit as WooBesluit,
    decided_by: r.decided_by === null ? null : String(r.decided_by),
    decided_at: r.decided_at === null ? null : String(r.decided_at), updated_at: String(r.updated_at),
  }))
}

export async function bewerkWooZaak(db: Client, id: string, revision: number, actor: string, actie: unknown, concept: unknown) {
  const tx = await db.transaction('write')
  try {
    const row = (await tx.execute({ sql: 'SELECT * FROM woo_factor_cases WHERE id=?', args: [id] })).rows[0]
    if (!row) throw new WooConflict('Deze analyse bestaat niet meer.')
    if (Number(row.revision) !== revision) throw new WooConflict('Deze analyse is intussen gewijzigd. Vernieuw de pagina en beoordeel de nieuwste versie.')
    const analyse = valideerWooAnalyse(JSON.parse(String(row.analyse_json)))
    const next = wooBewerking(analyse, actie, concept, String(row.concept))
    const timestamp = new Date().toISOString()
    await tx.execute({
      sql: `UPDATE woo_factor_cases SET concept=?,besluit=?,revision=revision+1,
        decided_by=?,decided_at=?,updated_at=? WHERE id=? AND revision=?`,
      args: [next.concept, next.besluit, actie === 'opslaan' ? null : actor, actie === 'opslaan' ? null : timestamp, timestamp, id, revision],
    })
    await tx.execute({
      sql: 'INSERT INTO woo_factor_events(case_id,revision,actor,action,snapshot_json) VALUES (?,?,?,?,?)',
      args: [id, revision + 1, actor, String(actie), JSON.stringify({ analyse, ...next, revision: revision + 1 })],
    })
    await tx.commit()
    return { ...next, revision: revision + 1 }
  } catch (error) { await tx.rollback(); throw error }
  finally { tx.close() }
}
