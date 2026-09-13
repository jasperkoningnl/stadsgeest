/* eslint-disable @typescript-eslint/no-explicit-any */
import { sha256Hex } from '@/lib/dashboardAuth'

type Executor = { execute: (statement: any) => Promise<any> }

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Bevriest de herkomst op het moment van een redactioneel oordeel. Daardoor
 * blijft een evaluatie reproduceerbaar als een cluster, bron of entiteit later
 * wordt aangevuld.
 */
export async function captureFeedbackContext(db: Executor, feedbackId: number, tipId: number) {
  const signalResult = await db.execute({
    sql: `SELECT ts.signal_id,ts.rol,s.title,s.detection_rule,s.provenance
          FROM tip_signals ts JOIN signals s ON s.id=ts.signal_id
          WHERE ts.tip_id=? ORDER BY ts.signal_id`,
    args: [tipId],
  })
  const signals = []
  for (const signal of signalResult.rows) {
    const sourceResult = await db.execute({
      sql: `SELECT DISTINCT src.id,src.name,src.bronrol AS role
            FROM signal_items si JOIN raw_items ri ON ri.id=si.raw_item_id
            JOIN sources src ON src.id=ri.source_id WHERE si.signal_id=? ORDER BY src.id`,
      args: [signal.signal_id],
    })
    const entityResult = await db.execute({
      sql: `SELECT DISTINCT ke.id,ke.canonical_name AS name,ke.entity_type AS type
            FROM kg_events ev JOIN event_entities ee ON ee.event_id=ev.id
            JOIN kg_entities ke ON ke.id=ee.entity_id
            WHERE ev.id=json_extract(?, '$.event_id') ORDER BY ke.id`,
      args: [signal.provenance || '{}'],
    })
    signals.push({
      id: Number(signal.signal_id), role: signal.rol, title: signal.title,
      rule: signal.detection_rule || null, sources: sourceResult.rows, entities: entityResult.rows,
    })
  }
  const context = { schemaVersion: 'phase5-v1', tipId, signals }
  const contextJson = JSON.stringify(context)
  await db.execute({
    sql: `INSERT OR IGNORE INTO editorial_feedback_contexts(feedback_id,tip_id,context_json,context_hash)
          VALUES (?,?,?,?)`,
    args: [feedbackId, tipId, contextJson, await sha256Hex(stableStringify(context))],
  })
}
