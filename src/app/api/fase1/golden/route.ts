import { NextResponse } from 'next/server'
import { turso } from '@/lib/turso'
import { huidigeGebruiker } from '@/lib/dashboardAuth'

const REQUEST_ID = /^[0-9a-f-]{36}$/i
const VERDICTS = new Set(['same', 'different', 'skipped'])

async function status() {
  if (!turso) throw new Error('Geen database')
  const counts = (await turso.execute(`SELECT
    (SELECT COUNT(*) FROM phase1_golden_candidates) total,
    (SELECT COUNT(*) FROM phase1_golden_reviews WHERE verdict IN ('same','different')) labeled,
    (SELECT COUNT(*) FROM phase1_golden_reviews WHERE verdict='skipped') skipped`)).rows[0]
  const next = (await turso.execute(`SELECT c.id,c.reference_name,c.identifier_type,c.identifier_value,c.evidence_url
    FROM phase1_golden_candidates c
    LEFT JOIN phase1_golden_reviews r ON r.candidate_id=c.id
    WHERE r.id IS NULL ORDER BY c.id LIMIT 1`)).rows[0] ?? null
  return {
    total: Number(counts.total),
    labeled: Number(counts.labeled),
    skipped: Number(counts.skipped),
    target: 200,
    candidate: next ? {
      id: Number(next.id),
      referenceName: String(next.reference_name),
      identifierType: String(next.identifier_type),
      identifierValue: String(next.identifier_value),
      evidenceUrl: String(next.evidence_url),
    } : null,
  }
}

async function authorize(request: Request) {
  return (await huidigeGebruiker(request.headers.get('cookie'))) === 'jasper'
}

export async function GET(request: Request) {
  if (!(await authorize(request))) return NextResponse.json({ fout: 'Geen toegang' }, { status: 403 })
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })
  return NextResponse.json(await status())
}

export async function POST(request: Request) {
  const gebruiker = await huidigeGebruiker(request.headers.get('cookie'))
  if (gebruiker !== 'jasper') return NextResponse.json({ fout: 'Geen toegang' }, { status: 403 })
  if (!turso) return NextResponse.json({ fout: 'Geen database' }, { status: 503 })
  const body = await request.json().catch(() => null)
  const candidateId = Number.isInteger(body?.candidateId) && body.candidateId > 0 ? body.candidateId : null
  const verdict = typeof body?.verdict === 'string' && VERDICTS.has(body.verdict) ? body.verdict : null
  const requestId = typeof body?.request_id === 'string' && REQUEST_ID.test(body.request_id) ? body.request_id : null
  if (!candidateId || !verdict || !requestId) return NextResponse.json({ fout: 'Ongeldige beoordeling' }, { status: 400 })

  const existingRequest = await turso.execute({ sql: 'SELECT id FROM phase1_golden_reviews WHERE request_id=?', args: [requestId] })
  if (!existingRequest.rows.length) {
    const candidate = await turso.execute({ sql: 'SELECT id FROM phase1_golden_candidates WHERE id=?', args: [candidateId] })
    if (!candidate.rows.length) return NextResponse.json({ fout: 'Kandidaat niet gevonden' }, { status: 404 })
    await turso.execute({
      sql: `INSERT OR IGNORE INTO phase1_golden_reviews(candidate_id,verdict,actor,request_id) VALUES (?,?,?,?)`,
      args: [candidateId, verdict, gebruiker, requestId],
    })
  }
  return NextResponse.json(await status())
}
