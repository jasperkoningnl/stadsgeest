import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'

// Handmatige controle van NER-koppelingen (docs/NER.md). Zelfde opzet als de
// fase-1-controle: alleen Jasper, één kandidaat tegelijk, idempotent via request_id.
// Een oordeel geldt voor die ene vermelding in haar context, niet voor alle
// vermeldingen met dezelfde naam (naamgenoten).

const REQUEST_ID = /^[0-9a-f-]{36}$/i
const VERDICTS = new Set(['correct', 'incorrect', 'skipped'])
const TARGET = 60

// Eén vermelding per (KG-entiteit, vorm), in een vaste maar gespreide volgorde.
const QUEUE = `FROM document_mentions dm
  WHERE dm.resolution_status = 'candidate' AND dm.reviewed_at IS NULL
    AND dm.id IN (SELECT MIN(id) FROM document_mentions WHERE resolved_entity_id IS NOT NULL
                  GROUP BY resolved_entity_id, normalized_text)
    AND NOT EXISTS (SELECT 1 FROM document_mention_reviews rv
                    JOIN document_mentions d2 ON d2.id = rv.mention_id
                    WHERE d2.resolved_entity_id = dm.resolved_entity_id AND d2.normalized_text = dm.normalized_text)`

async function status() {
  if (!turso) throw new Error('Geen database')
  const counts = (await turso.execute(`SELECT
    (SELECT COUNT(*) FROM document_mention_reviews WHERE verdict = 'correct') correct,
    (SELECT COUNT(*) FROM document_mention_reviews WHERE verdict = 'incorrect') incorrect,
    (SELECT COUNT(*) FROM document_mention_reviews WHERE verdict = 'skipped') skipped,
    (SELECT COUNT(*) ${QUEUE}) open`)).rows[0]
  const next = (await turso.execute(`SELECT dm.id, dm.entity_type, dm.mention_text, dm.context_snippet, dm.occurrences,
      ke.canonical_name, ke.entity_type AS kg_type, r.title, r.external_url, s.name AS bron,
      (SELECT COUNT(*) FROM document_mentions x WHERE x.resolved_entity_id = dm.resolved_entity_id) AS kg_vermeldingen
    ${QUEUE.replace('FROM document_mentions dm', `FROM document_mentions dm
      JOIN kg_entities ke ON ke.id = dm.resolved_entity_id
      JOIN raw_items r ON r.id = dm.raw_item_id
      JOIN sources s ON s.id = r.source_id`)}
    ORDER BY (dm.id * 7919) % 10007 LIMIT 1`)).rows[0] ?? null
  const correct = Number(counts.correct)
  const incorrect = Number(counts.incorrect)
  return {
    labeled: correct + incorrect,
    correct,
    incorrect,
    skipped: Number(counts.skipped),
    open: Number(counts.open),
    target: TARGET,
    candidate: next ? {
      id: Number(next.id),
      type: String(next.entity_type),
      mention: String(next.mention_text),
      context: next.context_snippet ? String(next.context_snippet) : '',
      occurrences: Number(next.occurrences),
      kgName: String(next.canonical_name),
      kgMentions: Number(next.kg_vermeldingen),
      title: next.title ? String(next.title) : '',
      url: next.external_url ? String(next.external_url) : null,
      source: String(next.bron),
    } : null,
  }
}

export async function GET(request: Request) {
  if ((await huidigeGebruiker(request.headers.get('cookie'))) !== 'jasper') {
    return NextResponse.json({ fout: 'Geen toegang' }, { status: 403 })
  }
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })
  return NextResponse.json(await status())
}

export async function POST(request: Request) {
  const gebruiker = await huidigeGebruiker(request.headers.get('cookie'))
  if (gebruiker !== 'jasper') return NextResponse.json({ fout: 'Geen toegang' }, { status: 403 })
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })
  const body = await request.json().catch(() => null)
  const mentionId = Number.isInteger(body?.mentionId) && body.mentionId > 0 ? body.mentionId : null
  const verdict = typeof body?.verdict === 'string' && VERDICTS.has(body.verdict) ? body.verdict : null
  const requestId = typeof body?.request_id === 'string' && REQUEST_ID.test(body.request_id) ? body.request_id : null
  if (!mentionId || !verdict || !requestId) return NextResponse.json({ fout: 'Ongeldige beoordeling' }, { status: 400 })

  const existingRequest = await turso.execute({ sql: 'SELECT id FROM document_mention_reviews WHERE request_id = ?', args: [requestId] })
  if (!existingRequest.rows.length) {
    const mention = await turso.execute({
      sql: `SELECT id FROM document_mentions
            WHERE id = ? AND resolution_status = 'candidate' AND reviewed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM document_mention_reviews WHERE mention_id = ?)`,
      args: [mentionId, mentionId],
    })
    if (!mention.rows.length) return NextResponse.json({ fout: 'Vermelding niet gevonden of al beoordeeld' }, { status: 404 })
    const stmts = [{
      sql: 'INSERT OR IGNORE INTO document_mention_reviews (mention_id, verdict, actor, request_id) VALUES (?,?,?,?)',
      args: [mentionId, verdict, gebruiker, requestId],
    }]
    if (verdict !== 'skipped') {
      stmts.push({
        sql: `UPDATE document_mentions SET resolution_status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
                updated_at = datetime('now')
              WHERE id = ? AND reviewed_at IS NULL
                AND EXISTS (SELECT 1 FROM document_mention_reviews
                            WHERE mention_id = ? AND request_id = ? AND verdict = ?)`,
        args: [verdict === 'correct' ? 'confirmed' : 'rejected', gebruiker, mentionId, mentionId, requestId, verdict],
      })
    }
    await turso.batch(stmts, 'write')
  }
  return NextResponse.json(await status())
}
